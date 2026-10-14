# Third-party notices

## Omarchy agent usage panel and collectors

This project is an independent, cross-platform reimplementation inspired by
[Omarchy](https://github.com/omacom/omarchy). It is not affiliated with Omarchy,
Anthropic, OpenAI, xAI, Moonshot, Fireworks, or the Pi project.

The unmodified reference implementation is preserved under `vendor/omarchy/`:

- Upstream: https://github.com/omacom/omarchy
- Commit: `84cfb93959f4fe0bbb71de71593b36647d2ba78d`
- Commit date: 2026-10-14T18:13:38+09:00
- Retrieved: 2026-10-14
- Files: `bin/omarchy-agent-usage-*`, `shell/plugins/agents/*` (including assets),
  and the available `test/shell.d/agent-usage-*-test.sh` files.
- License: MIT (upstream copyright text below and in `vendor/omarchy/LICENSE`).

The original shell/QML/Python code is reference material, not invoked or shipped
in the app runtime. The portable collectors use the same provider contracts and
usage-accounting principles, rewritten in TypeScript. The app's robot artwork is
original; text/glyph provider marks are not the upstream SVG logos. Upstream assets
remain in the reference snapshot only. Provider and product names belong to their
respective owners.

### Upstream license

Copyright (c) David Heinemeier Hansson

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## JetBrains Mono

The unmodified JetBrains Mono v2.304 variable font is bundled locally at
`src/renderer/fonts/JetBrainsMono-wght.ttf` and copied into production renderer
assets by Vite. No font service or network request is used.

- Source: https://github.com/JetBrains/JetBrainsMono/tree/v2.304
- Copyright 2020 The JetBrains Mono Project Authors
- License: SIL Open Font License 1.1, reproduced in
  `assets/fonts/JetBrainsMono-OFL.txt` (also included in packaged apps).

## Runtime and build dependencies

Electron, Chromium, Node.js, systeminformation, Zod, and the development tools
retain their own licenses. Exact versions are pinned in `package-lock.json`.
Electron distributions include their Chromium and third-party license files;
dependency licenses remain within the packaged dependencies. The `global-agent`
override upgrades the builder's download-only dependency to its patched 4.x line;
it is not part of the application runtime.
