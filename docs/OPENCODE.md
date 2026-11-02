# OpenCode-powered nullx11code

## What this upgrade actually includes

Starting with **0.3.0**, the default terminal UI, agent engine, API server and
native browser app are the actual **OpenCode 1.19.5** distribution, installed through
its official `opencode-ai` npm package. This is a runtime integration, not a
rewrite of its screens or a wholesale copy of its monorepo. The runtime ships
its browser assets in the executable; the web app can load without the hosted
OpenCode frontend.

This gives nullx11code the upstream full-screen composer, streaming messages,
model/agent selectors, tool and permission dialogs, sessions, themes, file
context, diffs/undo, compaction, MCP, LSP support, plugins, subagents, ACP,
usage statistics, and terminal/server attachment capabilities supplied by that
release. Some features need extra configuration, external executables, network
access or provider support. Merely installing the runtime does not configure
MCP servers, language servers, plugins or credentials for you.

**Not included:** the upstream Electron desktop application, hosted commercial
services/console, infrastructure, documentation website, GitHub-hosted account
services, or every change on upstream `main`. This is not a fully rebranded
source fork: the engine and provider identifiers remain OpenCode-compatible. **0.4.0 adds
a separately branded browser workspace**, and **0.5.0 adds native terminal and
advanced-browser presentation branding**. See [WORKSPACE.md](WORKSPACE.md) and
[BRANDING.md](BRANDING.md). No claim is made that every upstream feature has been independently
tested here.

## Install / launch

```sh
npm install                       # source checkout; native optional deps enabled
npm start                         # real OpenCode terminal UI
node bin/nullx11code.js serve      # bundled OpenCode browser app, port 7860
node bin/nullx11code.js -p "explain this repository"
node bin/nullx11code.js --help
```

For an existing global installation, reinstall nullx11code with the usual
installer/npm command. Do not pass `--omit=optional` or `--ignore-scripts` if
you want the native runtime. `npm ci --include=optional` uses the checked-in
lockfile for a reproducible checkout installation.

Supported runtime targets are the Linux, macOS and Windows x64/arm64 targets
published upstream (including the upstream Linux musl/baseline variants).
Android/Termux and other unsupported native targets can still use
`nullx11code legacy` on Node >=18.17. The runtime is optional at the npm level
so unsupported platforms can install the dependency-free legacy implementation.
A missing/broken runtime produces an actionable error, not a silent downgrade.

The branded browser workspace also uses the small Marked and DOMPurify npm
dependencies; these do not change the legacy implementation.

The modern engine needs more disk/RAM than the old dependency-free CLI. Its
platform binaries are installed into `node_modules`, never committed here.

## Command mapping

| nullx11code | Behavior |
|---|---|
| no arguments in a terminal | real full-screen OpenTUI interface |
| `"prompt"` or `-p "prompt"` | upstream `run` |
| piped stdin, no arguments | upstream `run`, consuming stdin |
| `./directory` | upstream TUI in that directory |
| `serve [port]`, `web` | branded workspace/gateway, bound to `0.0.0.0:7860` by default; advanced UI at `/?experience=advanced` |
| `serve-api` | upstream headless `serve`, native loopback defaults |
| `--provider nvidia --model meta/llama-3.3-70b-instruct` | bridged provider/model |
| `--model anthropic/claude-sonnet-4-5` | native provider/model identifier |
| `--resume [id]` | upstream `--continue` / `--session` |
| `-y`, `--yes` | upstream `--auto`, explicitly enabling auto-approval |
| `setup`, `doctor`, `skills`, `config`, `icon`, `banner`, `update` | original nullx11code helpers |
| `upstream <arguments...>` | exact native CLI, **without** compatibility config/env loading |
| `legacy <arguments...>` | original CLI, one-shot mode or browser app |

`run`, `attach`, `models`, `mcp`, `acp`, `agent`, `session`, `stats`, `export`,
`import`, `auth`, `providers`, `plugin`, `debug`, `db`, `github`, `pr` and
`completion` dispatch to upstream. Use `<command> --help` for its options.
Native subcommand flags retain their native meanings: in particular, `run -p`
is the upstream server-password option; use top-level `-p` for legacy-style
print mode. For unusual positional arguments, use `run` explicitly.

`providers` now manages native credentials. The old provider table is
`nullx11code legacy providers`. The old model discovery is available through
`nullx11code legacy models`. Generated completions are rebranded for `nullx11code` and `n11`, including
the native yargs completion callback. `upstream completion` retains stock behavior.

## Existing configuration bridge

Original files are not rewritten, renamed or deleted:

- Project/global `.env` files are loaded; process environment takes precedence.
- Built-in free-first and custom OpenAI-compatible providers are added under
  `nullx11-<provider>` IDs, avoiding collisions with upstream providers.
- A configured provider or the first detected free non-local provider becomes
  the default. Local Ollama/LM Studio can be selected explicitly. No live model
  discovery occurs during startup: the existing fallback/configured catalog
  is used. To add another model, use `--provider <id> --model <exact-id>` or
  configure the provider's `models` array.
- Explicit `--provider` keeps model IDs with `/` intact. Without `--provider`,
  a CLI `--model` value containing `/` is interpreted as a native qualified ID.
- Keys are supplied to the child through its environment; generated config
  uses environment references. No generated config/key file is written and
  keys are not passed as command-line arguments. Upstream necessarily receives
  credentials in memory. Do not publish debug/config output containing secrets.
