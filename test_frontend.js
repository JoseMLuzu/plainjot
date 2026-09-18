const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

// A small DOM/API double exercises UI state without a browser or dependencies.
class Element {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.value = "";
    this.scrollHeight = 56;
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      contains: (name) => this.classes.has(name),
      toggle: (name, force) => {
        const active = force ?? !this.classes.has(name);
        if (active) this.classes.add(name);
        else this.classes.delete(name);
        return active;
      },
    };
  }
  get lastElementChild() { return this.children.at(-1); }
  append(...children) { children.forEach((child) => { child.parentElement = this; }); this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  querySelectorAll(selector) {
    return selector === "button" ? this.children.flatMap((child) => [...(child.tag === "button" ? [child] : []), ...(child.querySelectorAll?.(selector) || [])]) : [];
  }
  contains(target) { return target === this || this.children.some((child) => child.contains?.(target)); }
  focus() {}
  blur() {}
  select() {}
  scrollTo(options) { this.scrollTop = options.top; }
  getBoundingClientRect() { return { top: 0, left: 0, width: 1600, height: 1000 }; }
  setPointerCapture(id) { this.pointerId = id; }
  hasPointerCapture(id) { return this.pointerId === id; }
  releasePointerCapture() { this.pointerId = null; }
}

async function setup({ legacyDeveloperMode = false, animationFrames = true, outlineHidden = false } = {}) {
  const nodes = new Map();
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector);
  };
  node("#new-item").append(new Element("span"), new Element("span"));
  node("#document-project").parentElement = new Element("label");
  node("#create-menu").classList.add("hidden");
  for (const status of ["inbox", "todo", "done"]) {
    const button = new Element("button"); button.dataset.taskFilter = status;
    node("#task-filters").append(button);
  }
  for (const layout of ["list", "sprint"]) {
    const button = new Element("button");
    button.dataset.taskLayout = layout;
    node("#task-view-toggle").append(button);
  }
  const sections = ["notes", "tasks"].map((section) => {
    const button = new Element("button");
    button.dataset.section = section;
    return button;
  });
  const storage = new Map();
  storage.set("plainjot-developer-mode", String(legacyDeveloperMode));
  storage.set("plainjot-outline-hidden", String(outlineHidden));
  const notes = [
    { id: "ordinary.md", title: "Ordinary note", body: "Text", type: "note", kind: "" },
    { id: "external-journal.md", title: "Bug: External", body: "## Síntoma\n\nNothing happened.", type: "note", kind: "debug-journal" },
  ].map((note) => ({ ...note, modified: "2026-09-18T10:00:00Z", revision: "1", preview: note.body }));
  const templates = JSON.parse(fs.readFileSync(path.join(__dirname, "plainjot_core/templates.json"), "utf8"));
  const tasks = [];
  const posts = [];
  const documentListeners = new Map();
  const context = vm.createContext({
    document: {
      querySelector: node,
      getElementById: (id) => nodes.get(`#${id}`) ?? null,
      querySelectorAll: (selector) => selector === ".section-button" ? sections : [],
      createElement: (tag) => new Element(tag),
      createTextNode: (text) => ({ text }),
      addEventListener: (name, listener) => documentListeners.set(name, listener),
      documentElement: { dataset: {} },
    },
    window: { matchMedia: () => ({ matches: false }), addEventListener() {} },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    fetch: async (url, options = {}) => {
      let result;
      if (url === "/api/folder") result = { path: "/temporary/plainjot", can_choose: false };
      else if (url === "/api/templates") result = templates;
      else if (url === "/api/tasks" && options.method === "POST") {
        const payload = JSON.parse(options.body);
        posts.push(payload);
        result = { ...payload, id: `created-${posts.length}.md`, type: "task", modified: "2026-09-18T10:00:00Z", revision: "1", preview: payload.body };
        tasks.push(result);
      }
      else if (url === "/api/tasks") result = tasks;
      else if (url === "/api/notes" && options.method === "POST") {
        const payload = JSON.parse(options.body);
        posts.push(payload);
        result = { ...payload, id: `created-${posts.length}.md`, type: "note", modified: "2026-09-18T10:00:00Z", revision: "1", preview: payload.body };
        notes.push(result);
      } else if (url === "/api/notes") result = notes;
      else if (url.startsWith("/api/tasks/") && options.method === "PATCH") {
        result = tasks.find((task) => task.id === decodeURIComponent(url.split("/").at(-1)));
        Object.assign(result, JSON.parse(options.body), { revision: "changed" });
      }
      else if (url.startsWith("/api/documents/")) {
        result = [...notes, ...tasks].find((note) => note.id === decodeURIComponent(url.split("/").at(-1)));
        if (options.method === "PUT") Object.assign(result, JSON.parse(options.body), { revision: "2" });
      }
      else throw new Error(`Unexpected request: ${url}`);
      // HTTP/native JSON responses are snapshots, not references to the store.
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(result)) };
    },
    requestAnimationFrame: (callback) => { if (animationFrames) callback(); },
    getComputedStyle: () => ({ lineHeight: "56px" }),
    setTimeout: () => 1,
    clearTimeout() {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "static/whiteboard.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "static/app.js"), "utf8"), context);
  await new Promise((resolve) => setImmediate(resolve));
  return { node, storage, notes, tasks, posts, sections, documentListeners, run: (source) => vm.runInContext(source, context) };
}

