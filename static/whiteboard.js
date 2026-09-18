/* Dependency-free drawing model and editor. Markdown remains the source of truth. */
(function (root) {
  "use strict";
  const MAX_ELEMENTS = 500;
  const MAX_POINTS = 20000;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const empty = () => ({ version: 1, width: 1600, height: 1000, elements: [] });

  function validate(value) {
    const fail = () => { throw new Error("Formato de pizarra inválido o demasiado grande. Revisa el bloque Markdown; no se ha cambiado el archivo."); };
    const number = (v, max) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;
    if (!value || value.version !== 1 || !number(value.width, 4096) || value.width < 100 || !number(value.height, 4096) || value.height < 100 || !Array.isArray(value.elements) || value.elements.length > MAX_ELEMENTS) fail();
    let points = 0;
    const point = (p) => {
      if (!Array.isArray(p) || p.length !== 2 || !number(p[0], value.width) || !number(p[1], value.height)) fail();
      return [...p];
    };
    const elements = value.elements.map((item) => {
      if (!item || !["pen", "rect", "arrow", "text"].includes(item.type) || typeof item.color !== "string" || !/^#[0-9a-f]{6}$/i.test(item.color) || ![2, 4, 8].includes(item.size)) fail();
      const result = { type: item.type, color: item.color, size: item.size };
      if (item.type === "pen") {
        if (!Array.isArray(item.points) || !item.points.length || item.points.length > 4000) fail();
        points += item.points.length;
        if (points > MAX_POINTS) fail();
        result.points = item.points.map(point);
      } else {
        result.start = point(item.start);
        if (item.type === "text") {
          if (typeof item.text !== "string" || !item.text.trim() || item.text.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(item.text)) fail();
          result.text = item.text;
        } else result.end = point(item.end);
      }
      return result;
    });
    return { version: 1, width: value.width, height: value.height, elements };
  }

  function parse(body) {
    const match = body.replaceAll("\r\n", "\n").trim().match(/^```plainjot-whiteboard\n([\s\S]+)\n```$/);
    if (!match) throw new Error("Esta pizarra no contiene un bloque plainjot-whiteboard válido. Puedes revisarlo en Markdown.");
    try { return validate(JSON.parse(match[1])); }
    catch (error) {
      if (error instanceof SyntaxError) throw new Error("El JSON de la pizarra no es válido. Puedes corregirlo en Markdown sin perder el archivo.");
      throw error;
    }
  }

  function serialize(board) {
    return "```plainjot-whiteboard\n" + JSON.stringify(validate(board)) + "\n```";
  }

  function elementSVG(item) {
    const style = `stroke="${item.color}" stroke-width="${item.size}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
    if (item.type === "pen") {
      if (item.points.length === 1) return `<circle cx="${item.points[0][0]}" cy="${item.points[0][1]}" r="${item.size / 2}" fill="${item.color}"/>`;
      return `<polyline points="${item.points.map((p) => p.join(",")).join(" ")}" ${style}/>`;
    }
    const [x, y] = item.start;
    if (item.type === "text") return `<text x="${x}" y="${y}" fill="${item.color}" font-family="system-ui, sans-serif" font-size="${18 + item.size * 2}" dominant-baseline="hanging">${item.text.split("\n").map((line, i) => `<tspan x="${x}" dy="${i ? "1.25em" : "0"}">${escape(line)}</tspan>`).join("")}</text>`;
    const [x2, y2] = item.end;
    if (item.type === "rect") return `<rect x="${Math.min(x, x2)}" y="${Math.min(y, y2)}" width="${Math.abs(x2 - x)}" height="${Math.abs(y2 - y)}" rx="6" ${style}/>`;
    const angle = Math.atan2(y2 - y, x2 - x);
    const length = 14 + item.size;
    const head = [angle - Math.PI / 6, angle + Math.PI / 6].map((a) => `${x2 - length * Math.cos(a)},${y2 - length * Math.sin(a)}`);
    return `<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" ${style}/><polyline points="${head[0]} ${x2},${y2} ${head[1]}" ${style}/>`;
  }

  function toSVG(board, title = "PlainJot Whiteboard") {
    const safe = validate(board);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${safe.width}" height="${safe.height}" viewBox="0 0 ${safe.width} ${safe.height}"><title>${escape(title)}</title><rect width="100%" height="100%" fill="#faf9f5"/>${safe.elements.map(elementSVG).join("")}</svg>`;
  }

  function distance(point, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
  }

  function hitTest(item, point, tolerance = 12) {
    if (item.type === "pen") return item.points.some((p, i) => distance(point, p, item.points[i + 1] || p) <= tolerance + item.size);
    if (item.type === "arrow") return distance(point, item.start, item.end) <= tolerance + item.size;
    const [x, y] = item.start;
    if (item.type === "text") {
      const lines = item.text.split("\n");
      return point[0] >= x - tolerance && point[0] <= x + Math.max(...lines.map((line) => line.length)) * (18 + item.size * 2) * .65 + tolerance && point[1] >= y - tolerance && point[1] <= y + lines.length * (18 + item.size * 2) * 1.25 + tolerance;
    }
    const [x2, y2] = item.end;
    return [[item.start, [x2, y]], [[x2, y], item.end], [item.end, [x, y2]], [[x, y2], item.start]].some(([a, b]) => distance(point, a, b) <= tolerance + item.size);
  }

  class History {
    constructor(board = empty()) { this.reset(board); }
    reset(board) { this.board = validate(board); this.undoStack = []; this.redoStack = []; }
    commit(board) {
      const next = validate(board);
      if (JSON.stringify(next) === JSON.stringify(this.board)) return false;
      this.undoStack.push(this.board);
      if (this.undoStack.length > 50) this.undoStack.shift();
      this.board = next;
      this.redoStack = [];
      return true;
    }
    undo() {
      if (!this.undoStack.length) return false;
      this.redoStack.push(this.board); this.board = this.undoStack.pop(); return true;
    }
    redo() {
      if (!this.redoStack.length) return false;
      this.undoStack.push(this.board); this.board = this.redoStack.pop(); return true;
    }
  }

  class Editor {
    constructor({ svg, error, text, undo, redo, tools, onChange, onError }) {
      Object.assign(this, { svg, error, text, undoButton: undo, redoButton: redo, tools, onChange, onError });
      this.history = new History(); this.tool = "pen"; this.color = "#294438"; this.size = 4; this.gesture = null; this.valid = false;
      svg.addEventListener("pointerdown", (event) => this.start(event));
      svg.addEventListener("pointermove", (event) => this.move(event));
      svg.addEventListener("pointerup", (event) => this.finish(event.pointerId));
      svg.addEventListener("pointercancel", () => this.cancel());
      svg.addEventListener("lostpointercapture", () => this.cancel());
      tools.forEach((button) => button.addEventListener("click", () => this.setTool(button.dataset.drawTool)));
      undo.addEventListener("click", () => this.step("undo"));
      redo.addEventListener("click", () => this.step("redo"));
      svg.addEventListener("keydown", (event) => {
        if (event.key === "Escape") this.cancel();
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
          event.preventDefault(); this.step(event.shiftKey ? "redo" : "undo");
        }
      });
    }
    load(body) {
      this.cancel();
      try {
        this.history.reset(parse(body)); this.valid = true;
        this.error.textContent = ""; this.error.classList.add("hidden");
      } catch (error) {
        this.valid = false; this.error.textContent = error.message; this.error.classList.remove("hidden");
      }
      this.svg.classList.toggle("hidden", !this.valid);
      this.render();
    }
    setTool(tool) {
      this.finish(); this.tool = tool;
      this.tools.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.drawTool === tool)));
      this.text.classList.toggle("hidden", tool !== "text");
      this.svg.style.cursor = tool === "text" ? "text" : "crosshair";
      if (tool === "text") this.text.focus();
    }
    position(event) {
      const rect = this.svg.getBoundingClientRect(), board = this.history.board;
      if (!rect.width || !rect.height) return null;
      return [Math.max(0, Math.min(board.width, (event.clientX - rect.left) * board.width / rect.width)), Math.max(0, Math.min(board.height, (event.clientY - rect.top) * board.height / rect.height))].map((n) => Math.round(n * 10) / 10);
    }
    start(event) {
      if (!this.valid || this.gesture || event.button !== 0 || event.isPrimary === false) return;
      const point = this.position(event); if (!point) return;
      event.preventDefault(); this.svg.focus();
      if (this.tool === "text") {
        if (!this.text.value.trim()) { this.text.focus(); return; }
        const board = clone(this.history.board);
        board.elements.push({ type: "text", color: this.color, size: this.size, start: point, text: this.text.value });
        this.commit(board); return;
      }
      const board = clone(this.history.board);
      const item = { type: this.tool, color: this.color, size: this.size };
      if (this.tool === "pen") item.points = [point];
      else if (this.tool !== "eraser") { item.start = point; item.end = point; }
      this.gesture = { pointerId: event.pointerId, board, item };
      if (this.tool === "eraser") this.erase(point);
      else board.elements.push(item);
      this.svg.setPointerCapture(event.pointerId); this.render(board);
    }
    erase(point) {
      const items = this.gesture.board.elements;
      for (let i = items.length - 1; i >= 0; i--) {
        if (hitTest(items[i], point)) { items.splice(i, 1); break; }
      }
    }
    move(event) {
      if (!this.gesture || this.gesture.pointerId !== event.pointerId) return;
      const point = this.position(event); if (!point) return;
      const item = this.gesture.item;
      if (this.tool === "eraser") this.erase(point);
      else if (this.tool === "pen") {
        if (item.points.length < 4000 && Math.hypot(point[0] - item.points.at(-1)[0], point[1] - item.points.at(-1)[1]) >= 2) item.points.push(point);
      } else item.end = point;
      this.render(this.gesture.board);
    }
    finish(pointerId) {
      if (!this.gesture || (pointerId !== undefined && pointerId !== this.gesture.pointerId)) return;
      const { board, pointerId: activeId } = this.gesture; this.gesture = null;
      if (this.svg.hasPointerCapture(activeId)) this.svg.releasePointerCapture(activeId);
      this.commit(board);
    }
    cancel() {
      if (!this.gesture) return;
      const id = this.gesture.pointerId; this.gesture = null;
      if (this.svg.hasPointerCapture(id)) this.svg.releasePointerCapture(id);
      this.render();
    }
    commit(board) {
      try { if (this.history.commit(board)) this.onChange(serialize(this.history.board)); }
      catch (error) { this.onError(error.message); }
      this.render();
    }
    step(direction) {
      this.finish();
      if (this.valid && this.history[direction]()) this.onChange(serialize(this.history.board));
      this.render();
    }
    render(board = this.history.board) {
      this.undoButton.disabled = !this.valid || !this.history.undoStack.length;
      this.redoButton.disabled = !this.valid || !this.history.redoStack.length;
      if (!this.valid) return;
      this.svg.setAttribute("viewBox", `0 0 ${board.width} ${board.height}`);
      this.svg.style.aspectRatio = `${board.width} / ${board.height}`;
      this.svg.innerHTML = board.elements.map(elementSVG).join("");
    }
  }

  const api = { empty, validate, parse, serialize, toSVG, hitTest, History, Editor };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PlainJotWhiteboard = api;
})(globalThis);
