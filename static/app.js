const state = {
  notes: [],
  tasks: [],
  section: "notes",
  selectedId: null,
  current: null,
  saveTimer: null,
  externalTimer: null,
  loadingDocument: false,
  saving: false,
  choosingFolder: false,
  conflict: null,
  folder: null,
  view: "write",
  taskLayout: "list",
  taskFilter: "todo",
  creating: false,
  project: "",
  projectOptionsKey: null,
  templates: [],
  outlineHidden: false,
  sidebarHidden: false,
};

function isWhiteboard(item) {
  return item?.type === "note" && item.kind === "whiteboard";
}

const elements = {
  shell: document.querySelector("#app-shell"),
  sidebar: document.querySelector("#notes-sidebar"),
  sidebarToggle: document.querySelector("#sidebar-toggle"),
  projectFilter: document.querySelector("#project-filter"),
  createMenu: document.querySelector("#create-menu"),
  createOptions: document.querySelector("#create-options"),
  createContext: document.querySelector("#create-context"),
  documentProject: document.querySelector("#document-project"),
  list: document.querySelector("#notes-list"),
  search: document.querySelector("#search"),
  editor: document.querySelector("#editor"),
  empty: document.querySelector("#empty-state"),
  emptyKicker: document.querySelector("#empty-kicker"),
  emptyTitle: document.querySelector("#empty-title"),
  emptyCopy: document.querySelector("#empty-copy"),
  emptyButton: document.querySelector("#empty-new-item"),
  listHeading: document.querySelector("#list-heading-label"),
  taskViewToggle: document.querySelector("#task-view-toggle"),
  sprintBoard: document.querySelector("#sprint-board"),
  sprintColumns: document.querySelector("#sprint-columns"),
  notesCount: document.querySelector("#notes-count"),
  inboxCount: document.querySelector("#inbox-count"),
  tasksCount: document.querySelector("#tasks-count"),
  taskFilters: document.querySelector("#task-filters"),
  todoCount: document.querySelector("#todo-count"),
  doneCount: document.querySelector("#done-count"),
  whiteboardPanel: document.querySelector("#whiteboard-panel"),
  whiteboardReference: document.querySelector("#whiteboard-reference"),
  title: document.querySelector("#note-title"),
  titleHeading: document.querySelector("#title-heading"),
  body: document.querySelector("#note-body"),
  preview: document.querySelector("#markdown-preview"),
  outline: document.querySelector("#document-outline"),
  outlineList: document.querySelector("#document-outline-list"),
  outlineToggle: document.querySelector("#outline-toggle"),
  status: document.querySelector("#save-status"),
  date: document.querySelector("#note-date"),
  filename: document.querySelector("#note-filename"),
  wordCount: document.querySelector("#word-count"),
  documentKind: document.querySelector("#document-kind"),
  writeTab: document.querySelector("#write-tab"),
  previewTab: document.querySelector("#preview-tab"),
  taskAction: document.querySelector("#task-action"),
  taskContext: document.querySelector("#task-context"),
  conflictBanner: document.querySelector("#conflict-banner"),
  keepLocalVersion: document.querySelector("#keep-local-version"),
  loadExternalVersion: document.querySelector("#load-external-version"),
  newItem: document.querySelector("#new-item"),
  folder: document.querySelector("#notes-folder"),
  folderLabel: document.querySelector("#notes-folder-label"),
  toast: document.querySelector("#toast"),
  themeMeta: document.querySelector('meta[name="theme-color"]'),
};

const drawing = new PlainJotWhiteboard.Editor({
  svg: document.querySelector("#drawing-surface"),
  error: document.querySelector("#whiteboard-error"),
  text: document.querySelector("#drawing-text"),
  undo: document.querySelector("#drawing-undo"),
  redo: document.querySelector("#drawing-redo"),
  tools: [...document.querySelectorAll("[data-draw-tool]")],
  onChange: (body) => { elements.body.value = body; scheduleSave(); },
  onError: (message) => showToast(message),
});

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error || "No se pudo completar la operación");
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

function conflictDraftKey(documentId) {
  return `plainjot-conflict:${state.folder?.path || "default"}:${documentId}`;
}

function readConflictDraft(documentId) {
  try {
    const draft = JSON.parse(localStorage.getItem(conflictDraftKey(documentId)) || "null");
    return typeof draft?.title === "string" && typeof draft?.body === "string" ? draft : null;
  } catch {
    return null;
  }
}

function persistConflictDraft() {
  if (!state.conflict || !state.selectedId) return;
  try {
    localStorage.setItem(
      conflictDraftKey(state.selectedId),
      JSON.stringify({ title: elements.title.value, body: elements.body.value, project: elements.documentProject.value, saved_at: new Date().toISOString() })
    );
  } catch {
    showToast("No se pudo conservar una copia local del borrador.");
  }
}

function removeConflictDraft(documentId) {
  try {
    localStorage.removeItem(conflictDraftKey(documentId));
  } catch {
    // The resolved file remains the source of truth even if browser storage is unavailable.
  }
}

function hideConflictNotice() {
  elements.conflictBanner.classList.add("hidden");
}

function activateConflict(externalDocument, draft = null) {
  if (!state.selectedId || externalDocument.id !== state.selectedId) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  state.current = externalDocument;
  state.conflict = { external: externalDocument };
  if (draft) {
    elements.title.value = draft.title;
    elements.body.value = draft.body;
    elements.documentProject.value = draft.project ?? externalDocument.project ?? "";
    resizeTitle();
  }
  persistConflictDraft();
  elements.conflictBanner.classList.remove("hidden");
  setSaveStatus("Conflicto pendiente");
  updateEditorStats();
}

function restoreConflictDraft(document) {
  const draft = readConflictDraft(document.id);
  if (!draft) return false;
  activateConflict(document, draft);
  return true;
}