test("two primary sections collect ordinary and developer documents together", async () => {
  const ui = await setup();
  assert.equal(ui.sections.length, 2);
  assert.equal(ui.run("sectionItems('notes').length"), 2);
  assert.equal(ui.node("#notes-count").textContent, 2);
});

test("Create exposes every type without creating a file and Escape closes it", async () => {
  const ui = await setup();
  ui.run("createForCurrentSection()");
  assert.equal(ui.node("#create-menu").classList.contains("hidden"), false);
  assert.equal(ui.posts.length, 0);
  const choices = ui.node("#create-options").querySelectorAll("button").map((button) => button.dataset.creation);
  for (const kind of ["note", "task", "whiteboard", "debug-journal", "ticket", "roadmap", "decision", "refactor", "review", "handoff"]) assert.ok(choices.includes(kind));
  ui.documentListeners.get("keydown")({ key: "Escape", preventDefault() {} });
  assert.equal(ui.node("#create-menu").classList.contains("hidden"), true);
  assert.equal(ui.node("#new-item").attributes.get("aria-expanded"), "false");
});

test("unchanged project options survive refresh and navigation", async () => {
  const ui = await setup();
  ui.notes[0].project = "alpha";
  await ui.run("loadCollections()");
  await ui.run("changeProject('alpha')");
  const option = ui.node("#project-filter").children[1];
  await ui.run("loadCollections()");
  await ui.run("changeSection('tasks')");
  assert.equal(ui.node("#project-filter").children[1], option);
  assert.equal(ui.node("#project-filter").value, "alpha");
  ui.notes[1].project = "beta";
  await ui.run("loadCollections()");
  assert.equal(ui.node("#project-filter").children.length, 3);
  assert.equal(ui.node("#project-filter").value, "alpha");
});

test("one-click journal creation uses the six-section template in Documents", async () => {
  const ui = await setup();
  await ui.run("chooseCreation('debug-journal')");
  assert.equal(ui.posts[0].kind, "debug-journal");
  assert.equal(ui.posts[0].title, "Bug: Nuevo registro");
  for (const heading of ["Síntoma", "Hipótesis", "Investigación", "Root cause", "Solución", "Qué aprendí"]) {
    assert.ok(ui.posts[0].body.includes(`## ${heading}`));
  }
  assert.equal(ui.run("state.view"), "write");
  assert.equal(ui.run("state.current.kind"), "debug-journal");
  assert.equal(ui.node("#document-kind").textContent, "Debug Journal · Markdown");
  assert.equal(ui.run("state.section"), "notes");
  assert.equal(ui.run("state.selectedId"), "created-1.md");
  assert.equal(ui.run("sectionItems().length"), 3);
  await ui.run("changeSection('tasks')");
  assert.equal(ui.run("state.selectedId"), null);
  assert.equal(ui.notes.length, 3);
  assert.equal(ui.posts.length, 1);
});

