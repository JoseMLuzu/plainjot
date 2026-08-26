# Changelog

All notable changes are documented here. PlainJot follows semantic versioning once releases are tagged.

## Unreleased

### Added

- Markdown tasks with YAML frontmatter and `inbox`, `todo`, and `done` states
- Agent Inbox and Tasks sections in the shared interface
- Native debounced filesystem watcher
- Dependency-free `plainjot` CLI
- Reusable Python and Swift filesystem cores
- CI, release archive tooling, and contributor documentation
- Native opening and selection of Markdown files inside the PlainJot folder
- Native folder picker with a shared app and CLI location

### Changed

- Existing notes and tasks open in preview, while newly created documents open in write mode

### Security

- Explicit symlink rejection and optimistic revision checks for external edits

## 0.1.0 — Initial foundation

- Local Markdown notes
- Native WebKit macOS application
- Python development server
- Search, autosave, Markdown preview, and light/dark themes
