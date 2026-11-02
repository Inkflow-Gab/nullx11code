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

## Next (▸)

- [ ] **Skills marketplace**: `nullx11code skills add github:owner/repo` — pull a folder of skills from git
- [ ] **Per-directory sessions** + `--continue` to resume last chat in this repo
- [ ] **Cost/context meter** per provider (OpenRouter returns real usage + cost — show it live)
- [ ] **Retry/fallback chain**: if the chosen free provider 429s, auto-fall to the next free one (NVIDIA → Groq → …)
- [ ] **Vision**: accept image paths/pastes for multimodal models (Gemini/GPT-4o/Qwen-VL)
- [ ] **`/run` playground**: run a prompt against N models side-by-side and diff answers
- [ ] **Git-aware context**: auto-include `git diff` in the system prompt when dirty
- [ ] **Hooks**: `onToolUse`, `onSessionEnd` scripts in `.nullx11code/hooks/`
- [ ] **Voice input/output** on the web UI (Web Speech API — free, on-device)
- [ ] **Offline TTS briefing**: `nullx11code --speak "done"` reads results aloud (Termux: `termux-tts-speak`)
- [ ] **Share link**: export a session as a read-only HTML page
- [ ] **Themes**: terminal color themes (`/theme gruvbox|nord|catppuccin`) + web theme switcher
- [ ] **MCP client**: connect Model Context Protocol servers for extra tools
- [ ] **Multi-agent**: `/delegate <task>` spawns a sub-session with a different (cheaper/faster) model
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
- **Diff-aware edit tool**: `apply_patch` with unified-diff parsing (opencode/Claude-code style) instead of full-file writes
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