async function enterSaveConflict(documentId) {
  if (state.selectedId !== documentId || !state.current) return;
  const draft = { title: elements.title.value, body: elements.body.value, project: elements.documentProject.value };
  state.conflict = { external: state.current };
  persistConflictDraft();
  try {
    const external = await api(`/api/documents/${encodeURIComponent(documentId)}`);
    activateConflict(external, draft);
  } catch (error) {
    setSaveStatus("Borrador protegido");
    showToast(error.message);
  }
}

async function keepLocalConflictVersion() {
  if (!state.conflict || !state.selectedId || state.saving) return;
  const documentId = state.selectedId;
  const view = state.view;
  state.saving = true;
  setSaveStatus("Guardando tu versión…");
  try {
    const updated = await api(`/api/documents/${encodeURIComponent(documentId)}`, {
      method: "PUT",
      body: JSON.stringify({
        title: elements.title.value.trim() || "Sin título",
        body: elements.body.value,
        project: elements.documentProject.value,
        expected_revision: state.conflict.external.revision,
      }),
    });
    removeConflictDraft(documentId);
    state.conflict = null;
    showDocument(updated, { view });
    await loadCollections();
    showToast("Se conservó tu versión");
  } catch (error) {
    if (error.status === 409) {
      await enterSaveConflict(documentId);
      showToast("El archivo volvió a cambiar. Revisa el conflicto actualizado.");
    } else {
      setSaveStatus("Borrador protegido");
      showToast(error.message);
    }
  } finally {
    state.saving = false;
  }
}

async function loadExternalConflictVersion() {
  if (!state.conflict || !state.selectedId) return;
  const documentId = state.selectedId;
  const view = state.view;
  try {
    const external = await api(`/api/documents/${encodeURIComponent(documentId)}`);
    removeConflictDraft(documentId);
    state.conflict = null;
    showDocument(external, { view });
    await loadCollections();
    showToast("Se cargó la versión externa");
  } catch (error) {
    showToast(error.message);
  }
}

function updateFolderInfo(folder) {
  state.folder = folder;
  elements.folderLabel.textContent = folder.display_path || folder.path;
  elements.folder.title = folder.can_choose
    ? `Cambiar carpeta de notas\n${folder.path}`
    : folder.path;
}

async function loadFolderInfo() {
  try {
    updateFolderInfo(await api("/api/folder"));
  } catch (error) {
    showToast(error.message);
  }
}

async function chooseNotesFolder() {
  if (state.choosingFolder) return;
  if (!state.folder?.can_choose) {
    showToast("Puedes cambiar la carpeta desde la aplicación de macOS.");
    return;
  }

  await flushSave();
  state.choosingFolder = true;
  elements.folder.disabled = true;
  try {
    const folder = await api("/api/folder", { method: "POST", body: "{}" });
    updateFolderInfo(folder);
    if (!folder.changed) return;
    elements.search.value = "";
    state.project = "";
    state.section = "notes";
    clearEditor();
    await loadCollections({ preserveSelection: false });
    showToast("Carpeta de notas actualizada");
  } catch (error) {
    showToast(error.message);
  } finally {
    state.choosingFolder = false;
    elements.folder.disabled = false;
  }
}

async function loadCollections({ preserveSelection = true } = {}) {
  try {
    [state.notes, state.tasks] = await Promise.all([api("/api/notes"), api("/api/tasks")]);
    renderProjects();
    const allItems = [...state.notes, ...state.tasks];
    if (preserveSelection && state.selectedId && !allItems.some((item) => item.id === state.selectedId)) {
      clearEditor();
    }
    renderNavigation();
    renderList();
    renderSprintBoard();
    updateDocumentMetadata();
    updateEmptyState();
    updateWorkspaceMode();
  } catch (error) {
    showToast(error.message);
  }
}

function sectionItems(section = state.section) {
  const items = section === "notes" ? state.notes : state.tasks.filter((task) => task.status === state.taskFilter);
  return items.filter(matchesProject);
}

function matchesProject(item) {
  return !state.project || item.project === state.project;
}

function renderProjects() {
  const projects = [...new Set([...state.notes, ...state.tasks].map((item) => item.project).filter(Boolean))].sort();
  if (state.project && !projects.includes(state.project)) projects.push(state.project);
  const options = ["", ...projects];
  const optionsKey = JSON.stringify(options);
  if (optionsKey !== state.projectOptionsKey) {
    elements.projectFilter.replaceChildren();
    for (const project of options) {
      const option = document.createElement("option");
      option.value = project;
      option.textContent = project || "Todos los proyectos";
      elements.projectFilter.append(option);
    }
    state.projectOptionsKey = optionsKey;
  }
  if (elements.projectFilter.value !== state.project) elements.projectFilter.value = state.project;
}

async function loadTemplates() {
  try {
    state.templates = await api("/api/templates");
    renderCreateOptions();
  } catch (error) {
    renderCreateOptions(); // Basic note/task/board creation still works offline.
    showToast(error.message);
  }
}

function renderCreateOptions() {
  elements.createOptions.replaceChildren();
  const groups = [
    ["Documentos", [{ id: "note", label: "Nota" }, { id: "whiteboard", label: "Pizarra" }]],
    ["Tareas", [{ id: "task", label: "Tarea" }, ...state.templates.filter((item) => item.type === "task")]],
    ["Plantillas", state.templates.filter((item) => item.type === "note")],
  ];
  for (const [label, items] of groups) {
    if (!items.length) continue;
    const group = document.createElement("div");
    const heading = document.createElement("p");
    heading.className = "create-group-label"; heading.textContent = label; group.append(heading);
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button"; button.dataset.creation = item.id; button.textContent = item.label;
      button.addEventListener("click", () => chooseCreation(item.id));
      group.append(button);
    }
    elements.createOptions.append(group);
  }
}

function closeCreateMenu({ focus = false } = {}) {
  elements.createMenu.classList.add("hidden");
  elements.newItem.setAttribute("aria-expanded", "false");
  if (focus) elements.newItem.focus();
}

