<p align="center">
  <img src="assets/icons/app-icon.svg" width="96" height="96" alt="nullx11code icon" />
</p>

<h1 align="center">nullx11<code>code</code></h1>

<p align="center">
  <b>Free-first AI coding agent, powered by OpenCode.</b><br/>
  Full-screen terminal UI · bundled web app · real agent runtime · existing nullx11code providers
</p>

<p align="center">
  <img src="assets/icons/png/icon-192.png" alt="app icon" width="0" height="0" hidden />
  <a href="#setup">Setup</a> ·
  <a href="#cli-commands">CLI commands</a> ·
  <a href="#slash-commands">Slash commands</a> ·
  <a href="#web-ui">Web UI</a> ·
  <a href="#skills">Skills</a> ·
  <a href="#providers">Providers</a> ·
  <a href="docs/BRAINSTORM.md">Roadmap</a>
</p>

---

## 0.5.0 — nullx11code identity, complete native access

The default terminal now uses a **nullx11code logo, product footer and window
identity** through the engine’s official TUI plugin API. The advanced browser
workspace has nullx11code navigation, title, favicon and decorative wordmarks.
Native command help and shell completion use `nullx11code` / `n11`.

The underlying engine, provider names, configuration namespaces and legal
attribution remain compatible with OpenCode. No model responses, code blocks,
user text or tool output are rewritten to perform the rebrand.

- Focused browser: `nullx11code serve`.
- Complete advanced interface: **Open advanced workspace**, or
  `/?experience=advanced` on the running server.
- Full terminal: `nullx11code`.
- Exact unmodified native behavior: `nullx11code upstream …`.
- Disable automatic TUI presentation branding: `NULLX11_NO_BRANDING=1`.

See [BRANDING.md](docs/BRANDING.md) for scope, compatibility and opt-outs.
This is not a claim that the upstream desktop binaries or hosted services have
been forked, deployed or independently reimplemented.

## 0.4.0 — a proper coding workspace

The browser now opens directly into **nullx11code’s redesigned workspace**:
focused chat, searchable sessions/models, a project-file panel, an improved
composer, real tool approvals, changes and tasks—not a marketing landing page.
It is backed by the same real OpenCode engine as the terminal.

- **Work with context:** browse/preview files and attach them to messages.
- **Keep control:** inspect actual tool requests, approve/deny, and stop runs.
- **Stay organized:** rename, fork, export, undo/restore and revisit sessions.
- **Choose your stack:** connect provider keys, search models, switch build/plan.
- **Make it yours:** dark/light themes, mobile layout, keyboard command palette.

```sh
npm install
npm start                  # full OpenCode terminal experience
npm run serve              # redesigned nullx11code browser workspace
npm test                   # unit + engine/API/security integration tests
npm run test:browser        # real browser, real engine, local mock provider
```

The complete native browser interface remains available from the workspace’s
**Open advanced workspace** link (`/?experience=advanced`). Advanced native
screens are retained, not falsely claimed as reimplemented in the branded UI.
See [the workspace guide](docs/WORKSPACE.md) for features, screenshots produced
by tests, security, platform notes and known boundaries.

## 0.3.0 — the real OpenCode experience

The default CLI now launches the **actual OpenCode 1.19.5 runtime**, rather
than the original line-based chat. This includes its full-screen chat composer,
streaming/tool UI, model and agent pickers, sessions, themes, diffs/undo,
MCP/LSP/plugin support, and bundled browser client. Features requiring external
servers, tools or credentials still need configuration.

```sh
npm install                         # in a source checkout
npm start                           # full-screen terminal UI
node bin/nullx11code.js serve        # branded workspace + native UI, port 7860
node bin/nullx11code.js -p "explain this repo"
```

After a global install, use `nullx11code` or `n11` as before:

```sh
nullx11code --provider nvidia --model meta/llama-3.3-70b-instruct
nullx11code models
nullx11code mcp --help
nullx11code session list
nullx11code upstream --help          # full upstream CLI help
nullx11code legacy                   # original lightweight terminal chat
nullx11code legacy serve             # original browser app
```

