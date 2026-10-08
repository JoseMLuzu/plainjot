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
  switcherIndex: 0,
  switcherItems: [],
  switcherReturnFocus: null,
  switchingDocument: false,
  pendingParent: "",
};

function isWhiteboard(item) {
  return item?.type === "note" && item.kind === "whiteboard";
}

function nextTaskStatus(status) {
  return status === "inbox" ? "todo" : status === "todo" ? "done" : "todo";
}

function taskStatusAction(status) {
  return {
    inbox: "Aceptar y mover a Pendientes",
    todo: "Marcar como hecha",
    done: "Reabrir en Pendientes",
  }[status] || "Cambiar estado";
}

function sectionForDocument(item) {
  return item.type === "task" ? "tasks" : item.kind === "analysis" ? "analysis" : "notes";
}

function documentTypeLabel(item) {
  if (item.type === "task") return "Tarea";
  if (isWhiteboard(item)) return "Pizarra";
  return state.templates.find((template) => template.id === item.kind)?.label || (item.kind === "analysis" ? "Análisis" : item.kind || "Nota");
}

const elements = {
  shell: document.querySelector("#app-shell"),
  sidebar: document.querySelector("#notes-sidebar"),
  sidebarToggle: document.querySelector("#sidebar-toggle"),
  contextProject: document.querySelector("#context-project"),
  contextKind: document.querySelector("#context-kind"),
  noteType: document.querySelector("#document-type-select"),
  documentParent: document.querySelector("#document-parent"),
  projectMapNav: document.querySelector("#project-map-nav"),
  mapCount: document.querySelector("#map-count"),
  projectMap: document.querySelector("#project-map"),
  projectMapTitle: document.querySelector("#project-map-title"),
  projectMapSummary: document.querySelector("#project-map-summary"),
  projectMapTree: document.querySelector("#project-map-tree"),
  projectMapCreate: document.querySelector("#project-map-create"),
  mapLayoutToggle: document.querySelector("#map-layout-toggle"),
  switcher: document.querySelector("#document-switcher"),
  switcherSearch: document.querySelector("#switcher-search"),
  switcherResults: document.querySelector("#switcher-results"),
  switcherClose: document.querySelector("#switcher-close"),
  switcherToggle: document.querySelector("#switcher-toggle"),
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
  analysisCount: document.querySelector("#analysis-count"),
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
      JSON.stringify({ ...editorDraft(), saved_at: new Date().toISOString() })
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
    renderDocumentTypes(draft.kind ?? externalDocument.kind ?? "");
    renderParentOptions(draft.parent ?? externalDocument.parent ?? "");
    resizeTitle();
  }
  persistConflictDraft();
  elements.conflictBanner.classList.remove("hidden");
  setSaveStatus("Conflicto pendiente");
  updateEditorStats();
  updateWorkspaceContext();
}

function restoreConflictDraft(document) {
  const draft = readConflictDraft(document.id);
  if (!draft) return false;
  activateConflict(document, draft);
  return true;
}