function toggleCreateMenu() {
  if (state.sidebarHidden) setSidebarHidden(false);
  if (state.creating) return;
  if (!elements.createMenu.classList.contains("hidden")) return closeCreateMenu({ focus: true });
  if (!elements.createOptions.children.length) renderCreateOptions();
  elements.createContext.textContent = state.project ? `Proyecto: ${state.project}` : "Sin proyecto · archivos locales";
  elements.createMenu.classList.remove("hidden");
  elements.newItem.setAttribute("aria-expanded", "true");
  elements.createOptions.querySelectorAll("button")[0]?.focus();
}

async function chooseCreation(kind) {
  if (state.creating) return;
  closeCreateMenu();
  state.creating = true; elements.newItem.disabled = true;
  try {
    if (kind === "note") await createNote();
    else if (kind === "task") await createTask("todo");
    else if (kind === "whiteboard") await createWhiteboard();
    else await createFromTemplate(kind);
  } finally { state.creating = false; elements.newItem.disabled = false; }
}

async function setTaskFilter(status) {
  if (!["inbox", "todo", "done"].includes(status) || status === state.taskFilter) return;
  await flushSave(); closeCreateMenu(); state.taskFilter = status;
  if (state.current?.type === "task" && state.current.status !== status) clearEditor();
  renderNavigation(); renderList(); updateEmptyState(); updateWorkspaceMode();
}

async function changeProject(project) {
  await flushSave();
  closeCreateMenu();
  state.project = project;
  if (state.current && !matchesProject(state.current)) clearEditor();
  renderNavigation();
  renderList();
  renderSprintBoard();
  updateWorkspaceMode();
}

function matchesSearch(item) {
  const query = elements.search.value.trim().toLocaleLowerCase();
  return matchesProject(item) && `${item.title} ${item.preview} ${item.project || ""} ${item.source || ""}`
    .toLocaleLowerCase()
    .includes(query);
}

function isSprintView() {
  return state.section === "tasks" && state.taskLayout === "sprint";
}