test("ordinary note creation stays unchanged", async () => {
  const ui = await setup();
  await ui.run("createNote()");
  assert.equal(ui.posts[0].kind, "");
  assert.equal(ui.posts[0].body, "");
  assert.equal(ui.run("state.section"), "notes");
});

test("whiteboards inherit project and open as drawings within Documents", async () => {
  const ui = await setup();
  await ui.run("changeProject('architecture')");
  await ui.run("chooseCreation('whiteboard')");
  assert.equal(ui.posts[0].kind, "whiteboard");
  assert.equal(ui.posts[0].project, "architecture");
  assert.equal(ui.run("state.view"), "preview");
  assert.equal(ui.run("sectionItems('notes').length"), 1);
  assert.equal(ui.node("#whiteboard-panel").classList.contains("hidden"), false);
  assert.equal(ui.node("#markdown-preview").classList.contains("hidden"), true);
  assert.equal(ui.node("#preview-tab").textContent, "Pizarra");
  assert.equal(ui.node("#whiteboard-reference").value, "[Pizarra](created-1.md)");
  assert.equal(ui.run("drawing.valid"), true);
  await ui.run("changeSection('tasks')");
  await ui.run("openDocumentFromSystem('created-1.md')");
  assert.equal(ui.run("state.section"), "notes");
});

test("drawing, undo, redo, and erase autosave to the same Markdown document", async () => {
  const ui = await setup();
  await ui.run("createWhiteboard()");
  ui.run("drawing.start({ button: 0, pointerId: 1, clientX: 20, clientY: 20, preventDefault() {} })");
  ui.run("drawing.move({ pointerId: 1, clientX: 100, clientY: 100 })");
  await ui.run("flushSave()"); // Navigation/save during a gesture commits it first.
  assert.equal(ui.run("PlainJotWhiteboard.parse(state.current.body).elements.length"), 1);
  ui.run("drawing.step('undo')");
  await ui.run("flushSave()");
  assert.equal(ui.run("PlainJotWhiteboard.parse(state.current.body).elements.length"), 0);
  ui.run("drawing.step('redo')");
  ui.run("drawing.setTool('eraser')");
  ui.run("drawing.start({ button: 0, pointerId: 2, clientX: 50, clientY: 50, preventDefault() {} })");
  ui.run("drawing.finish(2)");
  await ui.run("flushSave()");
  assert.equal(ui.run("PlainJotWhiteboard.parse(state.current.body).elements.length"), 0);
  assert.equal(ui.notes.length, 3);
});

test("external board edits reload and conflicts protect the drawing draft", async () => {
  const ui = await setup();
  await ui.run("createWhiteboard()");
  const board = ui.notes.at(-1);
  board.body = ui.run("PlainJotWhiteboard.serialize({ ...PlainJotWhiteboard.empty(), elements: [{ type: 'rect', color: '#30343b', size: 4, start: [10, 10], end: [100, 100] }] })");
  board.revision = "external";
  await ui.run("refreshFromFilesystem()");
  assert.equal(ui.run("drawing.history.board.elements[0].type"), "rect");
  ui.run("activateConflict(state.current)");
  ui.run("drawing.step('undo')"); // External reload starts a fresh undo history.
  assert.equal(ui.run("drawing.history.board.elements.length"), 1);
  ui.run("drawing.start({ button: 0, pointerId: 1, clientX: 200, clientY: 200, preventDefault() {} }); drawing.finish(1)");
  const draft = JSON.parse([...ui.storage.entries()].find(([key]) => key.startsWith("plainjot-conflict:"))[1]);
  assert.equal(ui.run(`PlainJotWhiteboard.parse(${JSON.stringify(draft.body)}).elements.length`), 2);
  assert.equal(ui.node("#save-status").textContent, "Conflicto pendiente");
});

