# The nullx11code workspace (0.4.0)

`nullx11code serve` now opens a branded, application-first workspace rather
than a marketing landing page or an unmodified upstream home screen. It uses
**the real OpenCode engine** for conversations, tools, permissions, persistence,
provider credentials, and project context. There is no mock agent in production.

## Launch

```sh
npm install
npm run serve
# or, after a global install:
nullx11code serve 7860
```

Open the URL shown in the terminal. `--host 127.0.0.1` restricts access to this
machine. The normal `0.0.0.0` binding supports LAN and Arena previews. Set
`OPENCODE_SERVER_PASSWORD` before exposing the server to an untrusted network.

`nullx11code` still launches the full upstream terminal UI. The original
lightweight terminal/browser implementation remains under `legacy`.

## Implemented workspace features

- Responsive, three-panel desktop layout; mobile navigation and context drawer.
- Dark/light themes, remembered on the current browser.
- Real persisted sessions, search, title changes, deletion, forks and Markdown
  export. A session URL can be reloaded to resume its conversation.
- A structured, auto-growing composer; Enter sends, Shift+Enter adds a newline.
  Drafts are retained per session in local browser storage. Do not put secrets
  in drafts on a shared browser.
- Searchable connected-model picker and primary-agent selector (including
  build/plan). Models are provided by the engine, not invented UI entries.
- API-key connection flows for supported native providers. Keys are submitted
  to the engine's authentication store, not localStorage/sessionStorage. Saving
  a key is **not verification** of its validity, quota or billing; the first
  provider request determines access. OAuth and custom endpoint setup remain
  available in the native interface.
- Streaming conversation updates from the engine's SSE event stream. Tool
  activity and output are expandable. Synthetic context-injection messages
  are hidden from the readable conversation without deleting engine data.
- Safe Markdown rendering using Marked + DOMPurify; code and message copying.
- Explicit permission replies: allow once, allow for the session, or deny.
  Approval requests display the engine's actual permission/action patterns.
- Answers to native question requests, including multiple-choice/custom answers.
- Stop-generation action; native session undo/revert and restore. Snapshot-based
  file restoration depends on the upstream engine's project/snapshot support.
- Project-file browsing, text previews and project-file attachments. Preview
  text is capped at 256 KiB for UI responsiveness; the engine reads the original
  attached file. Ignored files and `.git`/`node_modules` are hidden in the tree.
- Per-session change previews and the engine's task list.
- Command palette (Ctrl/Cmd+K), session shortcut (Ctrl/Cmd+N), slash-command
  suggestions, connection state, reported tokens/cost and meaningful errors.
  Native slash commands may execute trusted command-template shell expansions;
  do not install untrusted commands.

Usage cost is the engine's estimate, not a billing guarantee. Custom/bridged
models may have unknown pricing. A provider offering a free tier does not mean
every model or request on that account is free.

## Full upstream experience is retained

Choose **Open advanced workspace** in the context panel, or open:

```
/?experience=advanced
```

Its bundled assets, API, SSE and PTY WebSockets pass through the same gateway.
Starting in 0.5.0, HTML title/favicon and a small identity/navigation layer are
nullx11code-branded; engine JS bundles and conversation content are unchanged.
This preserves access to advanced features not recreated in the branded
workspace: terminal panels, richer editor/diff controls, OAuth, MCP and plugin
configuration, advanced model variants, sharing/import and other native
settings. The new workspace is not claimed to implement every upstream screen.

For the completely unmodified native CLI/server, bypassing this gateway:

```sh
nullx11code upstream web --hostname 0.0.0.0 --port 7860
```

The original UI is still available at `nullx11code legacy serve`.

## Gateway design and security

`src/workbench-server.js` starts the pinned native executable on a loopback
port with a fresh random internal password. That secret stays server-side.
The public gateway:

- serves local workspace HTML/CSS/JS and locally installed Markdown libraries;
- proxies native API and SSE streams without buffering whole responses;
- proxies WebSocket upgrades for the native UI;
- uses same-origin browser URLs, never browser-facing sandbox `localhost`;
- enforces optional public Basic authentication on all routes;
- rejects cross-site browser requests and mismatched Origin hosts;
- rejects arbitrary Host names to reduce DNS-rebinding attacks; local machine
  addresses and Arena `*.e2b.app` previews are supported;
- supplies restrictive CSP headers to the branded application;
- shuts down its engine child when the gateway closes.

For a custom reverse-proxy hostname, set a comma-separated list of **bare
hostnames** in the environment or ignored `.env`:

```sh
NULLX11_ALLOWED_HOSTS=code.example.com,dev.example.com
```

The proxy must preserve the public Host header. Use HTTPS, a server password
and a firewall for remote access. This is a privileged coding agent, not a
multi-tenant/sandboxed hosting service: authorized users can access the native
engine's file and command capabilities. CORS/Origin checks are not substitutes
for authentication or OS-level isolation.

The public password honors `OPENCODE_SERVER_PASSWORD`; the username defaults
to `opencode` and can be changed with `OPENCODE_SERVER_USERNAME`. Do not pass
passwords on command lines, put them in source control, or expose debug/config
output containing API keys. The native frontend retains its own upstream CSP.

## Tests

```sh
npm test                 # legacy + bridge + gateway/API integration/security
npm run test:browser     # real Chromium + local provider + real OpenCode engine
```

Browser tests exercise a real approved shell operation in a temporary project,
file attachments, streaming/tool rendering, Markdown XSS stripping, session
reload/rename/export/undo/restore, model search, theme persistence, mobile
layout, native-interface navigation, and API-key persistence outside browser
storage. No real API key is needed.

On Linux, development dependencies provide a headless Chromium binary through
npm, including the support libraries used by the test helper. It is **not** a
production dependency. On other platforms use an installed Playwright browser
or set `CHROMIUM_EXECUTABLE_PATH`. Tests write ignored `test-results/` artifacts.
CI runs the normal suite on Node 20/22 and browser tests on Node 22.

## Known boundaries

- Browser uploads, image/multimodal attachment controls, a terminal emulator,
  project switching and full inline editing are not reimplemented here. Use
  the full native UI where supported. The branded app operates on the directory
  where the server was launched.
- Connecting a provider refreshes the engine context. The UI checks for active
  runs and asks you to stop them first; sessions stay in the native database.
- Legacy and native session formats remain separate; there is no silent import.
- Native desktop binaries, commercial/hosted services and the upstream monorepo
  are not vendored. See [OPENCODE.md](OPENCODE.md) for provenance and licensing.
