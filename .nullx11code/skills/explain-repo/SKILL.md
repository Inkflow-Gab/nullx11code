---
name: explain-repo
description: Onboards the user to an unknown repository — structure, entry points, tech stack, and how to run it.
always: false
---

# Explain Repository

When asked "what does this repo do" / "explain this project":

1. Recon with tools, in this order:
   - `list_files` (depth 2) for structure
   - `read_file` on README.md, package.json / pyproject.toml / Cargo.toml (whichever exists)
   - `grep` for entry points (`main(`, `if __name__`, `export default`)
2. Answer with exactly these sections:
   - **What it does** — 1–2 sentences, plain language.
   - **Stack** — languages/frameworks with versions.
   - **Layout** — the 3–6 most important folders, one line each.
   - **Run it** — copy-pasteable commands (install / test / dev).
   - **Where to start** — the single best file for a newcomer to open first.
3. If something is unclear from the files, say "unknown from repo" instead of guessing.
