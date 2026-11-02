// Entry point: argv parsing + command dispatch.
import fs from 'node:fs';
import path from 'node:path';
import { c, setColors, banner, modelBadge, providerBadge, table, hex, familyChip } from './ui.js';
import { VERSION, loadConfig, globalDir } from './config.js';
import { allProviders, resolveProvider, listModels, guessModel } from './providers.js';
import { discoverSkills } from './skills.js';

const HELP = `
${c.bold('nullx11code')} ${c.dim('v' + VERSION)} — free-first AI coding agent (terminal + web)

${c.bold('USAGE')}
  nullx11code                  start interactive chat
  nullx11code "prompt"         one-shot answer, then exit
  nullx11code -p "prompt"      same as above (explicit print mode)

${c.bold('COMMANDS')}
  serve [port]                 launch the web UI (default port 7860)
  providers                    list providers + detected keys
  models                       list models for a provider (--provider x)
  skills                       manage project skills
  doctor                       diagnose keys / network / skills
  config                       show config path and contents
  icon [app|cli|provider]      print built-in icons
  update                       how to update this install
  version | help

${c.bold('OPTIONS')}
  --provider <id>              nvidia | groq | cerebras | openrouter | gemini | mistral | github | ollama | ...
  --model <id|auto>            model id (auto = best free pick)
  --no-color                   disable ANSI colors
  -y, --yes                    auto-approve tool actions (print mode)
  --resume [id]                resume a saved session
  -v, --version                version

${c.bold('ENV KEYS (free tiers)')}
  NVIDIA_API_KEY  GROQ_API_KEY  CEREBRAS_API_KEY  OPENROUTER_API_KEY
  GEMINI_API_KEY  MISTRAL_API_KEY  GITHUB_TOKEN  …  (or a project .env)

${c.dim('Web UI:      nullx11code serve')}
${c.dim('Skills:      .nullx11code/skills/<name>/SKILL.md   (or /skills add <dir>)')}
${c.dim('Docs:        README.md · docs/BRAINSTORM.md')}
`;

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-p' || a === '--print') opts.print = argv[++i] ?? '';
    else if (a === '--provider') opts.provider = argv[++i];
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--host') opts.host = argv[++i];
    else if (a === '--no-color') opts.noColor = true;
    else if (a === '-y' || a === '--yes') opts.yes = true;
    else if (a === '--resume') {
      const next = argv[i + 1];
      opts.resume = next && !next.startsWith('-') ? argv[++i] : true;
    } else if (a === '-v' || a === '--version') opts.version = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else opts._.push(a);
  }
  return opts;
}