function renderNavigation() {
  elements.notesCount.textContent = sectionItems("notes").length;
  elements.tasksCount.textContent = state.tasks.filter(matchesProject).length;
  for (const status of ["inbox", "todo", "done"]) {
    elements[`${status}Count`].textContent = state.tasks.filter((task) => task.status === status && matchesProject(task)).length;
  }
  elements.taskFilters.classList.toggle("hidden", state.section !== "tasks" || isSprintView());
  elements.taskFilters.querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.taskFilter === state.taskFilter)));
  renderProjects();
  document.querySelectorAll(".section-button").forEach((button) => {
    const active = button.dataset.section === state.section;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  elements.listHeading.textContent = state.section === "notes" ? "RECIENTES" : isSprintView() ? "TODAS LAS TAREAS" : { inbox: "POR REVISAR", todo: "PENDIENTES", done: "COMPLETADAS" }[state.taskFilter];
  elements.taskViewToggle.classList.toggle("hidden", state.section !== "tasks");
  elements.taskViewToggle.querySelectorAll("button").forEach((button) => {
    const active = button.dataset.taskLayout === state.taskLayout;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  elements.newItem.lastElementChild.textContent = "Crear";
  elements.newItem.title = "Crear documento o tarea (⌘N)";
}

function renderList() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  const items = (isSprintView() ? state.tasks.filter(matchesProject) : sectionItems()).filter(matchesSearch);
  elements.list.replaceChildren();
  if (!items.length) {
    const message = document.createElement("p");
    message.className = "list-message";
    message.textContent = query
      ? "No encontramos nada con ese texto."
      : state.section === "notes" ? "Todavía no hay documentos."
        : { inbox: "Inbox está limpio.", todo: "No hay tareas pendientes.", done: "Todavía no hay tareas completadas." }[state.taskFilter];
    elements.list.append(message);
    return;
  }

  for (const item of items) {
    const button = document.createElement("button");
    button.className = `note-card${item.id === state.selectedId ? " active" : ""}${item.status === "done" ? " done" : ""}`;
    button.type = "button";

    const top = document.createElement("span");
    top.className = "note-card-top";
    const title = document.createElement("strong");
    if (item.type === "task") {
      const mark = document.createElement("i");
      mark.className = "task-mark";
      mark.textContent = item.status === "done" ? "✓" : "";
      title.append(mark, document.createTextNode(item.title));
    } else {
      title.textContent = item.title;
    }
    const time = document.createElement("time");
    time.dateTime = item.modified;
    time.textContent = item.type === "task" ? formatRelativeDate(item.modified) : formatCompactDate(item.modified);
    top.append(title, time);
    button.append(top);

    if (item.type === "task") {
      const context = document.createElement("span");
      context.className = "task-card-context";
      context.textContent = [item.project, item.source].filter(Boolean).map(capitalize).join(" · ") || "Sin proyecto";
      button.append(context);
    } else {
      const preview = document.createElement("span");
      preview.className = "note-preview";
      preview.textContent = isWhiteboard(item) ? (item.project || "Dibujo local · Markdown") : item.preview || "Nota vacía";
      button.append(preview);
      const kind = document.createElement("span");
      kind.className = "document-type";
      kind.textContent = isWhiteboard(item) ? "Pizarra" : state.templates.find((template) => template.id === item.kind)?.label || item.kind || "Nota";
      button.append(kind);
    }
    button.addEventListener("click", () => selectDocument(item.id));
    elements.list.append(button);
  }
}

function renderSprintBoard() {
  const columns = [
    { status: "inbox", label: "Inbox", hint: "Por revisar" },
    { status: "todo", label: "Por hacer", hint: "Trabajo aceptado" },
    { status: "done", label: "Hecho", hint: "Completado" },
  ];
  elements.sprintColumns.replaceChildren();

  for (const definition of columns) {
    const tasks = state.tasks.filter((task) => task.status === definition.status && matchesSearch(task));
    const column = document.createElement("section");
    column.className = `sprint-column sprint-${definition.status}`;

    const header = document.createElement("header");
    const heading = document.createElement("div");
    const title = document.createElement("h3");
    const hint = document.createElement("span");
    const count = document.createElement("span");
    title.textContent = definition.label;
    hint.textContent = definition.hint;
    count.className = "sprint-count";
    count.textContent = tasks.length;
    heading.append(title, hint);
    header.append(heading, count);
    column.append(header);

    const taskList = document.createElement("div");
    taskList.className = "sprint-task-list";
    if (!tasks.length) {
      const empty = document.createElement("p");
      empty.className = "sprint-empty";
      empty.textContent = elements.search.value.trim() ? "Sin coincidencias" : "Nada por aquí";
      taskList.append(empty);
    }

    for (const task of tasks) {
      const card = document.createElement("button");
      card.className = `sprint-card${task.status === "done" ? " done" : ""}`;
      card.type = "button";

      const cardTitle = document.createElement("strong");
      cardTitle.textContent = task.title;
      const context = document.createElement("span");
      context.textContent = [task.project, task.source].filter(Boolean).map(capitalize).join(" · ") || "Sin proyecto";
      const time = document.createElement("time");
      time.dateTime = task.modified;
      time.textContent = formatRelativeDate(task.modified);
      card.append(cardTitle, context, time);
      card.addEventListener("click", () => openTaskFromSprint(task.id));
      taskList.append(card);
    }

    column.append(taskList);
    elements.sprintColumns.append(column);
  }
}

function updateWorkspaceMode() {
  const sprint = isSprintView();
  elements.sprintBoard.classList.toggle("hidden", !sprint);
  if (sprint) {
    elements.empty.classList.add("hidden");
    elements.editor.classList.add("hidden");
  } else if (state.selectedId) {
    elements.empty.classList.add("hidden");
    elements.editor.classList.remove("hidden");
  } else {
    elements.empty.classList.remove("hidden");
    elements.editor.classList.add("hidden");
  }
}

async function setTaskLayout(layout) {
  if (!["list", "sprint"].includes(layout) || layout === state.taskLayout) return;
  await flushSave();
  state.taskLayout = layout;
  if (layout === "sprint") clearEditor();
  renderNavigation();
  renderList();
  renderSprintBoard();
  updateWorkspaceMode();
}

async function openTaskFromSprint(documentId) {
  state.taskLayout = "list";
  renderNavigation();
  updateWorkspaceMode();
  await selectDocument(documentId, { view: "preview" });
}

async function selectDocument(documentId, { view = "preview", focus = false } = {}) {
  if (state.loadingDocument || documentId === state.selectedId) return;
  await flushSave();
  state.loadingDocument = true;
  try {
    const document = await api(`/api/documents/${encodeURIComponent(documentId)}`);
    showDocument(document, { focus, view });
  } catch (error) {
    showToast(error.message);
    await loadCollections();
  } finally {
    state.loadingDocument = false;
  }
}

async function openDocumentFromSystem(documentId) {
  await flushSave();
  try {
    const document = await api(`/api/documents/${encodeURIComponent(documentId)}`);
    if (!matchesProject(document)) state.project = "";
    state.section = document.type === "task" ? "tasks" : "notes";
    if (document.type === "task") state.taskFilter = document.status;
    showDocument(document, { view: "preview" });
    await loadCollections();
  } catch (error) {
    showToast(error.message);
  }
}

function showDocument(document, { focus = false, view = state.view } = {}) {
  drawing.cancel();
  if (state.taskLayout === "sprint") state.taskLayout = "list";
  state.current = document;
  state.section = document.type === "task" ? "tasks" : "notes";
  if (document.type === "task") state.taskFilter = document.status;
  state.selectedId = document.id;
  state.conflict = null;
  hideConflictNotice();
  elements.title.value = document.title;
  elements.body.value = document.body;
  elements.documentProject.value = document.project || "";
  if (!restoreConflictDraft(document)) setSaveStatus("Todo guardado");
  setView(view, { focus: false });
  updateEditorStats();
  updateDocumentMetadata();
  updateTaskControls();
  renderNavigation();
  renderList();
  updateWorkspaceMode();
  resizeTitle();
  if (focus) elements.title.focus();
}

async function createNote(kind = "") {
  await flushSave();
  try {
    if (kind && !state.templates.length) await loadTemplates();
    const template = state.templates.find((item) => item.id === kind && item.type === "note");
    if (kind && !template) throw new Error("Plantilla no disponible");
    const note = await api("/api/notes", {
      method: "POST",
      body: JSON.stringify({
        title: template?.title || "Nueva nota",
        body: template?.body || "",
        kind,
        project: state.project,
      }),
    });
    state.section = "notes";
    await loadCollections();
    await selectDocument(note.id, { view: "write", focus: true });
    elements.title.select();
  } catch (error) {
    showToast(error.message);
  }
}

async function createTask(status = "todo", template = null) {
  await flushSave();
  try {
    const task = await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: template?.title || "Nueva tarea", body: template?.body || "", status, project: state.project, source: "" }),
    });
    state.section = "tasks"; state.taskFilter = status;
    await loadCollections();
    await selectDocument(task.id, { view: "write", focus: true });
    elements.title.select();
  } catch (error) {
    showToast(error.message);
  }
}

async function createWhiteboard() {
  await flushSave();
  try {
    const note = await api("/api/notes", {
      method: "POST",
      body: JSON.stringify({ title: "Nueva pizarra", body: PlainJotWhiteboard.serialize(PlainJotWhiteboard.empty()), kind: "whiteboard", project: state.project }),
    });
    state.section = "notes";
    await loadCollections();
    await selectDocument(note.id, { view: "preview", focus: true });
    elements.title.select();
  } catch (error) { showToast(error.message); }
}