test("malformed whiteboards remain intact and can be repaired in Markdown", async () => {
  const ui = await setup();
  ui.notes.push({ ...ui.notes[0], id: "broken.md", kind: "whiteboard", body: "unrecognized data" });
  await ui.run("openDocumentFromSystem('broken.md')");
  assert.equal(ui.run("drawing.valid"), false);
  assert.equal(ui.node("#note-body").value, "unrecognized data");
  assert.equal(ui.node("#whiteboard-error").classList.contains("hidden"), false);
  ui.run("setView('write')");
  assert.equal(ui.node("#whiteboard-panel").classList.contains("hidden"), true);
  assert.equal(ui.node("#note-body").classList.contains("hidden"), false);
  ui.node("#note-body").value = ui.run("PlainJotWhiteboard.serialize(PlainJotWhiteboard.empty())");
  ui.run("scheduleSave(); setView('preview')");
  assert.equal(ui.run("drawing.valid"), true);
  await ui.run("flushSave()");
  assert.ok(ui.notes.at(-1).body.startsWith("```plainjot-whiteboard"));
});

test("cancelled pointer gestures do not save partial drawings", async () => {
  const ui = await setup();
  await ui.run("createWhiteboard()");
  ui.run("drawing.start({ button: 0, pointerId: 1, clientX: 20, clientY: 20, preventDefault() {} }); drawing.cancel()");
  assert.equal(ui.run("drawing.history.board.elements.length"), 0);
  assert.equal(ui.run("state.saveTimer"), null);
});

test("legacy mode preferences do not affect external journal navigation", async () => {
  for (const legacyDeveloperMode of [false, true]) {
    const ui = await setup({ legacyDeveloperMode });
    await ui.run("openDocumentFromSystem('external-journal.md')");
    assert.equal(ui.run("state.section"), "notes");
    assert.equal(ui.run("state.view"), "preview");
  }
});

test("project filter applies to notes, inbox, tasks and Sprint View", async () => {
  const ui = await setup();
  ui.notes[0].project = "alpha";
  ui.notes[1].project = "beta";
  ui.tasks.push({ id: "task.md", title: "Work", preview: "", project: "beta", status: "inbox", modified: "2026-09-18T10:00:00Z" });
  await ui.run("loadCollections()");
  await ui.run("changeProject('beta')");
  assert.equal(ui.run("sectionItems('notes').length"), 1);
  await ui.run("setTaskFilter('inbox')");
  assert.equal(ui.run("sectionItems('tasks').length"), 1);
  assert.equal(ui.run("matchesSearch(state.notes[0])"), false);
  assert.equal(ui.node("#inbox-count").textContent, 1);
  await ui.run("createNote('roadmap')");
  assert.equal(ui.posts[0].project, "beta");
  assert.equal(ui.posts[0].kind, "roadmap");
});

test("ticket template creates an ordinary todo task with acceptance criteria", async () => {
  const ui = await setup();
  await ui.run("changeProject('plainjot')");
  await ui.run("chooseCreation('ticket')");
  assert.equal(ui.tasks.length, 1);
  assert.equal(ui.posts[0].status, "todo");
  assert.equal(ui.posts[0].project, "plainjot");
  assert.ok(ui.posts[0].body.includes("## Criterios de aceptación"));
  assert.ok(!Object.hasOwn(ui.posts[0], "kind"));
  assert.equal(ui.run("state.section"), "tasks");
});

test("project is saved alongside content and included in conflict drafts", async () => {
  const ui = await setup();
  await ui.run("selectDocument('ordinary.md')");
  ui.node("#document-project").value = "alpha";
  await ui.run("saveCurrent()");
  assert.equal(ui.notes[0].project, "alpha");
  ui.node("#document-project").value = "beta";
  ui.run("activateConflict(state.current)");
  const draft = JSON.parse([...ui.storage.entries()].find(([key]) => key.startsWith("plainjot-conflict:"))[1]);
  assert.equal(draft.project, "beta");
});