async function enterSaveConflict(documentId) {
  if (state.selectedId !== documentId || !state.current) return;
  const draft = editorDraft();
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
      body: JSON.stringify(documentUpdatePayload(state.conflict.external.revision)),
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
  const items = section === "map" ? [...state.notes, ...state.tasks]
    : section === "tasks" ? state.tasks.filter((task) => task.status === state.taskFilter)
    : state.notes.filter((note) => sectionForDocument(note) === section);
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

function renderDocumentTypes(kind = state.current?.kind || "") {
  elements.noteType.replaceChildren();
  const types = [{ id: "", label: "Nota" }, ...state.templates.filter((item) => item.type === "note")];
  if (!types.some((item) => item.id === kind)) types.push({ id: kind, label: documentTypeLabel({ type: "note", kind }) });
  for (const item of types) {
    const option = document.createElement("option");
    option.value = item.id; option.textContent = item.label;
    elements.noteType.append(option);
  }
  elements.noteType.value = kind;
}

function renderParentOptions(parent = state.current?.parent || "") {
  elements.documentParent.replaceChildren();
  const root = document.createElement("option");
  root.value = ""; root.textContent = "Raíz del proyecto";
  elements.documentParent.append(root);
  const project = elements.documentProject.value || state.current?.project || "";
  const candidates = [...state.notes, ...state.tasks]
    .filter((item) => item.id !== state.selectedId && item.project === project)
    .sort((a, b) => a.title.localeCompare(b.title));
  for (const item of candidates) {
    const option = document.createElement("option");
    option.value = item.id; option.textContent = `${item.title} · ${documentTypeLabel(item)}`;
    elements.documentParent.append(option);
  }
  if (parent && !candidates.some((item) => item.id === parent)) {
    const missing = document.createElement("option");
    missing.value = parent; missing.textContent = `Referencia no encontrada · ${parent}`;
    elements.documentParent.append(missing);
  }
  elements.documentParent.value = parent;
}

function projectDocuments() {
  return [...state.notes, ...state.tasks].filter((item) => item.project === state.project);
}

function beginRelatedCreation(parent = "", event = null) {
  event?.stopPropagation();
  state.pendingParent = parent;
  if (state.sidebarHidden) setSidebarHidden(false);
  if (!elements.createMenu.classList.contains("hidden")) closeCreateMenu();
  toggleCreateMenu();
}

const MAP_PROJECT_ID = "__project__";
const MAP_NODE_WIDTH = 300;
const MAP_NODE_HEIGHT = 78;
const MAP_PROJECT_WIDTH = 210;

function mapLayoutKey() {
  return `plainjot-map-layout:${state.folder?.path || "default"}:${state.project}`;
}

function readMapLayout() {
  try {
    const value = JSON.parse(localStorage.getItem(mapLayoutKey()) || "null");
    const direction = ["horizontal", "vertical"].includes(value?.direction) ? value.direction : "horizontal";
    const positions = {};
    for (const [id, position] of Object.entries(value?.positions || {})) {
      if (Number.isFinite(position?.x) && Number.isFinite(position?.y)) {
        positions[id] = { x: Math.max(12, position.x), y: Math.max(12, position.y) };
      }
    }
    return { direction, positions };
  } catch {
    return { direction: "horizontal", positions: {} };
  }
}

function writeMapLayout(direction, positions) {
  try {
    localStorage.setItem(mapLayoutKey(), JSON.stringify({ direction, positions }));
  } catch {
    showToast("No se pudo guardar la posición del mapa.");
  }
}

function mapDepth(item, byId, memo, path = new Set()) {
  if (memo.has(item.id)) return memo.get(item.id);
  if (path.has(item.id)) return 0;
  const parent = byId.get(item.parent);
  if (!parent) { memo.set(item.id, 0); return 0; }
  const nextPath = new Set(path); nextPath.add(item.id);
  const depth = mapDepth(parent, byId, memo, nextPath) + 1;
  memo.set(item.id, depth);
  return depth;
}

function automaticMapPositions(items, direction) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const memo = new Map();
  const groups = new Map();
  const ordered = [...items].sort((a, b) => new Date(b.modified) - new Date(a.modified) || a.title.localeCompare(b.title));
  for (const item of ordered) {
    const depth = mapDepth(item, byId, memo);
    if (!groups.has(depth)) groups.set(depth, []);
    groups.get(depth).push(item);
  }

  const positions = {};
  const roots = groups.get(0) || [];
  if (direction === "vertical") {
    positions[MAP_PROJECT_ID] = { x: Math.max(32, ((roots.length - 1) * 320) / 2 + 76), y: 24 };
    for (const [depth, values] of groups) {
      values.forEach((item, index) => { positions[item.id] = { x: 28 + index * 320, y: 164 + depth * 138 }; });
    }
  } else {
    positions[MAP_PROJECT_ID] = { x: 24, y: Math.max(28, ((roots.length - 1) * 116) / 2 + 28) };
    for (const [depth, values] of groups) {
      values.forEach((item, index) => { positions[item.id] = { x: 290 + depth * 350, y: 24 + index * 116 }; });
    }
  }
  return positions;
}

function completeMapLayout(items, stored) {
  const automatic = automaticMapPositions(items, stored.direction);
  const allowed = new Set([MAP_PROJECT_ID, ...items.map((item) => item.id)]);
  const positions = {};
  for (const id of allowed) positions[id] = stored.positions[id] || automatic[id];
  return { direction: stored.direction, positions };
}

