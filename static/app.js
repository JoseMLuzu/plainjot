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
};

const elements = {
  list: document.querySelector("#notes-list"),
  search: document.querySelector("#search"),
  editor: document.querySelector("#editor"),
  empty: document.querySelector("#empty-state"),
  emptyKicker: document.querySelector("#empty-kicker"),
  emptyTitle: document.querySelector("#empty-title"),
  emptyCopy: document.querySelector("#empty-copy"),
  emptyButton: document.querySelector("#empty-new-item"),
  listHeading: document.querySelector("#list-heading-label"),
  notesCount: document.querySelector("#notes-count"),
  inboxCount: document.querySelector("#inbox-count"),
  tasksCount: document.querySelector("#tasks-count"),
  title: document.querySelector("#note-title"),
  body: document.querySelector("#note-body"),
  preview: document.querySelector("#markdown-preview"),
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
      JSON.stringify({ title: elements.title.value, body: elements.body.value, saved_at: new Date().toISOString() })
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
  const draft = { title: elements.title.value, body: elements.body.value };
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
    const allItems = [...state.notes, ...state.tasks];
    if (preserveSelection && state.selectedId && !allItems.some((item) => item.id === state.selectedId)) {
      clearEditor();
    }
    renderNavigation();
    renderList();
    updateDocumentMetadata();
    updateEmptyState();
  } catch (error) {
    showToast(error.message);
  }
}

function sectionItems() {
  if (state.section === "notes") return state.notes;
  if (state.section === "inbox") return state.tasks.filter((task) => task.status === "inbox");
  return state.tasks.filter((task) => task.status !== "inbox");
}

function renderNavigation() {
  const inbox = state.tasks.filter((task) => task.status === "inbox");
  const tasks = state.tasks.filter((task) => task.status !== "inbox");
  elements.notesCount.textContent = state.notes.length;
  elements.inboxCount.textContent = inbox.length;
  elements.tasksCount.textContent = tasks.length;
  document.querySelectorAll(".section-button").forEach((button) => {
    const active = button.dataset.section === state.section;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  elements.listHeading.textContent = state.section === "notes" ? "RECIENTES" : state.section.toUpperCase();
  const createsNote = state.section === "notes";
  elements.newItem.lastElementChild.textContent = createsNote ? "Nota" : "Tarea";
  elements.newItem.title = createsNote ? "Nueva nota (⌘N)" : "Nueva tarea (⌘⇧N)";
}

function renderList() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  const items = sectionItems().filter((item) =>
    `${item.title} ${item.preview} ${item.project || ""} ${item.source || ""}`
      .toLocaleLowerCase()
      .includes(query)
  );
  elements.list.replaceChildren();
  if (!items.length) {
    const message = document.createElement("p");
    message.className = "list-message";
    message.textContent = query
      ? "No encontramos nada con ese texto."
      : state.section === "notes"
        ? "Todavía no hay notas."
        : state.section === "inbox"
          ? "Inbox está limpio."
          : "Todavía no hay tareas.";
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
      preview.textContent = item.preview || "Nota vacía";
      button.append(preview);
    }
    button.addEventListener("click", () => selectDocument(item.id));
    elements.list.append(button);
  }
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
    state.section = document.type === "task" ? (document.status === "inbox" ? "inbox" : "tasks") : "notes";
    showDocument(document, { view: "preview" });
    await loadCollections();
  } catch (error) {
    showToast(error.message);
  }
}

function showDocument(document, { focus = false, view = state.view } = {}) {
  state.current = document;
  state.selectedId = document.id;
  state.conflict = null;
  hideConflictNotice();
  elements.title.value = document.title;
  elements.body.value = document.body;
  elements.empty.classList.add("hidden");
  elements.editor.classList.remove("hidden");
  if (!restoreConflictDraft(document)) setSaveStatus("Todo guardado");
  setView(view, { focus: false });
  updateEditorStats();
  updateDocumentMetadata();
  updateTaskControls();
  renderList();
  if (focus) elements.title.focus();
}

async function createNote() {
  await flushSave();
  try {
    const note = await api("/api/notes", {
      method: "POST",
      body: JSON.stringify({ title: "Nueva nota", body: "" }),
    });
    state.section = "notes";
    await loadCollections();
    await selectDocument(note.id, { view: "write", focus: true });
    elements.title.select();
  } catch (error) {
    showToast(error.message);
  }
}

async function createTask(status = "inbox") {
  await flushSave();
  try {
    const task = await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "Nueva tarea", body: "", status, project: "", source: "" }),
    });
    state.section = status === "inbox" ? "inbox" : "tasks";
    await loadCollections();
    await selectDocument(task.id, { view: "write", focus: true });
    elements.title.select();
  } catch (error) {
    showToast(error.message);
  }
}

function createForCurrentSection() {
  if (state.section === "notes") createNote();
  else createTask(state.section === "tasks" ? "todo" : "inbox");
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
    state.section = nextStatus === "inbox" ? "inbox" : "tasks";
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
  const kind = state.current.type === "task" ? "la tarea" : "la nota";
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
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  state.selectedId = null;
  state.current = null;
  state.conflict = null;
  hideConflictNotice();
  elements.editor.classList.add("hidden");
  elements.empty.classList.remove("hidden");
  elements.title.value = "";
  elements.body.value = "";
  setSaveStatus("Todo guardado");
  updateEmptyState();
  renderList();
}