async function exportWhiteboard() {
  if (!isWhiteboard(state.current)) return;
  drawing.finish();
  try {
    const svg = PlainJotWhiteboard.toSVG(PlainJotWhiteboard.parse(elements.body.value), elements.title.value);
    const filename = state.selectedId.replace(/\.md$/i, ".svg");
    if (window.webkit?.messageHandlers?.notes) {
      const result = await api("/api/export/whiteboard", { method: "POST", body: JSON.stringify({ filename, svg }) });
      if (result.saved) showToast("Pizarra exportada");
    } else {
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      const link = document.createElement("a");
      link.href = url; link.download = filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (error) { showToast(error.message); }
}

function createForCurrentSection() {
  toggleCreateMenu();
}

async function createFromTemplate(kind) {
  if (!state.templates.length) await loadTemplates();
  const template = state.templates.find((item) => item.id === kind);
  if (!template) return showToast("Selecciona una plantilla");
  return template.type === "task" ? createTask("todo", template) : createNote(template.id);
}

function scheduleSave() {
  if (!state.selectedId) return;
  if (state.conflict) {
    setSaveStatus("Conflicto pendiente");
    updateEditorStats();
    persistConflictDraft();
    return;
  }
  setSaveStatus("Editando…");
  updateEditorStats();
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveCurrent, 650);
}

async function saveCurrent() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  if (!state.selectedId || !state.current) return;
  if (state.conflict) {
    persistConflictDraft();
    return;
  }
  const documentId = state.selectedId;
  state.saving = true;
  setSaveStatus("Guardando…");
  try {
    const updated = await api(`/api/documents/${encodeURIComponent(documentId)}`, {
      method: "PUT",
      body: JSON.stringify({
        title: elements.title.value.trim() || "Sin título",
        body: elements.body.value,
        project: elements.documentProject.value,
        expected_revision: state.current.revision,
      }),
    });
    if (state.selectedId === documentId) {
      state.current = updated;
      setSaveStatus("Todo guardado");
    }
    await loadCollections();
  } catch (error) {
    if (error.status === 409) {
      await enterSaveConflict(documentId);
      showToast("El archivo cambió fuera de PlainJot. Tu borrador está protegido.");
    } else {
      setSaveStatus("Error al guardar");
      showToast(error.message);
    }
  } finally {
    state.saving = false;
  }
}

async function flushSave() {
  drawing.finish();
  if (state.saveTimer) await saveCurrent();
}

