# nullx11code — Brainstorm & Roadmap

Ideas captured while building v0.1.0. Checked = shipped, ▸ = next up, ○ = wild.

## Shipped (v0.1.0)

- [x] Zero-dependency Node CLI (Termux/mobile friendly, non-TTY mode, auto-width)
- [x] Free-first provider registry: NVIDIA NIM, Groq, Cerebras, OpenRouter, Gemini, Mistral, GitHub Models, Ollama, LM Studio + custom endpoints
- [x] API key auto-detection (env → `~/.nullx11code/.env` → `./.env` → config)
- [x] Model auto-detect: `/models` fetch, preferred-model heuristics, 24h cache, static fallback catalog
- [x] Model family icons (SVG in web, colored monogram chips in terminal): Llama, Qwen, DeepSeek, Nemotron, Mistral, Gemma, Kimi, GPT, Claude, Gemini…
- [x] Skills = folders of `SKILL.md`; project-selectable skill dirs; frontmatter; system-prompt injection; keyword suggester
- [x] Slash commands with tab completion (opencode-style): `/model`, `/skills`, `/provider`, `/serve`, `/doctor`…
- [x] Agent tools: list/read/grep auto, write + shell with `[y/n/a]` approval
- [x] Streaming SSE chat with tool loop + loop guard (8 steps)
- [x] Sessions persisted as JSON (global + project), `/history`, `/load`, `/export`
- [x] Web UI: landing (icons, animated CLI download terminal, provider strip) + chat (model picker, skills toggles, approval modal, streaming markdown)
- [x] PWA manifest + generated PNG icons (hand-rolled zlib PNG encoder)
- [x] `install.sh` (curl | sh, npm fallback, Termux notes), `n11` short alias
- [x] `doctor`, `config`, `usage`, `compact`, `icon` commands
- [x] Tests: `node --test` incl. mock-provider end-to-end

- [x] **Custom commands**: `.nullx11/*.md` auto-detected → `/name` slash commands with `description`/`example` frontmatter, `$ARGUMENTS` templating, prefix peek (`/ex` → `/extra`), `/help` + Tab integration, project *or* global (`~/.nullx11/`) scope
- [x] **Icon redesign v2**: anime-sprite mascot (cat-eared spirit), flowing binary-code texture, dark + glowing white palette, for web, CLI, favicon and generated PNGs
- [x] **Diff-aware patch tool**: unified-diff parsing (`diff --git` / `---`/`+++` / `@@`, add/update/delete, `/dev/null`) with exact-context verification — one approval applies a whole diff
- [x] **Download animation v2**: multi-stage installer (environment table, release + sha256, byte-counting download with live MB/s, checksum, extract, link binaries, scaffold `.nullx11/`, zero-dependency note) + flowing binary-rain canvas on the landing hero

- [x] **opencode port r1**: `/setup` (easy key entry + provider table), `/models` search&switch, `/init`, `/review`, `/agent build|plan`, `$1–$9` + `` !`shell` `` command templates, `glob`/`edit`/`webfetch`/`todowrite` tools, `AGENTS.md`/`CLAUDE.md` instruction discovery, clear-on-launch
- [x] **opencode port r2**: permission rules engine (deny → allow → default) + `/permissions` command + `[a]lways` persists an allow rule; `question`, `todoread`, `patch` (unified diff), `load_skill`, `subagent` (child session, one nesting level, `allowTools` restriction) tools; `@file` + image mentions in CLI and web; CLI status line (`provider/model · agent · tokens · msgs`) + turn footer (`steps · tok · secs`) + live `/`/`@` popup with described Tab completion; web: full slash parity via `/api/command`, question modal, stop/regenerate/copy, per-code-block copy buttons, image paste
- [x] **Web chat upgrades**: live command palette (arrows/Tab/Enter), inline command output, approval + question modals, mid-stream stop, last-reply regenerate, clipboard copy for answers and code blocks
- [x] **Self-update check**: launch compares local `VERSION` against GitHub (release tag → `package.json` on main), asks `[y/n]` before running the installer; `/version` re-checks; web shows a toast via `/api/update`; opt-out via `updateCheck:false` / `NULLX11_NO_UPDATE_CHECK=1` / `--no-update-check`

## Next (▸)

- [ ] **Skills marketplace**: `nullx11code skills add github:owner/repo` — pull a folder of skills from git
- [ ] **Per-directory sessions** + `--continue` to resume last chat in this repo
- [ ] **Cost/context meter** per provider (OpenRouter returns real usage + cost — show it live)
- [ ] **Retry/fallback chain**: if the chosen free provider 429s, auto-fall to the next free one (NVIDIA → Groq → …)
- [x] **Vision (web paste)**: paste images into the composer — auto-shrunk to JPEG data URLs and sent multimodally (needs a vision-capable model)
- [ ] **`/run` playground**: run a prompt against N models side-by-side and diff answers
- [ ] **Git-aware context**: auto-include `git diff` in the system prompt when dirty
- [ ] **Hooks**: `onToolUse`, `onSessionEnd` scripts in `.nullx11code/hooks/`
- [ ] **Voice input/output** on the web UI (Web Speech API — free, on-device)
- [ ] **Offline TTS briefing**: `nullx11code --speak "done"` reads results aloud (Termux: `termux-tts-speak`)
- [ ] **Share link**: export a session as a read-only HTML page
- [ ] **Themes**: terminal color themes (`/theme gruvbox|nord|catppuccin`) + web theme switcher
- [ ] **MCP client**: connect Model Context Protocol servers for extra tools
- [ ] **Multi-agent CLI**: `/delegate <task>` command wrapper around the shipped `subagent` tool (pick a cheaper/faster child model explicitly)
- [ ] **Prompt caching** where providers support it (Anthropic-style cache breakpoints on the skills block)
- [ ] **i18n**: UI strings in ES/TL/… (user is in PH — Tagalog docs would be fun)
- [ ] **Publish to npm** (`npm i -g nullx11code`) + GitHub Action that builds release tarballs
- [ ] **Signed releases**: checksum the tarball in `install.sh`
- [ ] **Homebrew/Termux repo package** (`pkg install nullx11code`)

## Wild ideas (○)

- **Skill compiler**: lint skills (frontmatter schema, token size budget, conflict detection between skills)
- **Auto-skill authoring**: `/skill learn` watches what you asked repeatedly and drafts a new SKILL.md
- **Terminal GIF recorder**: `/record` captures the session as an asciinema for sharing
- **Split-pane**: tmux/zellij integration — code on left, agent on right
- **Provider health page**: `nullx11code status` pings all free tiers, prints a latency leaderboard
- **Local-first keys vault**: OS keychain integration (keytar-style) instead of `.env`
- **Team skills**: shared skills via a git submodule with version pinning
- **Sandboxed shell**: run commands in a bubblewrap/firejail profile by default
- **Browser extension**: send the current page to `nullx11code serve` as context
- **Phone widget**: PWA widget showing session status / last answer
- **Easter eggs**: `/matrix`, `/cowsay`, ASCII-art banners per provider

## Design principles (keep these while growing)

1. **Zero dependencies** — every feature must justify hand-rolling over `npm install`.
2. **Keys never leave the machine** — web UI is a local proxy, not a cloud.
3. **Free-first** — paid providers are opt-in extras, never the default path.
4. **Approval by default** — anything that mutates the filesystem or runs commands asks first.
5. **Folders over databases** — skills, sessions, config are plain files you can `git` and `grep`.
6. **Mobile is a first-class terminal** — if it doesn't work in Termux, it's not done.
