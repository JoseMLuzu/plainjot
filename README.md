# PlainJot

**Notes for you. Memory for your agents.**

A local-first Markdown notebook and task inbox built for humans and coding agents.

[Leer en español](README.es.md)

- Local first
- Markdown files
- No account
- No cloud required
- Human + agent friendly
- Native macOS app
- Open source

> **Files first. Local first. Agent friendly.**

PlainJot is intentionally small. It is not a workspace, knowledge graph, or project-management system. Ordinary `.md` files in the selected folder—`~/Documents/PlainJot` by default—are always the source of truth.

Notes with Markdown headings get a lightweight outline on the right. Use **Ocultar índice** in the current Spanish interface to hide it and expand the document. Your choice is remembered locally. Compact titles scroll with the preview instead of staying pinned while you read.

## What it does

PlainJot has two quiet sections:

- **Documents** for notes, journals, roadmaps, decisions, reviews, refactoring plans, handoffs, and whiteboards. A small label identifies each document's type.
- **Tasks** with **Inbox**, **Pending**, and **Done** filters, plus optional Sprint View. Accept agent proposals from Inbox to move them to Pending.

Choose a project if useful, then click **+ Crear** and select a document type directly. There is no separate developer mode or template dropdown to configure first. Human-created tasks start as `todo`; the CLI still defaults to `inbox` for agent proposals.

The task list remains the default. Sprint View simply arranges the same Markdown tasks as **Inbox**, **To do**, and **Done**; it does not add boards, sprint metadata, or a separate source of truth.

It watches the PlainJot directory on macOS, so external creates, edits, renames, and deletes appear automatically. Autosave uses revision checks to avoid silently overwriting an external edit. If both versions change, PlainJot protects the local draft and lets you choose which version to keep.

Deleting from the native app moves the Markdown file to the macOS Trash so it remains recoverable.

Click the folder path in the bottom-left corner to choose another local folder. PlainJot remembers it, restarts the watcher, and shares the selection with the CLI. Existing files are never moved automatically.

## Debug Journal

Click **+ Crear → Debug Journal** to create a debugging entry in Documents. New entries start with a small template: symptom, hypothesis, investigation, root cause, solution, and lessons learned.

Entries remain normal notes in the same folder, marked with `type: note` and `kind: debug-journal` in YAML frontmatter. They appear alongside other documents; switching tabs never moves or deletes files. Agents can write that frontmatter directly or use:

```bash
plainjot add "Bug: Journal did not open" --kind debug-journal \
  --body "## Symptom

Open Journal did nothing."
plainjot list --journals
```

The app and CLI share the same starter templates. `--body` replaces the starter text (including an explicitly empty body). Journal entries are not tasks and do not have task statuses.

## Developer notebook

The **+ Crear** menu includes **Ticket**, **Roadmap**, **Technical decision**, **Refactoring**, **Review**, and **Session handoff**, alongside Debug Journal. Tickets are ordinary Tasks with acceptance criteria in the body, not a new entity or workflow; creating one opens it in Tasks. Other templates are notes with a `kind` field, grouped in Documents. Legacy and unknown note kinds stay discoverable in the same list.

Choose **Proyecto** above the sidebar navigation to filter documents and tasks, including Sprint View. New items inherit that project; **Todos los proyectos** requires no assignment. Edit a document's project in **Escribir** (or **Markdown** for whiteboards); preview hides metadata controls for calmer reading. Projects are plain YAML metadata, not folders; old notes need no migration. Clearing the field removes the assignment, not the document.

```bash
plainjot task "Fix login" --template ticket --project my-app --source codex
plainjot add "Architecture choice" --kind decision --project my-app
plainjot add "Resume tomorrow" --kind handoff --project my-app --source claude-code
plainjot list --inbox --project my-app
plainjot search "authentication" --project my-app
```

Link related documents with ordinary Markdown, for example `[Login investigation](bug-login.md)`. Clicking a same-folder `.md` reference in preview opens it in PlainJot. Only supported filenames inside the active folder are allowed; absolute paths, parent paths, subfolders, and symlinks are not opened. Renaming a file does not rewrite references automatically. Checklists render in preview; edit their `[ ]` / `[x]` markers in write mode.