async function transitionTask() {
  if (!state.current || state.current.type !== "task") return;
  await flushSave();
  if (!state.current || state.current.type !== "task") return;
  const nextStatus = state.current.status === "inbox" ? "todo" : state.current.status === "todo" ? "done" : "todo";
  try {
    const updated = await api(`/api/tasks/${encodeURIComponent(state.current.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: nextStatus, expected_revision: state.current.revision }),
    });
    state.section = "tasks"; state.taskFilter = nextStatus;
    showDocument(updated);
    await loadCollections();
  } catch (error) {
    if (error.status === 409) await enterSaveConflict(state.current.id);
    showToast(error.message);
  }
}

async function deleteCurrent() {
  if (!state.selectedId || !state.current) return;
  await flushSave();
  if (!state.selectedId || !state.current) return;
  const kind = isWhiteboard(state.current) ? "la pizarra" : state.current.type === "task" ? "la tarea" : "la nota";
  const title = elements.title.value.trim() || kind;
  const usesTrash = state.folder?.deletion_mode === "trash";
  const message = usesTrash
    ? `¿Mover “${title}” a la Papelera?`
    : `¿Eliminar “${title}”? Esta acción no se puede deshacer.`;
  if (!window.confirm(message)) return;
  const documentId = state.selectedId;
  try {
    await api(`/api/documents/${encodeURIComponent(documentId)}`, {
      method: "DELETE",
      body: JSON.stringify({ expected_revision: state.current.revision }),
    });
    removeConflictDraft(documentId);
    clearEditor();
    await loadCollections({ preserveSelection: false });
    showToast(usesTrash ? `${capitalize(kind)} enviada a la Papelera` : `${capitalize(kind)} eliminada`);
  } catch (error) {
    if (error.status === 409) await enterSaveConflict(documentId);
    showToast(error.message);
  }
}

function clearEditor() {
  drawing.cancel();
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  state.selectedId = null;
  state.current = null;
  state.conflict = null;
  hideConflictNotice();
  elements.title.value = "";
  elements.title.style.height = "";
  elements.title.style.overflowY = "";
  elements.body.value = "";
  renderDocumentOutline();
  setSaveStatus("Todo guardado");
  updateEmptyState();
  renderList();
  updateWorkspaceMode();
}

async function changeSection(section) {
  if (!["notes", "tasks"].includes(section)) return;
  if (section === state.section) return;
  await flushSave();
  closeCreateMenu();
  state.section = section;
  if (state.selectedId && !sectionItems().some((item) => item.id === state.selectedId)) clearEditor();
  renderNavigation();
  renderList();
  renderSprintBoard();
  updateEmptyState();
  updateWorkspaceMode();
}

function updateEmptyState() {
  const content = state.section === "notes"
    ? ["DOCUMENTOS", "Tu trabajo, en un solo lugar.", "Notas, journals, roadmaps y pizarras. Abre un documento o pulsa + Crear para empezar.", "＋ Crear"]
    : state.taskFilter === "inbox"
      ? ["INBOX", "Propuestas por revisar.", "Aquí llegan las tareas de tus agentes. Acéptalas para pasarlas a Pendientes.", "＋ Crear"]
      : state.taskFilter === "done"
        ? ["HECHAS", "El trabajo que ya terminaste.", "Abre una tarea para consultar sus detalles o reabrirla.", "＋ Crear"]
        : ["PENDIENTES", "Una lista pequeña y clara.", "Abre una tarea, complétala o crea la siguiente. Revisa Inbox para aceptar propuestas de tus agentes.", "＋ Crear"];
  [elements.emptyKicker.textContent, elements.emptyTitle.textContent, elements.emptyCopy.textContent, elements.emptyButton.textContent] = content;
}

function updateTaskControls() {
  const isTask = state.current?.type === "task";
  elements.taskAction.classList.toggle("hidden", !isTask);
  elements.taskContext.classList.toggle("hidden", !isTask);
  const template = state.templates.find((item) => item.id === state.current?.kind);
  elements.documentKind.textContent = isWhiteboard(state.current) ? "Whiteboard · Markdown" : isTask ? "Markdown task" : template ? `${template.label} · Markdown` : "Markdown note";
  if (!isTask) return;
  const labels = { inbox: "Aceptar tarea", todo: "Completar", done: "Reabrir" };
  elements.taskAction.textContent = labels[state.current.status] || "Mover a Tasks";
  elements.taskContext.replaceChildren();
  const values = [
    state.current.source && `Fuente: ${state.current.source}`,
    `Estado: ${state.current.status}`,
  ].filter(Boolean);
  for (const value of values) {
    const span = document.createElement("span");
    span.textContent = value;
    elements.taskContext.append(span);
  }
}

function setView(view, { focus = true } = {}) {
  drawing.finish();
  state.view = view;
  const isPreview = view === "preview";
  const board = isWhiteboard(state.current);
  elements.editor.classList.toggle("whiteboard-document", board);
  elements.editor.classList.toggle("reading", isPreview);
  elements.writeTab.textContent = board ? "Markdown" : "Escribir";
  elements.previewTab.textContent = board ? "Pizarra" : "Vista previa";
  elements.whiteboardPanel.classList.toggle("hidden", !board || !isPreview);
  if (board && isPreview) {
    drawing.load(elements.body.value);
    elements.whiteboardReference.value = `[Pizarra](${state.selectedId})`;
  }
  elements.writeTab.classList.toggle("active", !isPreview);
  elements.writeTab.setAttribute("aria-selected", String(!isPreview));
  elements.previewTab.classList.toggle("active", isPreview);
  elements.previewTab.setAttribute("aria-selected", String(isPreview));
  elements.body.classList.toggle("hidden", isPreview);
  elements.title.classList.toggle("hidden", isPreview && !board);
  elements.titleHeading.classList.toggle("hidden", isPreview && !board);
  elements.documentProject.parentElement.classList.toggle("hidden", isPreview);
  elements.preview.classList.toggle("hidden", !isPreview || board);
  resizeTitle();
  if (isPreview) {
    if (!board) renderMarkdownPreview();
    else if (focus && drawing.valid) drawing.svg.focus();
  } else if (focus) elements.body.focus();
}

function updateEditorStats() {
  if (isWhiteboard(state.current)) {
    try { elements.wordCount.textContent = `${PlainJotWhiteboard.parse(elements.body.value).elements.length} elementos`; }
    catch { elements.wordCount.textContent = "Revisa el bloque Markdown"; }
    renderDocumentOutline();
    return;
  }
  const text = elements.body.value.trim();
  const words = text ? text.split(/\s+/u).length : 0;
  elements.wordCount.textContent = `${words} ${words === 1 ? "palabra" : "palabras"}`;
  if (state.view === "preview") renderMarkdownPreview();
  renderDocumentOutline();
}

function resizeTitle() {
  elements.title.style.height = "auto";
  const lineHeight = Number.parseFloat(getComputedStyle(elements.title).lineHeight) || 56;
  const maximumHeight = lineHeight * 3;
  const desiredHeight = Math.min(elements.title.scrollHeight, maximumHeight);
  elements.title.style.height = `${Math.ceil(desiredHeight)}px`;
  elements.title.style.overflowY = elements.title.scrollHeight > maximumHeight ? "auto" : "hidden";
}

function handleTitleInput() {
  const original = elements.title.value;
  const cursor = elements.title.selectionStart;
  const normalized = original.replace(/\s*[\r\n]+\s*/g, " ");
  if (normalized !== original) {
    const normalizedBeforeCursor = original.slice(0, cursor).replace(/\s*[\r\n]+\s*/g, " ");
    elements.title.value = normalized;
    elements.title.setSelectionRange(normalizedBeforeCursor.length, normalizedBeforeCursor.length);
  }
  resizeTitle();
  scheduleSave();
}

function updateDocumentMetadata() {
  if (!state.selectedId) return;
  const item = [...state.notes, ...state.tasks].find((candidate) => candidate.id === state.selectedId);
  elements.filename.textContent = state.selectedId;
  elements.filename.title = state.selectedId;
  elements.date.textContent = item ? formatLongDate(item.modified) : "Ahora";
}

function formatCompactDate(value) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(date).replace(".", "");
}

function formatRelativeDate(value) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

function formatLongDate(value) {
  return new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function capitalize(value) {
  return value ? value.charAt(0).toLocaleUpperCase() + value.slice(1) : value;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderInline(value) {
  const formatText = (text) => escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");
  const tokens = /`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[A-Za-z0-9._~:/?#@!$()*+,;=%-]+|[A-Za-z0-9][A-Za-z0-9._-]*\.md)\)/g;
  let result = "";
  let cursor = 0;
  for (const match of value.matchAll(tokens)) {
    result += formatText(value.slice(cursor, match.index));
    if (match[1] !== undefined) result += `<code>${escapeHtml(match[1])}</code>`;
    else {
      const target = escapeHtml(match[3]);
      const attributes = match[3].startsWith("http")
        ? 'target="_blank" rel="noreferrer"' : `data-document-id="${target}"`;
      result += `<a href="${target}" ${attributes}>${formatText(match[2])}</a>`;
    }
    cursor = match.index + match[0].length;
  }
  return result + formatText(value.slice(cursor));
}

function headingLabel(value) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .trim();
}

function headingSlug(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "seccion";
}

function parseMarkdownHeadings(markdown) {
  const headings = [];
  const occurrences = new Map();
  let inCode = false;

  markdown.replaceAll("\r\n", "\n").split("\n").forEach((line, lineIndex) => {
    if (line.trim().startsWith("```")) {
      inCode = !inCode;
      return;
    }
    if (inCode) return;
    const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!match) return;
    const headingMarkdown = match[2].replace(/\s+#+\s*$/, "").trim();
    const label = headingLabel(headingMarkdown);
    if (!label) return;
    const slug = headingSlug(label);
    const occurrence = (occurrences.get(slug) || 0) + 1;
    occurrences.set(slug, occurrence);
    headings.push({
      id: `plainjot-heading-${slug}${occurrence > 1 ? `-${occurrence}` : ""}`,
      label,
      level: match[1].length,
      lineIndex,
      markdown: headingMarkdown,
    });
  });
  return headings;
}

function setActiveOutlineHeading(headingId) {
  elements.outlineList.querySelectorAll("button").forEach((button) => {
    const active = button.dataset.headingId === headingId;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "location");
    else button.removeAttribute("aria-current");
  });
}

function updateOutlineActive() {
  if (state.view !== "preview") return;
  const headings = [...elements.preview.querySelectorAll("[data-outline-heading]")];
  if (!headings.length) return;
  const previewTop = elements.preview.getBoundingClientRect().top + 12;
  let active = headings[0];
  for (const heading of headings) {
    if (heading.getBoundingClientRect().top > previewTop) break;
    active = heading;
  }
  setActiveOutlineHeading(active.id);
}

function jumpToHeading(headingId) {
  if (state.view !== "preview") setView("preview", { focus: false });
  // Rendering is synchronous; do not depend on animation frames, which WebKit
  // may suspend when opening a document from a background window.
  const heading = document.getElementById(headingId);
  if (!heading) return;
  const top = elements.preview.scrollTop
    + heading.getBoundingClientRect().top
    - elements.preview.getBoundingClientRect().top;
  elements.preview.scrollTo({ top: Math.max(0, top - 4), behavior: "smooth" });
  setActiveOutlineHeading(headingId);
}

function renderDocumentOutline() {
  const headings = state.selectedId && !isWhiteboard(state.current) ? parseMarkdownHeadings(elements.body.value) : [];
  elements.outlineList.replaceChildren();
  const available = headings.length > 0;
  const visible = available && !state.outlineHidden;
  elements.outlineToggle.classList.toggle("hidden", !available);
  elements.outlineToggle.textContent = visible ? "Ocultar índice" : "Mostrar índice";
  elements.outlineToggle.setAttribute("aria-expanded", String(visible));
  elements.outline.classList.toggle("hidden", !visible);
  elements.editor.classList.toggle("has-outline", visible);
  elements.editor.classList.toggle("wide-document", available && !visible);
  if (!visible) return;

  for (const heading of headings) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.headingId = heading.id;
    button.className = `outline-level-${Math.min(heading.level, 3)}`;
    button.textContent = heading.label;
    button.title = heading.label;
    button.addEventListener("click", () => jumpToHeading(heading.id));
    elements.outlineList.append(button);
  }
  updateOutlineActive();
}