function mapNodeSize(id) {
  return { width: id === MAP_PROJECT_ID ? MAP_PROJECT_WIDTH : MAP_NODE_WIDTH, height: MAP_NODE_HEIGHT };
}

function mapConnectionPath(fromId, toId, positions) {
  const from = positions[fromId];
  const to = positions[toId];
  if (!from || !to) return "";
  const fromSize = mapNodeSize(fromId);
  const toSize = mapNodeSize(toId);
  const fromCenter = { x: from.x + fromSize.width / 2, y: from.y + fromSize.height / 2 };
  const toCenter = { x: to.x + toSize.width / 2, y: to.y + toSize.height / 2 };
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const direction = dx >= 0 ? 1 : -1;
    const start = { x: fromCenter.x + direction * fromSize.width / 2, y: fromCenter.y };
    const end = { x: toCenter.x - direction * toSize.width / 2, y: toCenter.y };
    const bend = Math.max(36, Math.abs(end.x - start.x) / 2);
    return `M ${start.x} ${start.y} C ${start.x + direction * bend} ${start.y}, ${end.x - direction * bend} ${end.y}, ${end.x} ${end.y}`;
  }
  const direction = dy >= 0 ? 1 : -1;
  const start = { x: fromCenter.x, y: fromCenter.y + direction * fromSize.height / 2 };
  const end = { x: toCenter.x, y: toCenter.y - direction * toSize.height / 2 };
  const bend = Math.max(30, Math.abs(end.y - start.y) / 2);
  return `M ${start.x} ${start.y} C ${start.x} ${start.y + direction * bend}, ${end.x} ${end.y - direction * bend}, ${end.x} ${end.y}`;
}

function sizeMapCanvas(canvas, svg, positions) {
  let width = 760;
  let height = 500;
  for (const [id, position] of Object.entries(positions)) {
    const size = mapNodeSize(id);
    width = Math.max(width, position.x + size.width + 80);
    height = Math.max(height, position.y + size.height + 80);
  }
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
}

function drawMapConnections(svg, items, positions) {
  svg.replaceChildren();
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const item of items) {
    const fromId = item.parent && byId.has(item.parent) ? item.parent : MAP_PROJECT_ID;
    const pathData = mapConnectionPath(fromId, item.id, positions);
    if (!pathData) continue;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "map-connection");
    path.setAttribute("d", pathData);
    svg.append(path);
  }
}

function mapRelationshipWarning(item, byId) {
  if (item.parent && !byId.has(item.parent)) return `Referencia no encontrada: ${item.parent}`;
  const visited = new Set([item.id]);
  let current = item.parent;
  while (current && byId.has(current)) {
    if (visited.has(current)) return "Relación circular detectada";
    visited.add(current);
    current = byId.get(current).parent;
  }
  return "";
}

function positionMapElement(element, position) {
  element.style.left = `${position.x}px`;
  element.style.top = `${position.y}px`;
}

function enableMapDrag(handle, element, id, direction, positions, items, canvas, svg, onOpen = null) {
  let gesture = null;
  let suppressClickUntil = 0;
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    const position = positions[id];
    gesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: position.x, top: position.y, moved: false };
    handle.setPointerCapture?.(event.pointerId);
    element.classList.add("drag-ready");
  });
  handle.addEventListener("pointermove", (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) < 4) return;
    gesture.moved = true;
    event.preventDefault?.();
    positions[id] = { x: Math.max(12, gesture.left + dx), y: Math.max(12, gesture.top + dy) };
    positionMapElement(element, positions[id]);
    element.classList.add("dragging");
    sizeMapCanvas(canvas, svg, positions);
    drawMapConnections(svg, items, positions);
  });
  const finish = (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (gesture.moved) {
      suppressClickUntil = Date.now() + 300;
      writeMapLayout(direction, positions);
    }
    handle.releasePointerCapture?.(event.pointerId);
    element.classList.remove("drag-ready", "dragging");
    gesture = null;
  };
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  if (onOpen) handle.addEventListener("click", () => {
    if (Date.now() >= suppressClickUntil) onOpen();
  });
}