- Enabled/always-on legacy skills and extra system instructions are included
  in the build/plan agent prompts. Disabled legacy skills are not enabled.
  This is ambient instruction compatibility, not registration in the native
  skill picker. Native `.opencode/skills` remain available independently.
- Legacy project/global instruction files and custom Markdown slash commands
  are bridged. Native `AGENTS.md`/`CLAUDE.md` discovery remains upstream's job.
  Command templates are not executed during discovery. Native invocation
  semantics apply when a command is actually used.
- Legacy permission rules map `shell` to native `bash`, preserve deny priority
  for supported actions and apply a safe `ask` default for writes/shell.
  Repository reads and skill access are allowed by default. Upstream glob
  matching semantics apply (unlike legacy's case-insensitive matcher).
  Legacy `approvals` toggles are not translated into auto-approval.

Default agent safety policies still apply, especially the plan agent's
read-only restrictions. Custom plugins/tools, commands and MCP servers can
execute code; only enable trusted ones.

### Advanced upstream configuration

Native `opencode.json` / `opencode.jsonc` and `.opencode` resources are still
loaded. The bridge is supplied through `OPENCODE_CONFIG_CONTENT` and has
higher priority than ordinary native config files for overlapping keys.
Non-overlapping native features such as MCP, LSP, themes and plugins remain
available. For completely unmodified native configuration behavior:

```sh
nullx11code upstream              # exact upstream terminal UI
nullx11code upstream web --hostname 0.0.0.0 --port 7860
```

To override bridged defaults while keeping the compatibility features, add a
V1-native `opencode` block to `.nullx11code/config.json`:

```json
{
  "provider": "nvidia",
  "opencode": {
    "permission": {
      "bash": { "*": "ask", "git status*": "allow", "rm *": "deny" }
    },
    "mcp": {
      "example": {
        "type": "local",
        "command": ["your-trusted-mcp-server"]
      }
    }
  }
}
```

An already-set `OPENCODE_CONFIG_CONTENT` JSON object overrides this block.
Explicit compatibility CLI provider/model flags still win over config defaults.
The wrapper requires strict JSON for that environment variable; native JSONC
is available via `upstream`. This pinned runtime uses OpenCode V1 config keys
(`provider`, `permission`, `command`, `agent`), not newer V2 keys. Use the
schema/docs matching the pinned release.

## Sessions and data

The modern engine uses upstream's standard config/data/cache locations
(including its native auth store), honoring the upstream XDG variables.
It does **not** overwrite or import `.nullx11code/sessions`.

- Existing conversations: `nullx11code legacy --resume <old-id>`.
- New conversations: `nullx11code --resume`, `nullx11code session list`.
- New-engine export/import: `nullx11code export` / `nullx11code import`.

The two engines have different session formats. There is no automatic
migration, and old legacy slash commands are not all native slash commands.
Use the native command picker for the modern UI, or legacy for old workflows.

## Web security and previews

`serve` intentionally retains nullx11code's LAN-friendly `0.0.0.0` default.
An agent server can read/edit files and execute commands: **do not expose an
unauthenticated server to an untrusted network**. For local-only access:

```sh
nullx11code serve --host 127.0.0.1
```

For remote/LAN use, set a strong `OPENCODE_SERVER_PASSWORD` in the shell or
an ignored `.env` file before launch; the native username defaults to
`opencode`. Use HTTPS through a trusted proxy/tunnel and appropriate firewall
rules. Do not commit credentials. Provider API keys are still needed to chat.

The bundled browser app uses the same-origin API, so hosted previews do not
need browser requests to sandbox `localhost`. Bind to `0.0.0.0` for Arena
previews. The 0.4.0 gateway checks Host and Origin headers; set
`NULLX11_ALLOWED_HOSTS` when using a custom proxy hostname (see WORKSPACE.md). CORS exceptions can be passed to `upstream web --cors` when
needed; do not broadly allow arbitrary origins for a privileged agent server.

## Maintenance and validation

- Source project: https://github.com/anomalyco/opencode
- Distribution: `opencode-ai@1.19.5`, pinned in package.json/package-lock.json
- Matching source tag: `v1.19.5`
- Matching commit: `810c0eba1a7348036f8bdf61e6632d0c36c6876c`
- License: MIT; see `THIRD_PARTY_NOTICES.md` and the dependency's `LICENSE`.

The upstream monorepo is intentionally not vendored. To inspect/change it,
check out the matching tag separately and build according to upstream docs.
`NULLX11_OPENCODE_BIN=/absolute/path/to/executable` selects a custom build.
Compatibility with a different runtime version must be checked separately.

To upgrade the pinned distribution, update `opencode-ai`, `RUNTIME_VERSION`,
the provenance above, regenerate the lockfile, and run `npm test`. The bridge
disables upstream automatic upgrades by default so the tested dependency
cannot silently drift. `nullx11code update` updates nullx11code, not a separate
global OpenCode installation. Exact upstream management operations are
available through `upstream` and should be used deliberately.

Tests cover flag/config translation, secret handling, permission ordering,
process exit behavior, installer fallback persistence, the legacy suite, a
real native-engine streaming run against a local mock provider, and the
bundled web assets, authenticated API, effective permissions and native session
lifecycle. Native integration tests skip when the
optional executable is absent. `npm test` does not require a real API key.