function toggleDocumentOutline() {
  state.outlineHidden = !state.outlineHidden;
  try {
    localStorage.setItem("plainjot-outline-hidden", String(state.outlineHidden));
  } catch {
    // Hiding the outline still works when browser preferences cannot be saved.
  }
  renderDocumentOutline();
  resizeTitle();
}

function setSidebarHidden(hidden, { persist = true } = {}) {
  state.sidebarHidden = hidden;
  elements.shell.classList.toggle("sidebar-collapsed", hidden);
  elements.sidebar.classList.toggle("hidden", hidden);
  elements.sidebarToggle.setAttribute("aria-expanded", String(!hidden));
  const label = hidden ? "Mostrar barra lateral" : "Ocultar barra lateral";
  elements.sidebarToggle.setAttribute("aria-label", label);
  elements.sidebarToggle.title = label;
  if (hidden) closeCreateMenu();
  if (persist) {
    try {
      localStorage.setItem("plainjot-sidebar-hidden", String(hidden));
    } catch {
      // Reading layout works even when local preferences cannot be saved.
    }
  }
  resizeTitle();
  updateOutlineActive();
}

function markdownToHtml(markdown) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const headings = new Map(parseMarkdownHeadings(markdown).map((heading) => [heading.lineIndex, heading]));
  const output = [];
  let code = [];
  let inCode = false;
  let listType = null;
  const closeList = () => {
    if (listType) output.push(`</${listType}>`);
    listType = null;
  };

  for (const [lineIndex, line] of lines.entries()) {
    if (line.trim().startsWith("```")) {
      closeList();
      if (inCode) {
        output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = [];
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      const nextType = unordered ? "ul" : "ol";
      if (listType !== nextType) {
        closeList();
        listType = nextType;
        output.push(`<${listType}>`);
      }
      const text = (unordered || ordered)[1];
      const checkbox = unordered && text.match(/^\[([ xX])\]\s+(.+)$/);
      output.push(checkbox
        ? `<li class="markdown-checklist"><input type="checkbox" disabled aria-label="Criterio"${checkbox[1] !== " " ? " checked" : ""}> ${renderInline(checkbox[2])}</li>`
        : `<li>${renderInline(text)}</li>`);
      continue;
    }
    closeList();
    const heading = headings.get(lineIndex);
    if (!line.trim()) continue;
    if (heading) output.push(`<h${heading.level} id="${heading.id}" data-outline-heading>${renderInline(heading.markdown)}</h${heading.level}>`);
    else if (/^\s*---+\s*$/.test(line)) output.push("<hr>");
    else if (line.startsWith("> ")) output.push(`<blockquote>${renderInline(line.slice(2))}</blockquote>`);
    else output.push(`<p>${renderInline(line)}</p>`);
  }
  closeList();
  if (inCode && code.length) output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  return output.join("\n");
}

function renderMarkdownPreview() {
  const body = elements.body.value.trim();
  const title = escapeHtml(elements.title.value.trim() || "Sin título");
  const content = body
    ? markdownToHtml(body)
    : '<p class="preview-placeholder">La vista previa aparecerá cuando escribas algo.</p>';
  elements.preview.innerHTML = `<h1 class="preview-title">${title}</h1>\n${content}`;
  updateOutlineActive();
}