Existing `.env` keys, provider settings, enabled skills, custom Markdown
commands, instructions and permission rules are bridged without overwriting
original configuration. Modern sessions use upstream storage; old sessions
remain accessible in `legacy`.

**Scope:** this is an integration of the official, pinned `opencode-ai` npm
release, not a source-level fork of the entire upstream monorepo. The terminal and native browser
screens retain OpenCode branding; the 0.4.0 workspace is nullx11code-branded. Desktop binaries, hosted services and all
changes on upstream `main` are not included. See
[the integration guide](docs/OPENCODE.md) for platform support, command changes,
configuration precedence, security, known limitations and maintenance.

**Web security:** `serve` binds to `0.0.0.0`. Set `OPENCODE_SERVER_PASSWORD`
before exposing it outside a trusted development environment, or use
`serve --host 127.0.0.1` for local-only access.

**Platforms:** modern mode uses upstream's native Linux/macOS/Windows x64/arm64
packages. Android/Termux can use `legacy`; its Node implementation still has
no runtime dependencies. Optional native packages/install scripts must be
enabled for modern mode.

**License:** MIT. OpenCode attribution and license are preserved in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

## Legacy CLI reference

The sections below document the original **0.2.x/legacy engine**. Invoke its
commands with `nullx11code legacy …` (or `npm run start:legacy`). Its slash
commands, session format and UI differ from modern OpenCode mode. Use
`nullx11code --help` and [docs/OPENCODE.md](docs/OPENCODE.md) for the new defaults.

### Why keep legacy?


- **Zero dependencies** — one Node script, no `node_modules` graveyard, runs on anything with Node ≥ 18 (including Termux on Android).
- **Free-first providers** — NVIDIA NIM, Groq, Cerebras, OpenRouter `:free`, Gemini, Mistral, GitHub Models, local Ollama/LM Studio. Keys auto-detected from env / `.env` / config; free ones are preferred automatically.
- **Model auto-detect + icons** — fetches `/models`, picks the best free model, and shows every model with its family icon (Llama, Qwen, DeepSeek, Nemotron… — SVG in the web UI, colored monogram chips in the terminal).
- **Skills are folders** — point a project at *any* folder of `SKILL.md`s; toggle them per project; active ones inject into the system prompt.
- **`/`slash commands** — `/model`, `/skills`, `/provider`, `/serve`, `/doctor`… with tab completion, like opencode.
- **Agent tools with approval** — reads/greps/lists freely; every **write** and **shell** command waits for your `[y/n/a]`.
- **Terminal + Web in one** — `nullx11code serve` launches the same agent as a mobile-friendly web app.

## Setup

Everything needed to get installed and chatting — in order.

### 1. Install

```sh
curl -fsSL https://raw.githubusercontent.com/Inkflow-Gab/nullx11code/main/install.sh | sh
```

or with npm directly:

```sh
npm i -g https://codeload.github.com/Inkflow-Gab/nullx11code/tar.gz/refs/heads/main
```

<details>
<summary>Mobile / Termux (Android)</summary>

```sh
pkg install nodejs-lts
curl -fsSL https://raw.githubusercontent.com/Inkflow-Gab/nullx11code/main/install.sh | sh
```

The CLI is line-based ANSI with auto-width, no mouse, and no bracketed-paste tricks — it behaves in small phone terminals. Non-TTY (piped) input works too: `echo "hello" | nullx11code`.
</details>

### 2. Add a free API key

Easiest — from inside the CLI (writes `.env`, verifies the key, switches provider):

```
/setup nvidia nvapi-…
/setup groq gsk_…
/setup            → shows which providers still need a key + where to get one
```

Or by hand — put **one** free key in `.env` (project) or `~/.nullx11code/.env` (global):

```sh
echo "NVIDIA_API_KEY=nvapi-…" >> .env        # build.nvidia.com
echo "GROQ_API_KEY=gsk_…" >> .env            # console.groq.com
# more free keys: .env.example
```

