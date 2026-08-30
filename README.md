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

Notes with Markdown headings get a lightweight outline on the right, so long documents remain easy to navigate without adding metadata to the file.

## What it does

PlainJot has three quiet sections:

- **Notes** for normal Markdown documents.
- **Inbox** for tasks created by agents or other tools.
- **Tasks** for `todo` and completed work, with an optional three-column Sprint View.

The task list remains the default. Sprint View simply arranges the same Markdown tasks as **Inbox**, **To do**, and **Done**; it does not add boards, sprint metadata, or a separate source of truth.

It watches the PlainJot directory on macOS, so external creates, edits, renames, and deletes appear automatically. Autosave uses revision checks to avoid silently overwriting an external edit. If both versions change, PlainJot protects the local draft and lets you choose which version to keep.

Deleting from the native app moves the Markdown file to the macOS Trash so it remains recoverable.

Click the folder path in the bottom-left corner to choose another local folder. PlainJot remembers it, restarts the watcher, and shares the selection with the CLI. Existing files are never moved automatically.

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
