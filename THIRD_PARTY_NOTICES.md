# Third-party notices

nullx11code 0.5.0 integrates the official OpenCode runtime as an optional,
version-pinned npm dependency. The terminal UI, agent engine, server and
bundled web client are upstream software, not original nullx11code UI code.
Product presentation includes a nullx11code branding layer. Upstream provider
names, protocol identifiers and attribution remain intact; no endorsement is
implied.

- Project: https://github.com/anomalyco/opencode
- npm distribution: `opencode-ai@1.19.5`
- Source tag: `v1.19.5`
- Source commit: `810c0eba1a7348036f8bdf61e6632d0c36c6876c`
- License: MIT (reproduced below)

The distribution may bundle other open-source components; their licenses
remain applicable. See upstream source/distribution notices for those
components. Its LICENSE is also installed with the npm dependency.

## OpenCode license

```text
MIT License

Copyright (c) 2025 opencode

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Branded browser workspace dependencies

The workspace serves these installed npm dependencies locally. Their original
license files remain included with each installed dependency:

- Marked (`marked@15.0.12`), MIT license — https://github.com/markedjs/marked
- DOMPurify (`dompurify@3.4.17`), Apache-2.0 OR MPL-2.0 — https://github.com/cure53/DOMPurify

Browser-testing dependencies Playwright and the npm-distributed headless
Chromium package are development-only and are not included in the production
package. Their respective upstream licenses/notices remain applicable.

- jsonc-parser (`jsonc-parser@3.3.1`), MIT license — https://github.com/microsoft/node-jsonc-parser
