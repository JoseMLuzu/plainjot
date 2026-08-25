const state = {
  notes: [],
  selectedId: null,
  current: null,
  saveTimer: null,
  loadingNote: false,
  view: "write",
};

const elements = {
  list: document.querySelector("#notes-list"),
  count: document.querySelector("#note-count"),
  search: document.querySelector("#search"),
  editor: document.querySelector("#editor"),
  empty: document.querySelector("#empty-state"),
  title: document.querySelector("#note-title"),
  body: document.querySelector("#note-body"),
  preview: document.querySelector("#markdown-preview"),
  status: document.querySelector("#save-status"),
  date: document.querySelector("#note-date"),
  filename: document.querySelector("#note-filename"),
  wordCount: document.querySelector("#word-count"),
  writeTab: document.querySelector("#write-tab"),
  previewTab: document.querySelector("#preview-tab"),
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
    throw new Error(payload.error || "No se pudo completar la operación");
  }
  return response.status === 204 ? null : response.json();
}

async function loadNotes({ preserveSelection = true } = {}) {
  try {
    state.notes = await api("/api/notes");
    if (preserveSelection && state.selectedId && !state.notes.some((note) => note.id === state.selectedId)) {
      clearEditor();
    }
    renderList();
    updateNoteMetadata();
  } catch (error) {
    showToast(error.message);
  }
}

function renderList() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  const notes = state.notes.filter((note) =>
    `${note.title} ${note.preview}`.toLocaleLowerCase().includes(query)
  );
  elements.count.textContent = query ? `${notes.length}/${state.notes.length}` : state.notes.length;
  elements.list.replaceChildren();
  if (!notes.length) {
    const message = document.createElement("p");
    message.className = "list-message";
    message.textContent = query ? "No encontramos ninguna nota con ese texto." : "Todavía no hay notas. Crea la primera cuando estés listo.";
    elements.list.append(message);
    return;
  }

  for (const note of notes) {
    const button = document.createElement("button");
    button.className = `note-card${note.id === state.selectedId ? " active" : ""}`;
    button.type = "button";

    const top = document.createElement("span");
    top.className = "note-card-top";
    const title = document.createElement("strong");
    title.textContent = note.title;
    const time = document.createElement("time");
    time.dateTime = note.modified;
    time.textContent = formatCompactDate(note.modified);
    top.append(title, time);

    const preview = document.createElement("span");
    preview.className = "note-preview";
    preview.textContent = note.preview || "Nota vacía";
    button.append(top, preview);
    button.addEventListener("click", () => selectNote(note.id));
    elements.list.append(button);
  }
}

async function selectNote(noteId) {
  if (state.loadingNote || noteId === state.selectedId) return;
  await flushSave();
  state.loadingNote = true;
  try {
    state.current = await api(`/api/notes/${encodeURIComponent(noteId)}`);
    state.selectedId = noteId;
    elements.title.value = state.current.title;
    elements.body.value = state.current.body;
    elements.empty.classList.add("hidden");
    elements.editor.classList.remove("hidden");
    setSaveStatus("Todo guardado");
    setView("write");
    updateEditorStats();
    updateNoteMetadata();
    renderList();
    elements.title.focus();
  } catch (error) {
    showToast(error.message);
    await loadNotes();
  } finally {
    state.loadingNote = false;
  }
}

async function createNote() {
  await flushSave();
  try {
    const note = await api("/api/notes", {
      method: "POST",
      body: JSON.stringify({ title: "Nueva nota", body: "" }),
    });
    await loadNotes();
    await selectNote(note.id);
    elements.title.select();
  } catch (error) {
    showToast(error.message);
  }
}

function scheduleSave() {
  if (!state.selectedId) return;
  setSaveStatus("Editando…");
  updateEditorStats();
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveCurrent, 650);
}

async function saveCurrent() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  if (!state.selectedId) return;
  const noteId = state.selectedId;
  setSaveStatus("Guardando…");
  try {
    state.current = await api(`/api/notes/${encodeURIComponent(noteId)}`, {
      method: "PUT",
      body: JSON.stringify({
        title: elements.title.value.trim() || "Sin título",
        body: elements.body.value,
      }),
    });
    if (state.selectedId === noteId) setSaveStatus("Todo guardado");
    await loadNotes();
  } catch (error) {
    setSaveStatus("Error al guardar");
    showToast(error.message);
  }
}

