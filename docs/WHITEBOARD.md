# Whiteboard files

Drawings are Markdown notes, not a new storage system. A board lives in the active PlainJot folder and can be linked with `[Architecture](architecture.md)` from another note or journal.

````markdown
---
type: note
kind: whiteboard
project: my-app
source: codex
---

# Authentication flow

```plainjot-whiteboard
{"version":1,"width":1600,"height":1000,"elements":[{"type":"rect","color":"#294438","size":4,"start":[100,100],"end":[400,250]},{"type":"text","color":"#294438","size":4,"start":[150,150],"text":"API"},{"type":"arrow","color":"#3269a8","size":4,"start":[400,175],"end":[650,175]}]}
```
````

The body must contain exactly one `plainjot-whiteboard` fenced JSON block. Version 1 uses:

- `width`, `height`: canvas units, from 100 to 4096; the default is 1600 × 1000.
- `elements`: ordered, up to 500 drawing elements.
- Every element: `type`, six-digit hexadecimal `color`, and `size` of 2, 4, or 8.
- `pen`: `points`, an array of `[x, y]` coordinates (1–4000 per stroke; at most 20000 total).
- `rect`, `arrow`: `start` and `end` coordinates.
- `text`: `start` coordinate and nonempty `text` (at most 1000 characters; newlines allowed).

Coordinates must be finite numbers within the canvas. No raw SVG, HTML, image URLs, scripts, or external resources are accepted. The app generates inert SVG for display and export; text is escaped. Invalid data is not silently overwritten: switch to **Markdown** to inspect or repair it. Unknown format versions are rejected until supported.

Drawing changes autosave with the existing revision checks and conflict-draft recovery. Undo/redo keeps up to 50 changes in memory for the open drawing; it resets after opening another file, loading an external version, or editing the raw Markdown. Deletion uses the existing native Trash behavior. SVG exports are snapshots, not an editable source of truth; keep the Markdown file to edit a board again.
