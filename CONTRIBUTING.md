# Contributing to PlainJot

PlainJot values small changes that preserve three principles: **files first, local first, agent friendly**.

1. Open an issue for behavior changes that need discussion.
2. Keep Markdown as the source of truth; do not add a database or required service.
3. Avoid large dependencies when the platform or standard library is enough.
4. Add tests for filesystem formats, safety boundaries, and CLI behavior.
5. Keep the interface calm and notebook-like.

Before opening a pull request:

```bash
python3 -m unittest -v
node --check static/app.js
./scripts/build_macos_app.sh
./dist/PlainJot.app/Contents/MacOS/PlainJot --self-test
```

Do not include personal notes, generated apps, archives, credentials, or signing material. By contributing, you agree that your changes are provided under the repository's MPL-2.0 license.