function setMapDirection(direction) {
  if (!["horizontal", "vertical"].includes(direction) || !state.project) return;
  const positions = automaticMapPositions(projectDocuments(), direction);
  writeMapLayout(direction, positions);
  renderProjectMap();
}

function renderProjectMap() {
  if (!state.project) return;
  const items = projectDocuments();
  elements.projectMapTitle.textContent = state.project;
  const taskCount = items.filter((item) => item.type === "task").length;
  elements.projectMapSummary.textContent = `${items.length} documentos · ${taskCount} ${taskCount === 1 ? "tarea" : "tareas"}`;
  elements.projectMapTree.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("p"); empty.className = "project-map-empty";
    empty.textContent = "Este proyecto todavía no tiene documentos. Crea una idea, un roadmap o un análisis para empezar su historia.";
    elements.projectMapTree.append(empty); return;
  }
  const byId = new Map(items.map((item) => [item.id, item]));
  const layout = completeMapLayout(items, readMapLayout());
  elements.mapLayoutToggle.querySelectorAll("button").forEach((button) => {
    const active = button.dataset.mapDirection === layout.direction;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const canvas = document.createElement("div"); canvas.className = "project-map-canvas";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "map-connections");
  const projectRoot = document.createElement("div"); projectRoot.className = "map-project-root";
  const projectTitle = document.createElement("strong"); projectTitle.textContent = state.project;
  const projectType = document.createElement("span"); projectType.textContent = "Proyecto · arrastra para mover";
  projectRoot.append(projectTitle, projectType);
  projectRoot.setAttribute("aria-label", `Proyecto ${state.project}. Arrastra para mover.`);
  positionMapElement(projectRoot, layout.positions[MAP_PROJECT_ID]);
  enableMapDrag(projectRoot, projectRoot, MAP_PROJECT_ID, layout.direction, layout.positions, items, canvas, svg);
  canvas.append(svg, projectRoot);

  for (const item of items) {
    const row = document.createElement("div"); row.className = "map-node-row"; row.dataset.documentId = item.id;
    positionMapElement(row, layout.positions[item.id]);
    const open = document.createElement("button"); open.type = "button"; open.className = "map-node-open";
    open.setAttribute("aria-label", `Abrir ${item.title}. Arrastra para mover.`);
    const title = document.createElement("strong"); title.textContent = item.title;
    const type = document.createElement("span"); type.textContent = `${documentTypeLabel(item)} · arrastra para mover`;
    open.append(title, type);
    enableMapDrag(open, row, item.id, layout.direction, layout.positions, items, canvas, svg, () => openDocumentFromSystem(item.id));
    const add = document.createElement("button"); add.type = "button"; add.className = "map-node-add";
    add.textContent = "+"; add.title = "Crear una rama desde este documento"; add.setAttribute("aria-label", `Crear documento relacionado con ${item.title}`);
    add.addEventListener("click", (event) => beginRelatedCreation(item.id, event));
    row.append(open, add);
    const warningText = mapRelationshipWarning(item, byId);
    if (warningText) {
      const warning = document.createElement("span"); warning.className = "map-node-warning"; warning.textContent = warningText; row.append(warning);
    }
    canvas.append(row);
  }
  sizeMapCanvas(canvas, svg, layout.positions);
  drawMapConnections(svg, items, layout.positions);
  elements.projectMapTree.append(canvas);
}

function updateWorkspaceContext() {
  const current = state.current;
  const project = current ? (elements.documentProject.value || "Sin proyecto") : (state.project || "Todos los proyectos");
  const item = current?.type === "note" && !isWhiteboard(current) ? { ...current, kind: elements.noteType.value } : current;
  const kind = item ? documentTypeLabel(item) : { map: "Mapa", notes: "Notas", analysis: "Análisis", tasks: "Tareas" }[state.section];
  elements.contextProject.textContent = project;
  elements.contextProject.title = project;
  elements.contextKind.textContent = kind;
  elements.contextKind.title = kind;
}

function openQuickSwitcher() {
  closeCreateMenu();
  state.switcherReturnFocus = document.activeElement;
  elements.switcherSearch.value = "";
  elements.switcher.classList.remove("hidden");
  elements.shell.inert = true;
  renderQuickSwitcher();
  elements.switcherSearch.focus();
}