function setSaveStatus(message) {
  elements.status.textContent = message;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  elements.themeMeta.content = theme === "dark" ? "#20211e" : "#f7f5f0";
  localStorage.setItem("plainjot-theme", theme);
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

let toastTimer;
function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 2800);
}

async function refreshFromFilesystem() {
  if (state.conflict) return;
  if (state.saveTimer || state.saving || state.loadingDocument || drawing.gesture) {
    scheduleFilesystemRefresh();
    return;
  }
  const previousRevision = state.current?.revision;
  const selectedId = state.selectedId;
  await loadCollections();
  if (!selectedId || state.selectedId !== selectedId) return;
  try {
    const document = await api(`/api/documents/${encodeURIComponent(selectedId)}`);
    if (document.revision !== previousRevision) showDocument(document);
  } catch (error) {
    if (error.status === 404) clearEditor();
    else showToast(error.message);
  }
}

function scheduleFilesystemRefresh() {
  clearTimeout(state.externalTimer);
  state.externalTimer = setTimeout(refreshFromFilesystem, 180);
}

window.__plainjotFilesChanged = scheduleFilesystemRefresh;
window.__plainjotOpenDocument = openDocumentFromSystem;
window.addEventListener("resize", resizeTitle);
document.querySelector("#drawing-export").addEventListener("click", exportWhiteboard);
document.querySelector("#drawing-color").addEventListener("change", (event) => {
  drawing.finish(); drawing.color = event.target.value;
});
document.querySelector("#drawing-size").addEventListener("change", (event) => {
  drawing.finish(); drawing.size = Number(event.target.value);
});
elements.whiteboardReference.addEventListener("click", () => elements.whiteboardReference.select());

elements.newItem.addEventListener("click", createForCurrentSection);
elements.emptyButton.addEventListener("click", createForCurrentSection);
elements.createMenu.addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const buttons = [...elements.createOptions.querySelectorAll("button")];
  if (!buttons.length) return;
  event.preventDefault();
  const current = buttons.indexOf(event.target);
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next].focus();
});
elements.createMenu.addEventListener("focusout", (event) => {
  if (event.relatedTarget && !elements.createMenu.contains(event.relatedTarget) && !elements.newItem.contains(event.relatedTarget)) closeCreateMenu();
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".create-control") && !event.target.closest("#empty-new-item")) closeCreateMenu();
});
elements.taskFilters.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => setTaskFilter(button.dataset.taskFilter)));
elements.folder.addEventListener("click", chooseNotesFolder);
elements.projectFilter.addEventListener("change", () => changeProject(elements.projectFilter.value));
elements.documentProject.addEventListener("input", scheduleSave);
elements.preview.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-document-id]");
  if (!link) return;
  event.preventDefault();
  openDocumentFromSystem(link.dataset.documentId);
});
elements.keepLocalVersion.addEventListener("click", keepLocalConflictVersion);
elements.loadExternalVersion.addEventListener("click", loadExternalConflictVersion);
document.querySelector("#delete-note").addEventListener("click", deleteCurrent);
document.querySelector("#theme-toggle").addEventListener("click", toggleTheme);
document.querySelector("#refresh").addEventListener("click", async () => {
  await flushSave();
  await refreshFromFilesystem();
  showToast("Carpeta actualizada");
});
elements.taskAction.addEventListener("click", transitionTask);
elements.writeTab.addEventListener("click", () => setView("write"));
elements.previewTab.addEventListener("click", () => setView("preview"));
elements.outlineToggle.addEventListener("click", toggleDocumentOutline);
elements.sidebarToggle.addEventListener("click", () => setSidebarHidden(!state.sidebarHidden));
elements.preview.addEventListener("scroll", updateOutlineActive, { passive: true });
elements.search.addEventListener("input", () => {
  renderList();
  renderSprintBoard();
});
elements.title.addEventListener("input", handleTitleInput);
elements.title.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  if (isWhiteboard(state.current)) { elements.title.blur(); return; }
  setView("write", { focus: false });
  elements.body.focus();
});
elements.body.addEventListener("input", scheduleSave);
document.querySelectorAll(".section-button").forEach((button) => {
  button.addEventListener("click", () => changeSection(button.dataset.section));
});
elements.taskViewToggle.querySelectorAll("button").forEach((button) => {
  button.addEventListener("click", () => setTaskLayout(button.dataset.taskLayout));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.createMenu.classList.contains("hidden")) {
    event.preventDefault(); closeCreateMenu({ focus: true }); return;
  }
  const modifier = event.metaKey || event.ctrlKey;
  if (modifier && event.shiftKey && event.key.toLowerCase() === "n") {
    event.preventDefault();
    createTask();
  } else if (modifier && event.key.toLowerCase() === "n") {
    event.preventDefault();
    createForCurrentSection();
  } else if (modifier && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (state.sidebarHidden) setSidebarHidden(false);
    elements.search.focus();
    elements.search.select();
  } else if (modifier && event.key.toLowerCase() === "s") {
    event.preventDefault();
    flushSave().then(() => showToast(state.conflict ? "Resuelve el conflicto pendiente." : "Documento guardado"));
  } else if (modifier && event.shiftKey && event.key.toLowerCase() === "p" && state.selectedId) {
    event.preventDefault();
    setView(state.view === "write" ? "preview" : "write");
  }
});

window.addEventListener("beforeunload", () => {
  drawing.finish();
  if (state.conflict) persistConflictDraft();
  else if (state.saveTimer) saveCurrent();
});

try {
  state.outlineHidden = localStorage.getItem("plainjot-outline-hidden") === "true";
  state.sidebarHidden = localStorage.getItem("plainjot-sidebar-hidden") === "true";
} catch {
  // Preferences are optional; Markdown files remain the source of truth.
}
setSidebarHidden(state.sidebarHidden, { persist: false });
const savedTheme = localStorage.getItem("plainjot-theme") || localStorage.getItem("notas-theme");
const preferredTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
applyTheme(savedTheme || preferredTheme);
loadTemplates().then(loadFolderInfo).then(loadCollections);