async function flushSave() {
  if (state.saveTimer) await saveCurrent();
}

async function deleteCurrent() {
  if (!state.selectedId) return;
  const title = elements.title.value.trim() || "esta nota";
  if (!window.confirm(`¿Eliminar “${title}”? Esta acción no se puede deshacer.`)) return;
  try {
    await api(`/api/notes/${encodeURIComponent(state.selectedId)}`, { method: "DELETE" });
    clearEditor();
    await loadNotes({ preserveSelection: false });
    showToast("Nota eliminada");
  } catch (error) {
    showToast(error.message);
  }
}

function clearEditor() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  state.selectedId = null;
  state.current = null;
  elements.editor.classList.add("hidden");
  elements.empty.classList.remove("hidden");
  elements.title.value = "";
  elements.body.value = "";
  setSaveStatus("Todo guardado");
  renderList();
}

function setView(view) {
  state.view = view;
  const isPreview = view === "preview";
  elements.writeTab.classList.toggle("active", !isPreview);
  elements.writeTab.setAttribute("aria-selected", String(!isPreview));
  elements.previewTab.classList.toggle("active", isPreview);
  elements.previewTab.setAttribute("aria-selected", String(isPreview));
  elements.body.classList.toggle("hidden", isPreview);
  elements.preview.classList.toggle("hidden", !isPreview);
  if (isPreview) renderMarkdownPreview();
  else elements.body.focus();
}

function updateEditorStats() {
  const text = elements.body.value.trim();
  const words = text ? text.split(/\s+/u).length : 0;
  elements.wordCount.textContent = `${words} ${words === 1 ? "palabra" : "palabras"}`;
  if (state.view === "preview") renderMarkdownPreview();
}

function updateNoteMetadata() {
  if (!state.selectedId) return;
  const note = state.notes.find((item) => item.id === state.selectedId);
  elements.filename.textContent = state.selectedId;
  elements.filename.title = state.selectedId;
  elements.date.textContent = note ? formatLongDate(note.modified) : "Ahora";
}

function formatCompactDate(value) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(date).replace(".", "");
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
  localStorage.setItem("notas-theme", theme);
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

document.querySelector("#new-note").addEventListener("click", createNote);
document.querySelector("#empty-new-note").addEventListener("click", createNote);
document.querySelector("#delete-note").addEventListener("click", deleteCurrent);
document.querySelector("#theme-toggle").addEventListener("click", toggleTheme);
elements.writeTab.addEventListener("click", () => setView("write"));
elements.previewTab.addEventListener("click", () => setView("preview"));
document.querySelector("#refresh").addEventListener("click", async () => {
  await flushSave();
  await loadNotes();
  showToast("Notas actualizadas desde la carpeta");
});
elements.search.addEventListener("input", renderList);
elements.title.addEventListener("input", scheduleSave);
elements.body.addEventListener("input", scheduleSave);

document.addEventListener("keydown", (event) => {
  const modifier = event.metaKey || event.ctrlKey;
  if (modifier && event.key.toLowerCase() === "n") {
    event.preventDefault();
    createNote();
  } else if (modifier && event.key.toLowerCase() === "k") {
    event.preventDefault();
    elements.search.focus();
    elements.search.select();
  } else if (modifier && event.key.toLowerCase() === "s") {
    event.preventDefault();
    flushSave().then(() => showToast("Nota guardada"));
  } else if (modifier && event.shiftKey && event.key.toLowerCase() === "p" && state.selectedId) {
    event.preventDefault();
    setView(state.view === "write" ? "preview" : "write");
  }
});

window.addEventListener("beforeunload", () => {
  if (state.saveTimer) saveCurrent();
});

const savedTheme = localStorage.getItem("notas-theme");
const preferredTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
applyTheme(savedTheme || preferredTheme);
loadNotes();
