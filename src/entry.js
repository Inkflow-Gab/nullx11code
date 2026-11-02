// Public CLI router. The original implementation remains available explicitly.
import { VERSION } from './config.js';
import { RUNTIME_VERSION, LOCAL_COMMANDS, launchRuntime } from './runtime.js';

export const HELP = `
nullx11code v${VERSION} — powered by OpenCode ${RUNTIME_VERSION}

USAGE
  nullx11code                          full-screen nullx11code terminal UI
  nullx11code "explain this repo"      one-shot agent run
  nullx11code -p "fix the tests"        one-shot agent run
  nullx11code serve [port]             branded coding workspace (default 7860)
  nullx11code web                      same as serve; advanced workspace is one click away
  nullx11code serve-api                headless OpenCode API (loopback default)

AGENT FEATURES (OpenCode engine)
  run, attach, models, mcp, acp, agent, session, stats, export, import,
  auth, providers, plugin, debug, db, github, pr, completion
  nullx11code <command> --help         native command options
  nullx11code completion               shell completion for nullx11code / n11
  nullx11code upstream --help          complete upstream help
  nullx11code upstream <args...>       exact upstream CLI; no config bridge

COMPATIBILITY
  setup <provider> <key>               existing free-provider setup
  doctor, skills, config, icon, banner, update
  legacy <args...>                     original lightweight CLI and web UI
  --provider <id> --model <model-id>    use a nullx11code provider
  --model <provider/model>             use a native OpenCode model
  --resume [id]                        continue a new-engine session
  -y, --yes                            auto-approve (dangerous; explicit only)
  --host <host> --port <port>          web bind address and port
  --no-color                          disable colors

Existing .env keys, custom providers, enabled skills, project instructions,
custom slash commands and permission rules are bridged automatically.
Terminal and advanced-browser presentation use nullx11code branding.
Engine/provider identifiers and legal notices remain compatible. Old sessions remain
in legacy; they are not silently converted to OpenCode's database.
Web access binds to 0.0.0.0; set OPENCODE_SERVER_PASSWORD before exposing it.
See docs/OPENCODE.md for configuration, security and platform support.
`;

export async function entry(argv) {
  if (argv[0] === '--get-yargs-completions') {
    process.exitCode = await launchRuntime(['upstream', ...argv]);
    return;
  }
  if (argv[0] === 'uninstall') {
    console.log('To uninstall nullx11code, run: npm uninstall -g nullx11code\nLocal project data and native engine sessions are not automatically deleted.');
    return;
  }
  if (argv[0] === 'upgrade') argv = ['update', ...argv.slice(1)];
  if (argv[0] === 'legacy') {
    const { main } = await import('./main.js');
    return main(argv.slice(1));
  }
  if (argv.length === 1 && ['-v', '--version', 'version'].includes(argv[0])) {
    console.log(`nullx11code v${VERSION} · OpenCode ${RUNTIME_VERSION} (node ${process.version})`);
    return;
  }
  if (argv.length === 1 && ['-h', '--help', 'help'].includes(argv[0])) {
    console.log(HELP);
    return;
  }
  if (LOCAL_COMMANDS.has(argv[0])) {
    const { main } = await import('./main.js');
    return main(argv);
  }
  if (['serve', 'web'].includes(argv[0])) {
    if (argv.includes('--help') || argv.includes('-h')) {
      console.log('nullx11code serve [port] [--host address] [--port number] [--provider id] [--model id] [--pure]\n\nStarts the branded workspace and authenticated loopback OpenCode engine.\nAdvanced workspace: /?experience=advanced\nAll native server options: nullx11code upstream web --help');
      return;
    }
    const { serveWorkbench } = await import('./workbench-server.js');
    return serveWorkbench(argv);
  }
  if (argv[0] === 'serve-api') argv = ['upstream', 'serve', ...argv.slice(1)];
  process.exitCode = await launchRuntime(argv);
}
