# Changelog

All notable changes are documented here. PlainJot follows semantic versioning once releases are tagged.

## Unreleased

### Added

- Markdown-backed whiteboards with pen, eraser, rectangles, arrows, text, undo/redo, and safe SVG export
- Developer note templates, including a Debug Journal with six debugging sections
- Debug Journal Markdown notes supported by both storage cores and the CLI
- Shared project metadata and filtering across notes, journals, tasks, and Sprint View
- One developer template catalog for the app and CLI: tickets, roadmaps, decisions, refactoring, reviews, and session handoffs
- Same-folder Markdown references and read-only checklist rendering in preview
- Markdown tasks with YAML frontmatter and `inbox`, `todo`, and `done` states
- Agent Inbox and Tasks sections in the shared interface
- Native debounced filesystem watcher
- Dependency-free `plainjot` CLI
- Reusable Python and Swift filesystem cores
- CI, release archive tooling, and contributor documentation
- Native opening and selection of Markdown files inside the PlainJot folder
- Native folder picker with a shared app and CLI location
- Recoverable draft conflict resolution for external edits
- Optional Sprint View for tasks, grouped as Inbox, To do, and Done
- Clickable document outline generated from Markdown headings

### Changed

- Compact document titles scroll with the reading preview; the right outline can be hidden to expand the document, with its visibility remembered locally
- Two-section navigation: Documents collects notes, developer templates, and whiteboards; Tasks contains Inbox/Pending/Done filters, with one direct Create menu
- Grouped sidebar navigation and filters, with consistently styled keyboard-accessible native dropdowns

- Existing notes and tasks open in preview, while newly created documents open in write mode
- Native deletions move Markdown files to the macOS Trash
- Long document titles wrap across lines without overlapping the outline

### Security

- Explicit symlink rejection and optimistic revision checks for external edits
- Conflicting local drafts remain stored until the user resolves them

## 0.1.0 — Initial foundation

- Local Markdown notes
- Native WebKit macOS application
- Python development server
- Search, autosave, Markdown preview, and light/dark themes