Any agent with local filesystem access can use these commands or write Markdown directly. This does not require an app connection, account, or agent-specific integration. Templates are prompts to fill in, not automatically generated findings.

## Whiteboard

Choose **+ Crear → Pizarra** for a local drawing pad within Documents: pen, whole-stroke eraser, rectangles, arrows, text, four colors, and undo/redo. Drawings autosave through the same filesystem core as notes. Export an SVG using the native Save dialog, or a browser download in web development. PNG export and collaboration are not included.

Each board is a normal `.md` file with `type: note`, `kind: whiteboard`, optional project metadata, and one fenced `plainjot-whiteboard` JSON block. See [the drawing format](docs/WHITEBOARD.md). Agents can create or edit these files directly; revision conflicts protect local drawing drafts. Link a board from a journal with `[Flow](architecture.md)`. The filename is shown below the canvas. Unsupported or malformed drawing data is preserved and can be repaired in the **Markdown** tab.

## Build the macOS app

Requirements: macOS 13 or later and the Xcode command-line tools.

```bash
git clone https://github.com/JoseMLuzu/plainjot.git
cd plainjot
./scripts/build_macos_app.sh
open dist/PlainJot.app
```

The native app embeds the shared HTML/CSS/JavaScript interface in WebKit. It does not need Python while running.

## Install the CLI

The dependency-free installer places `plainjot` in `~/.local/bin`:

```bash
./scripts/install_cli.sh
export PATH="$HOME/.local/bin:$PATH"
```

You can also use `./plainjot` directly from the repository.

```bash
plainjot add "My note"
plainjot task "Fix authentication"
plainjot task "Clean profiles" --project outcrew
plainjot task "Fix login" --source codex
plainjot list
plainjot list --inbox
plainjot list --tasks
plainjot search "authentication"
plainjot done fix-auth
```

Both the CLI and app operate on exactly the same Markdown files.

## Use with AI agents

Any coding agent with permission to run local commands can create an inbox task:

```bash
plainjot task "Refactor authentication" \
  --project my-project \
  --source codex
```

For Claude Code, use the same command with an accurate source value:

```bash
plainjot task "Review the release script" \
  --project plainjot \
  --source claude-code
```

Other agents do not need a dedicated integration. They can use the CLI or write a valid Markdown file directly inside:

```text
~/Documents/PlainJot
```

That is the default location. If you select another folder in the macOS app, use the path shown in its bottom-left corner; the `plainjot` CLI follows that selection automatically.

These workflows rely only on normal shell and filesystem access. No official Codex or Claude Code plugin is required or claimed.

## Task format

Tasks are ordinary Markdown files with a small YAML frontmatter block:

```markdown
---
type: task
status: inbox
project: plainjot
source: codex
created: 2026-08-24T22:30:00Z
completed:
---

# Add filesystem watcher

Detect external Markdown changes automatically.
```

The supported states are deliberately limited to `inbox`, `todo`, and `done`. Notes without frontmatter remain fully compatible.

## Web development

The development server requires Python 3.10 or later and uses only the standard library:

```bash
python3 app.py
```

Then open `http://127.0.0.1:8765`. To use disposable files during development:

```bash
python3 app.py --notes-dir /tmp/plainjot-dev --port 9000
```

## Architecture

```text
Markdown files
├── Python Core → CLI and development server
└── Swift Core  → native WebKit bridge and filesystem watcher
                         ↓
                shared HTML / CSS / JavaScript
```

The Python Core is reusable by a future small MCP server. The Swift Core keeps the macOS app native and independent of a Python runtime. Both implement the same documented Markdown contract without a database or YAML dependency.

## Tests

```bash
python3 -m unittest -v
node --check static/app.js
node --test test_frontend.js test_whiteboard.js
./scripts/build_macos_app.sh
./dist/PlainJot.app/Contents/MacOS/PlainJot --self-test
```

## Downloadable build

Create a validated zip without publishing a release:

```bash
./scripts/package_release.sh
```

The archive appears in `dist/`. Development builds are signed ad hoc. Public distribution requires an Apple Developer ID signature and notarization; the exact manual process is documented in [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md), [ROADMAP.md](ROADMAP.md), and [SECURITY.md](SECURITY.md). Keep personal notes, generated apps, credentials, and signing material out of the repository.

## License

PlainJot is available under the [Mozilla Public License 2.0](LICENSE).