test("Inbox, pending and completed work are filters within Tasks", async () => {
  const ui = await setup();
  ui.tasks.push({ id: "agent.md", title: "Agent suggestion", type: "task", status: "inbox", project: "", body: "Context", preview: "Context", modified: "2026-09-18T10:00:00Z", revision: "1" });
  await ui.run("loadCollections()");
  await ui.run("changeSection('tasks')");
  assert.equal(ui.run("sectionItems().length"), 0);
  await ui.run("setTaskFilter('inbox')");
  await ui.run("selectDocument('agent.md')");
  assert.equal(ui.run("sectionItems().length"), 1);
  assert.equal(ui.node("#task-action").textContent, "Aceptar tarea");
  await ui.run("transitionTask()");
  assert.equal(ui.run("state.section"), "tasks");
  assert.equal(ui.run("state.taskFilter"), "todo");
  assert.equal(ui.node("#todo-count").textContent, 1);
  await ui.run("transitionTask()");
  assert.equal(ui.run("state.taskFilter"), "done");
  assert.equal(ui.node("#done-count").textContent, 1);
  await ui.run("setTaskFilter('todo')");
  assert.equal(ui.run("state.selectedId"), null);
  await ui.run("openDocumentFromSystem('agent.md')");
  assert.equal(ui.run("state.taskFilter"), "done");
  await ui.run("transitionTask()");
  assert.equal(ui.run("state.taskFilter"), "todo");
});

test("Sprint shows all statuses and hides list-only filters", async () => {
  const ui = await setup();
  for (const status of ["inbox", "todo", "done"]) ui.tasks.push({ id: `${status}.md`, title: status, type: "task", status, preview: "", modified: "2026-09-18T10:00:00Z" });
  await ui.run("loadCollections()");
  await ui.run("changeSection('tasks')");
  await ui.run("setTaskLayout('sprint')");
  assert.equal(ui.node("#task-filters").classList.contains("hidden"), true);
  assert.equal(ui.node("#notes-list").children.length, 3);
  assert.equal(ui.node("#sprint-columns").children.length, 3);
  await ui.run("setTaskLayout('list')");
  assert.equal(ui.node("#task-filters").classList.contains("hidden"), false);
  assert.equal(ui.run("sectionItems().length"), 1);
});

test("preview is quiet and project editing remains accessible in write mode", async () => {
  const ui = await setup();
  await ui.run("selectDocument('ordinary.md')");
  assert.equal(ui.node("#document-project").parentElement.classList.contains("hidden"), true);
  ui.run("setView('write')");
  assert.equal(ui.node("#document-project").parentElement.classList.contains("hidden"), false);
  await ui.run("chooseCreation('task')");
  assert.equal(ui.posts[0].status, "todo");
  assert.equal(ui.run("state.taskFilter"), "todo");
});

test("reading title belongs to the scrolling preview and remains editable in write mode", async () => {
  const ui = await setup();
  ui.notes[0].title = 'Long title <script>alert("x")</script>';
  await ui.run("selectDocument('ordinary.md')");
  assert.equal(ui.node("#note-title").classList.contains("hidden"), true);
  assert.ok(ui.node("#markdown-preview").innerHTML.startsWith('<h1 class="preview-title">Long title &lt;script&gt;'));
  assert.ok(!ui.node("#markdown-preview").innerHTML.includes("<script>"));
  assert.ok(ui.node("#markdown-preview").innerHTML.includes("<p>Text</p>"));
  ui.run("setView('write')");
  assert.equal(ui.node("#note-title").classList.contains("hidden"), false);
  ui.node("#note-title").value = "Updated title";
  ui.run("setView('preview')");
  assert.ok(ui.node("#markdown-preview").innerHTML.includes('class="preview-title">Updated title</h1>'));
  assert.equal(ui.posts.length, 0);
});

test("outline toggle frees width without replacing or scrolling the document", async () => {
  const ui = await setup();
  await ui.run("selectDocument('external-journal.md')");
  const preview = ui.node("#markdown-preview");
  preview.scrollTop = 180;
  const html = preview.innerHTML;
  assert.equal(ui.node("#outline-toggle").classList.contains("hidden"), false);
  assert.equal(ui.node("#outline-toggle").attributes.get("aria-expanded"), "true");
  ui.node("#outline-toggle").listeners.get("click")();
  assert.equal(ui.node("#document-outline").classList.contains("hidden"), true);
  assert.equal(ui.node("#editor").classList.contains("has-outline"), false);
  assert.equal(ui.node("#editor").classList.contains("wide-document"), true);
  assert.equal(ui.node("#outline-toggle").textContent, "Mostrar índice");
  assert.equal(ui.storage.get("plainjot-outline-hidden"), "true");
  assert.equal(preview.innerHTML, html);
  assert.equal(preview.scrollTop, 180);
  ui.run("toggleDocumentOutline()");
  assert.equal(ui.node("#outline-toggle").attributes.get("aria-expanded"), "true");
  assert.equal(ui.node("#document-outline-list").children[0].textContent, "Síntoma");
  assert.equal(ui.node("#editor").classList.contains("wide-document"), false);
  await ui.run("selectDocument('ordinary.md')");
  assert.equal(ui.node("#outline-toggle").classList.contains("hidden"), true);
  assert.equal(ui.node("#editor").classList.contains("has-outline"), false);
});