function closeQuickSwitcher({ restoreFocus = true } = {}) {
  elements.switcher.classList.add("hidden");
  elements.shell.inert = false;
  if (restoreFocus) {
    const target = state.switcherReturnFocus?.isConnected ? state.switcherReturnFocus : elements.switcherToggle;
    target.focus();
  }
}

function renderQuickSwitcher() {
  const terms = elements.switcherSearch.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  state.switcherItems = [...state.notes, ...state.tasks]
    .filter((item) => terms.every((term) => `${item.title} ${item.project || ""} ${item.source || ""} ${documentTypeLabel(item)}`.toLocaleLowerCase().includes(term)))
    .sort((a, b) => new Date(b.modified) - new Date(a.modified)).slice(0, 50);
  state.switcherIndex = 0;
  elements.switcherResults.replaceChildren();
  if (!state.switcherItems.length) {
    const empty = document.createElement("p"); empty.className = "switcher-empty";
    empty.textContent = "No hay documentos con ese título o proyecto.";
    elements.switcherResults.append(empty);
  }
  state.switcherItems.forEach((item, index) => {
    const button = document.createElement("button"); button.type = "button";
    const title = document.createElement("strong"); title.textContent = item.title;
    const detail = document.createElement("span"); detail.textContent = `${item.project || "Sin proyecto"} · ${documentTypeLabel(item)}`;
    button.append(title, detail);
    button.addEventListener("click", () => openQuickDocument(item.id));
    button.addEventListener("focus", () => setQuickSwitcherIndex(index, { scroll: false }));
    elements.switcherResults.append(button);
  });
  setQuickSwitcherIndex(0, { scroll: false });
}

function setQuickSwitcherIndex(index, { scroll = true } = {}) {
  const buttons = [...elements.switcherResults.querySelectorAll("button")];
  if (!buttons.length) return;
  state.switcherIndex = (index + buttons.length) % buttons.length;
  buttons.forEach((button, i) => {
    button.classList.toggle("active", i === state.switcherIndex);
    if (i === state.switcherIndex) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  });
  if (scroll) buttons[state.switcherIndex].scrollIntoView({ block: "nearest" });
}

