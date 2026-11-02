# Branding and upstream feature access (0.5.0)

nullx11code uses the complete official `opencode-ai@1.19.5` runtime for its
terminal, agent tools, native API and advanced browser application. The source
commit, license and notices remain in OPENCODE.md and THIRD_PARTY_NOTICES.md.

## Product presentation

| Surface | nullx11code presentation | Mechanism |
|---|---|---|
| Public command / aliases | `nullx11code`, `n11` | Node entrypoint |
| Terminal home | logo and tagline | official TUI `home_logo` slot |
| Terminal footer | product identity + engine attribution | additive `app_bottom` slot |
| Terminal window title | nullx11code + session name | presentation method wrapper, disposed with the plugin |
| Native command help | public command invocations | finite help-output formatting only |
| Shell completion | both public command aliases | generated completion script + native callback routing |
| Focused browser app | complete custom nullx11code UI | same-origin gateway backed by the native API |
| Advanced browser app | product bar, title/favicon, decorative logos | HTML metadata + local presentation-only JS/CSS |

The TUI plugin leaves native input handling, prompts, dialogs, approvals,
sidebar contents, MCP/LSP indicators, keybindings, tools and model streaming
intact. It uses the extension points shipped in the pinned native release; no
Bun installation or separate source build is required by the user.

Browser branding targets known decorative logo components in the pinned
release. It never performs global string replacement on DOM text nodes or
rewrites JavaScript bundles. Conversation text, code, provider names, protocol
fields and tool output are not rebranded. Upstream engine/provider dialogs may
still contain factual OpenCode names and upstream links. This is deliberate,
not a claim of an independently implemented engine or upstream endorsement.

## Configuration and opt-outs

The terminal launcher adds a small generated TUI config under
`~/.nullx11code/runtime` (or `NULLX11_HOME/runtime`). Native global/project
TUI configs continue to load. If `OPENCODE_TUI_CONFIG` is explicitly set, its
JSON/JSONC settings are copied into the generated config and relative plugin
paths are resolved against the original directory. The original file is not
modified. Generated files are content-addressed and private (0600 on POSIX).
They are not committed. Remove unused generated configs when no terminals are
running if you want to clear the cache.

Your theme, keybindings and explicit `plugin_enabled` choices are respected.
To disable the automatic presentation extension:

```sh
NULLX11_NO_BRANDING=1 nullx11code
```

`--pure` continues to disable external TUI plugins, including this branding
plugin. The explicit `upstream` CLI bypasses all compatibility/presentation
adapters:

```sh
nullx11code upstream
nullx11code upstream web --hostname 127.0.0.1 --port 7860
```

`/?experience=advanced` opens the complete advanced app through the branded
gateway. The older `/?experience=upstream` URL remains a compatible alias, also
branded through the gateway. Run `upstream web` for an exact native server.

The product's `upgrade` command uses nullx11code's update instructions, rather
than letting a native binary self-upgrade outside the pinned dependency.
`uninstall` prints `npm uninstall -g nullx11code`; it does not silently remove
session data. Exact native management operations remain available explicitly
through `upstream`.

## Upstream scope — not a wholesale monorepo fork

Full native capabilities supplied by the pinned CLI/runtime remain accessible:
terminal chat, server attachment, sessions/import/export, tools, subagents,
MCP, ACP, LSP integrations, plugins, model variants, permissions, stats, GitHub
commands, native terminal panes/editor UI, and native settings. Availability
still depends on provider support, credentials, external tools and configuration.
Not every feature has been independently exercised in this repository.

Not included or claimed as ported:

- Native desktop installers and their OS-specific packaging/updaters.
- Upstream hosted console, commercial services, infrastructure and accounts.
- Every future/unreleased change on upstream main (the runtime is pinned).
- A source-level rebrand of every internal namespace, error string or SDK.

Renaming `OPENCODE_*` variables, native provider IDs, authentication protocols,
configuration directories or legal notices would break existing integrations
or misrepresent provenance. Those are intentionally retained. The repository
integrates the released software, not every project in the upstream monorepo.

## Validation

- Unit tests check private TUI-config generation, JSONC preservation, help and
  completion formatting, and HTML transformation without content rewriting.
- A real pseudo-terminal integration test verifies the native runtime loads
  the shipped TSX plugin and renders the nullx11code logo in alternate-screen
  mode. It runs where Python/PTY and the optional runtime are available.
- Browser tests navigate to the complete advanced app and verify the product
  bar/title while native project controls remain usable.
- Existing provider, permission, session, streaming, security and browser
  workflow tests continue to run without real API keys.
