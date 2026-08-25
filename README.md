# PlainJot

> Notes that stay yours.

PlainJot is a small, local-first Markdown notes app for people and coding agents. It keeps notes in ordinary files on your Mac—without accounts, databases, or external dependencies.

[Leer en español](README.es.md)

- Plain Markdown files that remain yours.
- Search, autosave, Markdown preview, and light/dark themes.
- A native macOS app that runs without Python or a local server.
- A standard-library Python server for web development.

## macOS app

Building requires macOS 13 or later and the Xcode command-line tools.

```bash
git clone https://github.com/JoseMLuzu/plainjot.git
cd plainjot
./scripts/build_macos_app.sh
```

The app is generated at `dist/PlainJot.app`. Move it to your `Applications` folder and open it normally.

## Where notes live

PlainJot stores notes in:

```text
~/Documents/PlainJot
```

Each note is a standalone Markdown file, so editors and coding agents can work with it directly. For example:

> Save a summary of this session to `~/Documents/PlainJot/project-summary.md`, using the title as a `#` heading.

Previous “Notas Local” installations automatically migrate `~/Documents/NotasLocal` when possible.

## Web development

The development server requires Python 3.10 or later and uses only the standard library:

```bash
python3 app.py
```

Then open `http://127.0.0.1:8765`. A different notes directory or port can be selected:

```bash
python3 app.py --notes-dir ~/Documents/MyNotes --port 9000
```

## Keyboard shortcuts

- `⌘ N`: create a note.
- `⌘ K`: search.
- `⌘ S`: save immediately.
- `⌘ ⇧ P`: switch between writing and preview.

## Tests

```bash
python3 -m unittest -v
./scripts/build_macos_app.sh
./dist/PlainJot.app/Contents/MacOS/PlainJot --self-test
```

## Contributing

Bug reports, ideas, and pull requests are welcome. Before submitting a change, run the tests and preserve PlainJot's focus: a simple, local experience built on open files.

## License

PlainJot is available under the [Mozilla Public License 2.0](LICENSE).