test("outline preference survives reopening and does not hide whiteboard titles", async () => {
  const ui = await setup({ outlineHidden: true });
  await ui.run("selectDocument('external-journal.md')");
  assert.equal(ui.node("#document-outline").classList.contains("hidden"), true);
  assert.equal(ui.node("#outline-toggle").textContent, "Mostrar índice");
  await ui.run("chooseCreation('whiteboard')");
  ui.run("setView('preview')");
  assert.equal(ui.node("#outline-toggle").classList.contains("hidden"), true);
  assert.equal(ui.node("#note-title").classList.contains("hidden"), false);
  assert.equal(ui.node("#editor").classList.contains("wide-document"), false);
});

test("outline navigation includes the scrolling title and works without animation frames", async () => {
  const ui = await setup({ animationFrames: false });
  await ui.run("selectDocument('external-journal.md')");
  ui.run("setView('write')");
  const preview = ui.node("#markdown-preview");
  preview.scrollTop = 50;
  preview.getBoundingClientRect = () => ({ top: 200 });
  ui.node("#plainjot-heading-sintoma").getBoundingClientRect = () => ({ top: 450 });
  ui.run("jumpToHeading('plainjot-heading-sintoma')");
  assert.equal(ui.run("state.view"), "preview");
  assert.equal(ui.node("#note-title").classList.contains("hidden"), true);
  assert.equal(preview.scrollTop, 296);
  ui.run("jumpToHeading('missing-heading')");
  assert.equal(preview.scrollTop, 296);
});

test("Markdown references allow same-folder documents but not arbitrary paths", async () => {
  const ui = await setup();
  assert.ok(ui.run("renderInline('[Bug](bug-login.md)')").includes('data-document-id="bug-login.md"'));
  for (const target of ["../secret.md", "/etc/secret.md", "file:///tmp/test.md", "javascript:alert(1)"]) {
    assert.ok(!ui.run(`renderInline(${JSON.stringify(`[Unsafe](${target})`)})`).includes("<a"));
  }
  const html = ui.run("markdownToHtml('- [ ] Verify tests\\n- [x] Done')");
  assert.ok(html.includes('type="checkbox" disabled'));
  assert.ok(html.includes(' checked'));
  assert.ok(!ui.run("markdownToHtml('<script>alert(1)</script>')").includes("<script>"));
  assert.ok(!ui.run("renderInline('`[Bug](bug_login.md)`')").includes("<a"));
  assert.ok(ui.run("renderInline('[Bug](bug_login_notes.md)')").includes('data-document-id="bug_login_notes.md"'));
});

test("title is resized on opening even if WebKit postpones animation frames", async () => {
  const ui = await setup({ animationFrames: false });
  ui.node("#note-title").scrollHeight = 168;
  await ui.run("selectDocument('ordinary.md')");
  assert.equal(ui.node("#note-title").style.height, "168px");
  assert.equal(ui.node("#note-title").style.overflowY, "hidden");
});

test("all templates and unknown note kinds remain discoverable in Documents", async () => {
  const ui = await setup();
  for (const kind of ["roadmap", "decision", "refactor", "review", "handoff"]) {
    await ui.run(`chooseCreation('${kind}')`);
    assert.equal(ui.run("state.section"), "notes");
    assert.equal(ui.run("state.current.kind"), kind);
    await ui.run("openDocumentFromSystem(state.selectedId)");
    assert.equal(ui.run("state.section"), "notes");
  }
  ui.notes.push({ ...ui.notes[0], id: "unknown-kind.md", kind: "custom-agent-kind" });
  await ui.run("loadCollections()");
  assert.equal(ui.run("sectionItems('notes').length"), 8);
});