The web UI sidebar also shows an **Add a free key** panel until every provider is configured.

### 3. Verify

```sh
nullx11code doctor        # checks keys, network, skills, node version
```

### 4. Chat

```sh
nullx11code                          # interactive
nullx11code "explain this repo"      # one-shot
nullx11code serve                    # web UI instead
```

On launch the CLI checks GitHub for a newer version and **asks before updating** (`y` runs the installer, `n` skips until next time). Disable with `"updateCheck": false`, `NULLX11_NO_UPDATE_CHECK=1`, or `--no-update-check`; `/version` re-checks on demand.

```
  ▗▄▖▐▌ ▐▌ nullx11code v0.2.0
  free-first AI coding agent · terminal + web
  2 keys · 4 skills · /help for commands
  model ▌NVIDIA NIM · nvidia/llama-3.3-70b-instruct · LL Llama

❯ /help
```

## CLI commands

Top-level `nullx11code <command>` (run in your shell, before the chat starts):

| Command | Description |
|---|---|
| `nullx11code` | start interactive chat |
| `nullx11code "prompt"` / `-p "prompt"` | one-shot answer, then exit |
| `serve [port]` | launch the web UI (default `7860`, `0.0.0.0` for LAN/mobile) |
| `providers` | list all providers + which keys are detected |
| `models` | list models for a provider (`--provider <id>`) |
| `skills` | show discovered skills and their status |
| `doctor` | diagnose keys / network / skills / node |
| `config` | print config paths + merged config |
| `icon [app\|cli\|provider]` | print built-in icons |
| `update` | print the update command |
| `banner` | print the startup banner |
| `version` \| `-v` | version info |
| `help` \| `-h` | help |

**Flags:** `--provider <id>` · `--model <id|auto>` · `--no-color` · `-y / --yes` (auto-approve tools) · `--resume [id]` · `-p "prompt"`

<details>
<summary>Update / uninstall</summary>

```sh
# update (re-run installer or)
npm i -g https://codeload.github.com/Inkflow-Gab/nullx11code/tar.gz/refs/heads/main

# uninstall
npm rm -g nullx11code
```
</details>

## Slash commands