async function openQuickDocument(id = state.switcherItems[state.switcherIndex]?.id) {
  if (!id || state.switchingDocument) return;
  state.switchingDocument = true;
  closeQuickSwitcher({ restoreFocus: false });
  try {
    await openDocumentFromSystem(id);
    if (state.selectedId) {
      if (isWhiteboard(state.current)) drawing.svg.focus();
      else elements.preview.focus({ preventScroll: true });
    }
  } finally { state.switchingDocument = false; }
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
    ["Documentos", [{ id: "note", label: "Nota" }, ...state.templates.filter((item) => item.id === "analysis"), { id: "whiteboard", label: "Pizarra" }]],
    ["Tareas", [{ id: "task", label: "Tarea" }, ...state.templates.filter((item) => item.type === "task")]],
    ["Plantillas", state.templates.filter((item) => item.type === "note" && item.id !== "analysis")],
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
  const parent = [...state.notes, ...state.tasks].find((item) => item.id === state.pendingParent);
  elements.createContext.textContent = parent ? `Dentro de: ${parent.title}` : state.project ? `Proyecto: ${state.project}` : "Sin proyecto · archivos locales";
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
  } finally { state.pendingParent = ""; state.creating = false; elements.newItem.disabled = false; }
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
  state.section = project ? "map" : state.section === "map" ? "notes" : state.section;
  clearEditor();
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
  const projectItems = projectDocuments();
  elements.projectMapNav.classList.toggle("hidden", !state.project);
  elements.mapCount.textContent = projectItems.length;
  elements.notesCount.textContent = sectionItems("notes").length;
  elements.analysisCount.textContent = sectionItems("analysis").length;
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
  elements.listHeading.textContent = state.section === "map" ? "EN ESTE PROYECTO" : state.section !== "tasks" ? "RECIENTES" : isSprintView() ? "TODAS LAS TAREAS" : { inbox: "POR REVISAR", todo: "PENDIENTES", done: "COMPLETADAS" }[state.taskFilter];
  elements.taskViewToggle.classList.toggle("hidden", state.section !== "tasks");
  elements.taskViewToggle.querySelectorAll("button").forEach((button) => {
    const active = button.dataset.taskLayout === state.taskLayout;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  elements.newItem.lastElementChild.textContent = "Crear";
  elements.newItem.title = "Crear documento o tarea (⌘N)";
  updateWorkspaceContext();
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
      : state.section === "map" ? "Este proyecto todavía no tiene documentos." : state.section === "analysis" ? "Todavía no hay análisis." : state.section === "notes" ? "Todavía no hay notas."
        : { inbox: "Inbox está limpio.", todo: "No hay tareas pendientes.", done: "Todavía no hay tareas completadas." }[state.taskFilter];
    elements.list.append(message);
    return;
  }

  for (const item of items) {
    const card = document.createElement(item.type === "task" ? "div" : "button");
    card.className = `note-card${item.type === "task" ? " task-list-card" : ""}${item.id === state.selectedId ? " active" : ""}${item.status === "done" ? " done" : ""}`;
    let content = card;

    if (item.type === "task") {
      const mark = document.createElement("button");
      mark.className = "task-mark";
      mark.type = "button";
      mark.textContent = item.status === "done" ? "✓" : "";
      mark.title = taskStatusAction(item.status);
      mark.setAttribute("aria-label", `${taskStatusAction(item.status)}: ${item.title}`);
      mark.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        mark.disabled = true;
        try {
          await moveTaskToStatus(item.id, nextTaskStatus(item.status));
        } finally {
          mark.disabled = false;
        }
      });

      content = document.createElement("button");
      content.className = "task-card-open";
      content.type = "button";
      content.setAttribute("aria-label", `Abrir tarea: ${item.title}`);
      content.addEventListener("click", () => selectDocument(item.id));
      card.append(mark, content);
    } else {
      card.type = "button";
      card.addEventListener("click", () => selectDocument(item.id));
    }

    const top = document.createElement("span");
    top.className = "note-card-top";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const time = document.createElement("time");
    time.dateTime = item.modified;
    time.textContent = item.type === "task" ? formatRelativeDate(item.modified) : formatCompactDate(item.modified);
    top.append(title, time);
    content.append(top);

    if (item.type === "task") {
      const context = document.createElement("span");
      context.className = "task-card-context";
      context.textContent = [item.project, item.source].filter(Boolean).map(capitalize).join(" · ") || "Sin proyecto";
      content.append(context);
    } else {
      const preview = document.createElement("span");
      preview.className = "note-preview";
      preview.textContent = isWhiteboard(item) ? (item.project || "Dibujo local · Markdown") : item.preview || "Nota vacía";
      content.append(preview);
      const kind = document.createElement("span");
      kind.className = "document-type";
      kind.textContent = isWhiteboard(item) ? "Pizarra" : state.templates.find((template) => template.id === item.kind)?.label || item.kind || "Nota";
      content.append(kind);
    }
    elements.list.append(card);
  }
}

let sprintDraggedTaskId = "";
let suppressSprintClickUntil = 0;

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
    column.dataset.taskStatus = definition.status;
    column.addEventListener("dragover", (event) => {
      if (!sprintDraggedTaskId) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      column.classList.add("drop-target");
    });
    column.addEventListener("dragleave", (event) => {
      if (!event.relatedTarget || !column.contains(event.relatedTarget)) column.classList.remove("drop-target");
    });
    column.addEventListener("drop", async (event) => {
      event.preventDefault();
      column.classList.remove("drop-target");
      const taskId = sprintDraggedTaskId || event.dataTransfer?.getData("text/plain") || "";
      sprintDraggedTaskId = "";
      suppressSprintClickUntil = Date.now() + 250;
      if (taskId) await moveTaskToStatus(taskId, definition.status);
    });

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
      card.draggable = true;
      card.setAttribute("draggable", "true");
      card.setAttribute("aria-label", `Abrir tarea: ${task.title}. Arrástrala para cambiar su estado.`);

      const cardTitle = document.createElement("strong");
      cardTitle.textContent = task.title;
      const context = document.createElement("span");
      context.textContent = [task.project, task.source].filter(Boolean).map(capitalize).join(" · ") || "Sin proyecto";
      const time = document.createElement("time");
      time.dateTime = task.modified;
      time.textContent = formatRelativeDate(task.modified);
      card.append(cardTitle, context, time);
      card.addEventListener("dragstart", (event) => {
        sprintDraggedTaskId = task.id;
        card.classList.add("dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", task.id);
        }
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
        sprintDraggedTaskId = "";
        suppressSprintClickUntil = Date.now() + 250;
      });
      card.addEventListener("click", () => {
        if (Date.now() < suppressSprintClickUntil) return;
        openTaskFromSprint(task.id);
      });
      taskList.append(card);
    }

    column.append(taskList);
    elements.sprintColumns.append(column);
  }
}