export async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.noColor) setColors(false);

  const cmd = opts._[0];
  const rest = opts._.slice(1);

  if (opts.version || cmd === 'version') {
    console.log(`nullx11code v${VERSION} (node ${process.version}, ${process.platform})`);
    return;
  }
  if (opts.help || cmd === 'help' || cmd === '--help') {
    console.log(HELP);
    return;
  }

  if (cmd === 'update') {
    console.log([
      c.bold('Update nullx11code'),
      '',
      `  ${c.cyan('npm i -g https://codeload.github.com/Inkflow-Gab/nullx11code/tar.gz/refs/heads/main')}`,
      '',
      c.dim('or re-run the installer:'),
      `  ${c.cyan('curl -fsSL https://raw.githubusercontent.com/Inkflow-Gab/nullx11code/main/install.sh | sh')}`,
    ].join('\n'));
    return;
  }

  if (cmd === 'serve') {
    const cfg = loadConfig();
    const port = opts.port || Number(rest[0]) || cfg.port || 7860;
    const { startServer } = await import('./server.js');
    const info = await startServer({ port, host: opts.host || cfg.host || '0.0.0.0', cfg, cwd: process.cwd() });
    console.log(banner({ providers: allProviders(cfg).filter((p) => p.detected).length }));
    console.log(`\n  ${c.green('▸')} web UI running → ${c.cyan(info.url)}`);
    console.log(`  ${c.dim('LAN / mobile:')} ${c.cyan(info.lanUrl || info.url)}`);
    console.log(`  ${c.dim('Ctrl+C to stop\n')}`);
    // keep alive
    await new Promise(() => {});
    return;
  }

  if (cmd === 'providers') {
    const cfg = loadConfig();
    const list = allProviders(cfg);
    console.log(
      table(
        ['provider', 'cost', 'key', 'endpoint'],
        list.map((p) => [
          hex(p.id, p.color),
          p.free ? c.green('free') : c.dim('paid'),
          p.detected ? c.green('✓') : c.yellow('✗'),
          c.dim(p.base.replace(/^https?:\/\//, '')),
        ])
      )
    );
    console.log(c.dim('\nadd keys via project .env or ~/.nullx11code/.env — then `nullx11code doctor`'));
    return;
  }

  if (cmd === 'models') {
    const cfg = loadConfig();
    const prov = resolveProvider(cfg, opts.provider);
    const models = await listModels(prov, cfg, { refresh: true });
    console.log(`${providerBadge(prov)} ${c.dim(prov.base)}`);
    if (!models.length) console.log(c.yellow('  no models found (unreachable + no fallback catalog)'));
    for (const m of models.slice(0, 80)) console.log(`  ${familyChip(m.id)}  ${m.id}${m.context ? c.dim(`  ctx ${Math.round(m.context / 1024)}k`) : ''}`);
    return;
  }

  if (cmd === 'skills') {
    const cfg = loadConfig();
    const skills = discoverSkills(cfg);
    if (!skills.length) {
      console.log(c.yellow('No skills found. Create .nullx11code/skills/<name>/SKILL.md or run the app and /skills new <name>.'));
      return;
    }
    for (const s of skills) {
      console.log(`  ${s.enabled ? c.green('✓') : c.dim('○')} ${c.bold(s.name)}  ${c.dim(s.description || '')}`);
    }
    return;
  }

  if (cmd === 'doctor') {
    const cfg = loadConfig();
    console.log(banner({ providers: allProviders(cfg).filter((p) => p.detected).length }));
    console.log(`  node     ${c.dim(process.version)}`);
    console.log(`  home     ${c.dim(globalDir())}`);
    const list = allProviders(cfg);
    const keys = list.filter((p) => p.detected && !p.local);
    console.log(`  keys     ${keys.length ? c.green(keys.map((p) => p.id).join(', ')) : c.yellow('none — copy .env.example to .env and add a free key')}`);
    const local = list.filter((p) => p.local);
    for (const p of local) {
      try {
        const r = await fetch(p.base.replace(/\/+$/, '') + '/models', { signal: AbortSignal.timeout(1500) });
        console.log(`  local    ${p.id} ${r.ok ? c.green('✓ running') : c.yellow('responded ' + r.status)}`);
      } catch {
        console.log(`  local    ${p.id} ${c.dim('not running')}`);
      }
    }
    const skills = discoverSkills(cfg);
    console.log(`  skills   ${skills.length ? c.green(skills.filter((s) => s.enabled).length + ' active / ' + skills.length) : c.dim('none')}`);
    return;
  }

  if (cmd === 'config') {
    const cfg = loadConfig();
    const p = path.join(globalDir(), 'config.json');
    const pp = path.join(cfg._root, '.nullx11code', 'config.json');
    console.log(c.bold('global: ') + p + (fs.existsSync(p) ? '' : c.dim(' (missing)')));
    console.log(c.bold('project:') + ' ' + pp + (fs.existsSync(pp) ? '' : c.dim(' (missing)')));
    const { _env, _global, _project, ...restCfg } = cfg;
    console.log('\n' + JSON.stringify(restCfg, null, 2));
    return;
  }

  if (cmd === 'icon') {
    const { COMMANDS } = await import('./commands.js');
    const ic = COMMANDS.find((x) => x.name === 'icon');
    console.log(await ic.run({ cfg: loadConfig(), prov: resolveProvider(loadConfig()), model: 'auto' }, rest.join(' ')));
    return;
  }

  if (cmd === 'banner') {
    const cfg = loadConfig();
    const prov = resolveProvider(cfg, opts.provider);
    const models = await listModels(prov, cfg);
    console.log(banner({ prov, model: opts.model || guessModel(prov, models), skills: discoverSkills(cfg).filter((s) => s.enabled).length, providers: allProviders(cfg).filter((p) => p.detected).length }));
    return;
  }

  // ---- default: chat ----
  const prompt = opts.print != null ? opts.print : rest.length ? rest.join(' ') : null;
  const nonInteractive = opts.print != null || !!prompt || !process.stdin.isTTY;

  if (nonInteractive) {
    const text = prompt ?? (await readStdin());
    if (!text) {
      console.error('no prompt given');
      process.exitCode = 1;
      return;
    }
    const { runPrint } = await import('./cli.js');
    await runPrint(text, opts);
    return;
  }

  const { runInteractive } = await import('./cli.js');
  await runInteractive(opts);
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  let buf = '';
  for await (const chunk of process.stdin) buf += chunk;
  return buf.trim();
}