Typed **inside the chat** (Tab-completes with descriptions, a live dropdown appears as you type, prefix works: `/ex` → `/extra`).
Ported from [opencode](https://github.com/anomalyco/opencode): `/setup`, `/init`, `/review`, `/agent`, `/permissions`:

| Command | Description |
|---|---|
| `/help [cmd]` | help (incl. your custom `.nullx11` commands) |
| `/setup [id key]` | **add an API key the easy way** — writes `.env`, verifies, switches |
| `/model [id\|#]` | switch model (shows family icons) |
| `/models [query\|#]` | list models — or **search & switch**: `/models llama` |
| `/provider [id]` | switch provider |
| `/providers` | all providers + key status |
| `/init [focus]` | create / improve `AGENTS.md` project instructions |
| `/review [ref]` | review a commit, branch or PR (opencode-style) |
| `/agent [build\|plan]` | build = full access · plan = **read-only** (edits denied) |
| `/permissions [add\|rm\|default]` | allow/deny rules so safe commands never prompt (opencode-style) |
| `/skills`, `/skill on\|off <n>` | manage skills |
| `/new`, `/clear` | fresh chat / clear screen |
| `/history`, `/load <id>` | saved sessions |
| `/export [file]` | export chat as markdown |
| `/usage` | token estimate |
| `/config [k=v]` | view/set config |
| `/settings` | toggles (stream, approvals, colors) |
| `/serve [port]` | launch web UI |
| `/doctor` | diagnose keys/network/skills |
| `/icon [app\|cli\|provider\|model]` | print icons |
| `/compact` | shrink history |
| `/quit` | exit |

## Web UI

```sh
nullx11code serve          # http://localhost:7860
nullx11code serve 3000     # custom port
```

- **Landing page** with the app/CLI icons, an animated *download-the-CLI* terminal (typing + progress bar), and the provider strip.
- **Chat view** with provider/model pickers (icons!), skills toggles, session history, streaming markdown, and approval modals for tool actions.
- **Full slash-command parity** — type `/` and a live popup lists every builtin + `.nullx11` command with descriptions (arrows to move, Tab to complete, Enter to run); output appears inline in the chat.
- **Stop / regenerate / copy** — stop a stream mid-flight, regenerate the last reply, copy any answer or single code block (per-block copy button).
- **`@file` mentions** — type `@src/app.js` and the file is inlined into the prompt server-side; **paste an image** (screenshots auto-shrink) and it is sent multimodally.
- **Question tool** — when the agent asks structured questions, a modal shows numbered options (or free text), matching the CLI flow.
- Serves on `0.0.0.0` so your phone on the same network can open the LAN URL shown at startup.

## Skills

A skill is a folder with a `SKILL.md`:

```
.nullx11code/skills/
  code-review/SKILL.md
  commit-msg/SKILL.md
my-skills-folder/          ← any folder you point at
  sql-helper/SKILL.md
```

```markdown
---
name: code-review
description: Reviews changed code for bugs and security issues
always: false
---
# Code Review
…instructions the model follows when the skill is active…
```

| Command | Effect |
|---|---|
| `/skills` | list skills with status |
| `/skills add <dir>` | **use a whole folder of skills in this project** |
| `/skills new <name>` | scaffold a new skill |
| `/skills on\|off <name>` | toggle (persists in `.nullx11code/config.json`) |

Discovery order: config `skills.dirs` → project `.nullx11code/skills` → project `skills/` → global `~/.nullx11code/skills`.
When a message looks like it matches an inactive skill, the CLI hints: `skill "code-review" may apply`.

Four ready-made skills ship in [`examples/skills/`](examples/skills): `code-review`, `commit-msg`, `sql-helper`, `explain-repo`.

## Custom commands — `.nullx11/*.md`

Drop any markdown file into **`.nullx11/`** (auto-detected in the project where you run the CLI — or in `~/.nullx11/` for global ones) and it becomes a slash command named after the file:

```
.nullx11/
  extra.md          →  /extra
  commands/pixel.md →  /pixel      (subfolder works too)
```

```markdown
---
description: Create a polished animation for this project
example: /extra make the hero icon float with binary rain
---
Do the following for: $ARGUMENTS
…instructions…
```

- **Prefix peek**: typing `/ex` shows `→ /extra  Create a polished animation… (from /ex)` and runs it — even though the builtin `/exit` also starts with `ex` (unique custom match wins; if several match you get a candidate list).
- **`$ARGUMENTS`** is replaced by whatever you type after the command; **`$1`…`$9`** are positional words; if the body has no placeholder, your words are appended.
- **`` !`shell` ``** — opencode-style shell interpolation: a command body can inline live output, e.g. `` !`git diff` `` or `` !`git status --short` `` (runs in the project root, 5s timeout).
- The expanded prompt is sent to the model like a normal message (skills + tools still apply).
- `/help` lists them under **Custom commands** with description + example; Tab-completion includes them too.
- Extra folders can be added via config: `"commands": { "dirs": ["/path/to/cmds"] }`.

Two are bundled: `.nullx11/extra.md` (animation creator) and `.nullx11/commands/pixel.md` (anime-sprite artist).

## Providers

| Provider | Cost | Key env var | Notes |
|---|---|---|---|
| **NVIDIA NIM** | free | `NVIDIA_API_KEY` | flagship — free credits, no card |
| **Groq** | free | `GROQ_API_KEY` | free tier, very fast |
| **Cerebras** | free | `CEREBRAS_API_KEY` | free developer tier |
| **OpenRouter** | free | `OPENROUTER_API_KEY` | hundreds of models, `:free` ids |
| **Google Gemini** | free | `GEMINI_API_KEY` | free Flash tier |
| **Mistral** | free | `MISTRAL_API_KEY` | free credits |
| **GitHub Models** | free | `GITHUB_TOKEN` | free with your GH token |
| **Ollama** | free | — | local, offline |
| **LM Studio** | free | — | local server |
| Together AI | paid | `TOGETHER_API_KEY` | optional |
| OpenAI | paid | `OPENAI_API_KEY` | optional |
| *custom* | — | config `providers.custom` | any OpenAI-compatible endpoint |

Keys are read from: process env → `~/.nullx11code/.env` → `./.env` → config. **Keys never leave your machine** — the web UI proxies through the local server only.

## Agent tools

| Tool | Approval |
|---|---|
| `list_files` | automatic |
| `read_file` | automatic |
| `grep` | automatic |
| `glob` | automatic — find files by pattern (`**/*.ts`) |
| `webfetch` | automatic — fetch a URL as plain text |
| `todowrite` / `todoread` | automatic — plan/task tracking (the status line shows in-progress count) |
| `question` | interactive — asks you (modal in the web, numbered prompt in the CLI) |
| `load_skill` | automatic — pull in a discovered skill mid-task |
| `subagent` | automatic — delegate a focused task to a child session (own context, one nesting level) |
| `edit` | **asks** (`y/n/a`) — exact-string replace |
| `write_file` | **asks** (`y/n/a`) |
| `patch` | **asks** — apply a whole unified diff (add/update/delete) in one call |
| `shell` | **asks** (`y/n/a`) |

`a` = always approve this kind for the session — it also **persists an allow rule** to `.nullx11code/config.json`.
Print mode auto-rejects mutations unless `-y`.
In `/agent plan` mode, `edit`/`write_file`/`shell` are denied outright (read-only analysis).

### Permissions (opencode-style rules)

Rules are evaluated **deny → allow → default**, so a deny always wins:

```sh
/permissions                                  # list rules + default
/permissions add shell "git *" allow          # never prompt for git
/permissions add edit "*.lock" deny            # never touch lockfiles
/permissions default ask                      # ask | allow | deny
/permissions rm 1                             # drop a rule by number
```

The approval prompt's `a` (always) writes the same kind of rule for you. Rules live in `.nullx11code/config.json` under `permissions` and apply to both the CLI and the web UI.

### Mentions

Prefix a message with `@path/to/file` to inline it (text files ≤ 48 KB get a labeled fence; images become attachments; paths outside the project root are refused). Works in the CLI and the web composer.

## Configuration

Project: `.nullx11code/config.json` · Global: `~/.nullx11code/config.json`

```json
{
  "provider": "nvidia",
  "model": "auto",
  "temperature": 0.7,
  "skills": { "dirs": ["/path/to/skills"], "enabled": ["code-review"] },
  "approvals": { "shell": true, "write": true },
  "permissions": { "default": "ask", "rules": [] },
  "updateCheck": true,
  "port": 7860
}
```

## Development

```sh
npm test          # node --test suite (mock provider e2e included)
npm start         # run the CLI from source
npm run serve     # web UI from source
npm run icons     # regenerate provider/model SVG icons
npm run icons:png # regenerate PNG app icons
```

Architecture (zero deps, all first-party):

```
bin/nullx11code.js     entry
src/main.js            argv dispatch
src/cli.js             interactive REPL (streaming, approvals)
src/chat.js            SSE streaming + agent tool loop
src/providers.js       provider registry + /models + auto-pick
src/skills.js          skill discovery/frontmatter/injection
src/tools.js           list/read/write/grep/shell (+ approval)
src/commands.js        /slash commands
src/server.js          web server (static + JSON + SSE)
src/web/               landing + chat UI (vanilla JS)
src/ui.js              ANSI, badges, banner, markdown, spinner
assets/icons/          app, CLI, provider & model-family SVGs + PNGs
```

## License

MIT — see [docs/BRAINSTORM.md](docs/BRAINSTORM.md) for the roadmap and wild ideas.