function updateWorkspaceMode() {
  const sprint = isSprintView();
  const map = state.section === "map" && Boolean(state.project);
  elements.sprintBoard.classList.toggle("hidden", !sprint);
  elements.projectMap.classList.toggle("hidden", !map);
  if (map) {
    elements.empty.classList.add("hidden");
    elements.editor.classList.add("hidden");
    renderProjectMap();
  } else if (sprint) {
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

async function moveTaskToStatus(documentId, status) {
  if (!["inbox", "todo", "done"].includes(status)) return null;
  if (state.current?.id === documentId) await flushSave();
  const task = state.current?.id === documentId
    ? state.current
    : state.tasks.find((candidate) => candidate.id === documentId);
  if (!task || task.type !== "task" || task.status === status) return task || null;

  try {
    const updated = await api(`/api/tasks/${encodeURIComponent(documentId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status, expected_revision: task.revision }),
    });
    if (state.selectedId === documentId) clearEditor();
    await loadCollections();
    showToast({ inbox: "Tarea movida a Inbox", todo: "Tarea movida a Pendientes", done: "Tarea completada" }[status]);
    return updated;
  } catch (error) {
    if (error.status === 409 && state.current?.id === documentId) await enterSaveConflict(documentId);
    else if (error.status === 409) await loadCollections();
    showToast(error.message);
    return null;
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
    if (!matchesProject(document)) state.project = "";
    state.section = sectionForDocument(document);
    if (document.type === "task") state.taskFilter = document.status;
    showDocument(document, { view: "preview" });
    await loadCollections();
  } catch (error) {
    showToast(error.message);
  }
}

function showDocument(document, { focus = false, view = state.view } = {}) {
  const changedDocument = state.selectedId !== document.id;
  drawing.cancel();
  if (state.taskLayout === "sprint") state.taskLayout = "list";
  state.current = document;
  state.section = sectionForDocument(document);
  if (document.type === "task") state.taskFilter = document.status;
  state.selectedId = document.id;
  state.conflict = null;
  hideConflictNotice();
  elements.title.value = document.title;
  elements.body.value = document.body;
  elements.documentProject.value = document.project || "";
  renderDocumentTypes(document.kind || "");
  renderParentOptions(document.parent || "");
  if (!restoreConflictDraft(document)) setSaveStatus("Todo guardado");
  setView(view, { focus: false });
  updateEditorStats();
  updateDocumentMetadata();
  updateTaskControls();
  renderNavigation();
  renderList();
  updateWorkspaceMode();
  if (changedDocument) {
    elements.preview.scrollTop = 0;
    elements.body.scrollTop = 0;
  }
  resizeTitle();
  updateOutlineActive();
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
        parent: state.pendingParent,
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
      body: JSON.stringify({ title: template?.title || "Nueva tarea", body: template?.body || "", status, project: state.project, source: "", parent: state.pendingParent }),
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
      body: JSON.stringify({ title: "Nueva pizarra", body: PlainJotWhiteboard.serialize(PlainJotWhiteboard.empty()), kind: "whiteboard", project: state.project, parent: state.pendingParent }),
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
  state.pendingParent = "";
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

function editorDraft() {
  return { title: elements.title.value, body: elements.body.value, project: elements.documentProject.value, parent: elements.documentParent.value, kind: elements.noteType.value };
}

function documentUpdatePayload(revision) {
  const { kind, parent, ...draft } = editorDraft();
  return { ...draft, title: draft.title.trim() || "Sin título", expected_revision: revision,
    ...(parent !== (state.current?.parent || "") ? { parent } : {}),
    ...(state.current?.type === "note" && !isWhiteboard(state.current) && kind !== (state.current.kind || "") ? { kind } : {}) };
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
      body: JSON.stringify(documentUpdatePayload(state.current.revision)),
    });
    if (state.selectedId === documentId) {
      state.current = updated;
      state.section = sectionForDocument(updated);
      updateTaskControls();
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
  const nextStatus = nextTaskStatus(state.current.status);
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
  updateWorkspaceContext();
  renderDocumentOutline();
  setSaveStatus("Todo guardado");
  updateEmptyState();
  renderList();
  updateWorkspaceMode();
}

async function changeSection(section) {
  if (!["map", "notes", "analysis", "tasks"].includes(section) || (section === "map" && !state.project)) return;
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
  const content = state.section === "analysis"
    ? ["ANÁLISIS", "Entiende antes de cambiar.", "Investigaciones, hallazgos y recomendaciones, separados de tus notas. Pulsa + Crear y elige Análisis.", "＋ Crear"]
    : state.section === "notes"
    ? ["NOTAS", "Una libreta para tu trabajo.", "Journals, roadmaps, decisiones y pizarras. Abre una nota o pulsa + Crear para empezar.", "＋ Crear"]
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
  elements.documentKind.textContent = `${state.current ? documentTypeLabel(state.current) : "Nota"} · Markdown`;
  if (!isTask) return;
  const labels = { inbox: "Aceptar tarea", todo: "Completar", done: "Reabrir" };
  elements.taskAction.textContent = labels[state.current.status] || "Mover a Tasks";
  elements.taskContext.replaceChildren();
  const values = [
    state.current.source && `Fuente: ${state.current.source}`,
    `Estado: ${state.current.status}`,
    state.current.parent && `Depende de: ${state.current.parent}`,
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
  elements.documentParent.parentElement.classList.toggle("hidden", isPreview || !elements.documentProject.value);
  elements.noteType.parentElement.parentElement.classList.toggle("hidden", isPreview || board || state.current?.type === "task");
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
elements.documentProject.addEventListener("input", () => {
  renderParentOptions(elements.documentParent.value);
  elements.documentParent.parentElement.classList.toggle("hidden", !elements.documentProject.value);
  updateWorkspaceContext(); scheduleSave();
});
elements.documentParent.addEventListener("change", scheduleSave);
elements.noteType.addEventListener("change", () => { updateWorkspaceContext(); scheduleSave(); });
elements.switcherToggle.addEventListener("click", openQuickSwitcher);
elements.switcherClose.addEventListener("click", () => closeQuickSwitcher());
elements.switcherSearch.addEventListener("input", renderQuickSwitcher);
elements.switcher.addEventListener("click", (event) => { if (event.target === elements.switcher) closeQuickSwitcher(); });
elements.projectMapCreate.addEventListener("click", (event) => beginRelatedCreation("", event));
elements.mapLayoutToggle.querySelectorAll("button").forEach((button) => {
  button.addEventListener("click", () => setMapDirection(button.dataset.mapDirection));
});
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
  const modifier = event.metaKey || event.ctrlKey;
  if (modifier && event.key.toLowerCase() === "p" && !event.shiftKey) {
    event.preventDefault();
    if (elements.switcher.classList.contains("hidden")) openQuickSwitcher();
    else closeQuickSwitcher();
    return;
  }
  if (!elements.switcher.classList.contains("hidden")) {
    if (event.key === "Escape") { event.preventDefault(); closeQuickSwitcher(); }
    else if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setQuickSwitcherIndex(state.switcherIndex + (event.key === "ArrowDown" ? 1 : -1)); }
    else if (event.key === "Enter" && event.target !== elements.switcherClose) { event.preventDefault(); openQuickDocument(); }
    else if (event.key === "Tab") {
      event.preventDefault();
      const controls = [elements.switcherSearch, ...elements.switcherResults.querySelectorAll("button"), elements.switcherClose];
      const index = controls.indexOf(document.activeElement);
      controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
    }
    return;
  }
  if (event.key === "Escape" && !elements.createMenu.classList.contains("hidden")) {
    event.preventDefault(); closeCreateMenu({ focus: true }); return;
  }
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