async function changeSection(section) {
  if (section === state.section) return;
  await flushSave();
  state.section = section;
  if (state.selectedId && !sectionItems().some((item) => item.id === state.selectedId)) clearEditor();
  renderNavigation();
  renderList();
  updateEmptyState();
}

function updateEmptyState() {
  const content = {
    notes: ["TU ESPACIO PERSONAL", "Las ideas empiezan aquí.", "Tus notas son archivos Markdown locales que también pueden leer tus agentes.", "Crear una nota"],
    inbox: ["AGENT INBOX", "Las tareas externas llegan aquí.", "Codex, Claude Code u otras herramientas pueden escribir tareas directamente en tu carpeta PlainJot.", "Crear una tarea"],
    tasks: ["TAREAS", "Una lista pequeña y clara.", "Mueve tareas desde Inbox, complétalas y deja que Markdown siga siendo la fuente de verdad.", "Crear una tarea"],
  }[state.section];
  [elements.emptyKicker.textContent, elements.emptyTitle.textContent, elements.emptyCopy.textContent, elements.emptyButton.textContent] = content;
}

function updateTaskControls() {
  const isTask = state.current?.type === "task";
  elements.taskAction.classList.toggle("hidden", !isTask);
  elements.taskContext.classList.toggle("hidden", !isTask);
  elements.documentKind.textContent = isTask ? "Markdown task" : "Markdown note";
  if (!isTask) return;
  const labels = { inbox: "Mover a Tasks", todo: "Completar", done: "Reabrir" };
  elements.taskAction.textContent = labels[state.current.status] || "Mover a Tasks";
  elements.taskContext.replaceChildren();
  const values = [
    state.current.project && `Proyecto: ${state.current.project}`,
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
  state.view = view;
  const isPreview = view === "preview";
  elements.writeTab.classList.toggle("active", !isPreview);
  elements.writeTab.setAttribute("aria-selected", String(!isPreview));
  elements.previewTab.classList.toggle("active", isPreview);
  elements.previewTab.setAttribute("aria-selected", String(isPreview));
  elements.body.classList.toggle("hidden", isPreview);
  elements.preview.classList.toggle("hidden", !isPreview);
  if (isPreview) renderMarkdownPreview();
  else if (focus) elements.body.focus();
}

function updateEditorStats() {
  const text = elements.body.value.trim();
  const words = text ? text.split(/\s+/u).length : 0;
  elements.wordCount.textContent = `${words} ${words === 1 ? "palabra" : "palabras"}`;
  if (state.view === "preview") renderMarkdownPreview();
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
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[A-Za-z0-9._~:/?#@!$()*+,;=%-]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>'
    );
}

function markdownToHtml(markdown) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const output = [];
  let code = [];
  let inCode = false;
  let listType = null;
  const closeList = () => {
    if (listType) output.push(`</${listType}>`);
    listType = null;
  };

  for (const line of lines) {
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
      output.push(`<li>${renderInline((unordered || ordered)[1])}</li>`);
      continue;
    }
    closeList();
    if (!line.trim()) continue;
    if (/^\s*---+\s*$/.test(line)) output.push("<hr>");
    else if (line.startsWith("### ")) output.push(`<h3>${renderInline(line.slice(4))}</h3>`);
    else if (line.startsWith("## ")) output.push(`<h2>${renderInline(line.slice(3))}</h2>`);
    else if (line.startsWith("# ")) output.push(`<h1>${renderInline(line.slice(2))}</h1>`);
    else if (line.startsWith("> ")) output.push(`<blockquote>${renderInline(line.slice(2))}</blockquote>`);
    else output.push(`<p>${renderInline(line)}</p>`);
  }
  closeList();
  if (inCode && code.length) output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  return output.join("\n");
}

function renderMarkdownPreview() {
  const body = elements.body.value.trim();
  elements.preview.innerHTML = body
    ? markdownToHtml(body)
    : '<p class="preview-placeholder">La vista previa aparecerá cuando escribas algo.</p>';
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
  if (state.saveTimer || state.saving || state.loadingDocument) {
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

elements.newItem.addEventListener("click", createForCurrentSection);
elements.emptyButton.addEventListener("click", createForCurrentSection);
elements.folder.addEventListener("click", chooseNotesFolder);
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
elements.search.addEventListener("input", renderList);
elements.title.addEventListener("input", scheduleSave);
elements.body.addEventListener("input", scheduleSave);
document.querySelectorAll(".section-button").forEach((button) => {
  button.addEventListener("click", () => changeSection(button.dataset.section));
});

document.addEventListener("keydown", (event) => {
  const modifier = event.metaKey || event.ctrlKey;
  if (modifier && event.shiftKey && event.key.toLowerCase() === "n") {
    event.preventDefault();
    createTask();
  } else if (modifier && event.key.toLowerCase() === "n") {
    event.preventDefault();
    createForCurrentSection();
  } else if (modifier && event.key.toLowerCase() === "k") {
    event.preventDefault();
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
  if (state.conflict) persistConflictDraft();
  else if (state.saveTimer) saveCurrent();
});

const savedTheme = localStorage.getItem("plainjot-theme") || localStorage.getItem("notas-theme");
const preferredTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
applyTheme(savedTheme || preferredTheme);
loadFolderInfo().then(loadCollections);
