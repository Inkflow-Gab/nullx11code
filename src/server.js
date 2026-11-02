// Web server: static UI + JSON/SSE API. Zero dependencies (node:http).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { VERSION, loadConfig, saveProjectConfig, loadInstructions } from './config.js';
import { allProviders, resolveProvider, listModels, guessModel } from './providers.js';
import { discoverSkills, setSkillEnabled, skillsPrompt } from './skills.js';
import { discoverExtras, renderExtra, commandEntries, resolveInvocation } from './extracmds.js';
import { COMMANDS, findCommand } from './commands.js';
import { evaluate, actionForKind } from './permissions.js';
import { expandMentions } from './mentions.js';
import { createSession, saveSession, loadSession, listSessions } from './sessions.js';
import { runTurn } from './chat.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, 'web');
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8',
};

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (ch) => {
      size += ch.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(ch);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function lanAddress() {
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const it of ifs[name] || []) {
      if (it.family === 'IPv4' && !it.internal) return it.address;
    }
  }
  return null;
}

function serveFile(res, absPath) {
  fs.readFile(absPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=300',
    });
    res.end(data);
  });
}

export async function startServer({ port = 7860, host = '0.0.0.0', cfg: cfgIn, cwd = process.cwd() } = {}) {
  let cfg = cfgIn || loadConfig(cwd);

  const reloadCfg = () => {
    cfg = loadConfig(cwd);
    return cfg;
  };

  // shared state for server-side slash commands (full CLI parity in the web UI)
  const webState = {
    get cfg() {
      return cfg;
    },
    prov: resolveProvider(cfg, cfg.provider),
    model: cfg.model || null,
    models: [],
    cwd,
    agent: 'build',
    messages: [],
    session: null,
    skills: [],
    extras: [],
    todos: [],
    quitting: false,
    refreshSkills() {
      this.skills = discoverSkills(cfg, cwd);
    },
    refreshExtras() {
      this.extras = discoverExtras(cfg, cwd);
    },
    newSession() {
      return 'Conversation reset is handled by the web UI.';
    },
    clearScreen() {},
    quit() {},
    cmd: async (name, args) => {
      const cmd = findCommand(name);
      if (!cmd) return `Unknown command: ${name}`;
      try {
        return (await cmd.run(webState, args)) ?? null;
      } catch (e) {
        return `error: ${e.message}`;
      }
    },
  };
  webState.refreshSkills();
  webState.refreshExtras();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;

    try {
      // ---------- API ----------
      if (p.startsWith('/api/')) {
        res.setHeader('access-control-allow-origin', '*');
        res.setHeader('access-control-allow-headers', 'content-type');
        res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        if (p === '/api/state' && req.method === 'GET') {
          reloadCfg();
          const providers = allProviders(cfg).map((x) => ({
            id: x.id,
            name: x.name,
            color: x.color,
            free: x.free,
            local: !!x.local,
            custom: !!x.custom,
            hasEnv: !!(x.env && x.env.length),
            detected: x.detected,
            base: x.base,
            notes: x.notes,
            keyUrl: x.keyUrl,
          }));
          const skills = discoverSkills(cfg, cwd).map((s) => ({
            name: s.name,
            description: s.description,
            always: s.always,
            enabled: s.enabled,
            source: s.source,
          }));
          const extras = discoverExtras(cfg, cwd).map((x) => ({
            name: x.name,
            description: x.description,
            example: x.example,
            path: x.path,
          }));
          sendJSON(res, 200, {
            version: VERSION,
            providers,
            skills,
            extras,
            settings: {
              provider: cfg.provider,
              model: cfg.model,
              temperature: cfg.temperature,
              port,
            },
            sessions: listSessions({ cwd, limit: 20 }),
            root: cfg._root,
          });
          return;
        }

        if (p === '/api/models' && req.method === 'GET') {
          const prov = resolveProvider(cfg, url.searchParams.get('provider') || cfg.provider);
          const models = await listModels(prov, cfg, { refresh: url.searchParams.get('refresh') === '1' });
          const chosen = cfg.model && cfg.model !== 'auto' ? cfg.model : guessModel(prov, models);
          sendJSON(res, 200, { provider: { id: prov.id, name: prov.name, color: prov.color }, models, suggested: chosen });
          return;
        }

        if (p === '/api/sessions' && req.method === 'GET') {
          sendJSON(res, 200, { sessions: listSessions({ cwd, limit: 30 }) });
          return;
        }

        if (p.startsWith('/api/session/') && req.method === 'GET') {
          const id = p.split('/')[3];
          const s = loadSession(id, { cwd });
          if (!s) return sendJSON(res, 404, { error: 'not found' });
          return sendJSON(res, 200, s);
        }

        if (p === '/api/skills/toggle' && req.method === 'POST') {
          const { name, enabled } = JSON.parse((await readBody(req)) || '{}');
          reloadCfg();
          setSkillEnabled(cfg, name, !!enabled, (patch) => saveProjectConfig(patch, cwd));
          const skills = discoverSkills(cfg, cwd);
          return sendJSON(res, 200, {
            skills: skills.map((s) => ({ name: s.name, description: s.description, always: s.always, enabled: s.enabled, source: s.source })),
          });
        }

        if (p === '/api/skills/add' && req.method === 'POST') {
          const { dir } = JSON.parse((await readBody(req)) || '{}');
          if (!dir) return sendJSON(res, 400, { error: 'dir required' });
          const abs = path.isAbsolute(dir) ? dir : path.resolve(cfg._root, dir);
          if (!fs.existsSync(abs)) return sendJSON(res, 404, { error: `not found: ${abs}` });
          const dirs = [...(cfg.skills?.dirs || []), abs];
          cfg.skills = { ...cfg.skills, dirs: [...new Set(dirs)] };
          saveProjectConfig({ skills: cfg.skills }, cwd);
          reloadCfg();
          const skills = discoverSkills(cfg, cwd);
          return sendJSON(res, 200, {
            dirs: cfg.skills.dirs,
            skills: skills.map((s) => ({ name: s.name, description: s.description, always: s.always, enabled: s.enabled, source: s.source })),
          });
        }

        if (p === '/api/settings' && req.method === 'POST') {
          const patch = JSON.parse((await readBody(req)) || '{}');
          saveProjectConfig(patch, cwd);
          reloadCfg();
          return sendJSON(res, 200, { ok: true });
        }

        if (p === '/api/keys' && req.method === 'POST') {
          // easy key setup from the browser — writes .env like /setup does
          const { provider, key } = JSON.parse((await readBody(req)) || '{}');
          const list = allProviders(cfg);
          const hit = list.find((x) => x.id === provider && !x.local && !x.custom);
          if (!hit) return sendJSON(res, 404, { error: 'unknown provider' });
          if (!hit.env?.length) return sendJSON(res, 400, { error: `${hit.name} uses config, not .env` });
          const clean = String(key || '').trim().replace(/^["']|["']$/g, '');
          if (!clean) return sendJSON(res, 400, { error: 'key required' });
          const envName = hit.env[0];
          const envFile = path.join(cfg._root, '.env');
          let content = '';
          try {
            content = fs.readFileSync(envFile, 'utf8');
          } catch {
            /* fresh file */
          }
          const line = `${envName}=${clean}`;
          const re = new RegExp(`^\\s*(?:export\\s+)?${envName}\\s*=.*$`, 'm');
          content = re.test(content) ? content.replace(re, line) : content.replace(/\s*$/, '\n') + line + '\n';
          fs.writeFileSync(envFile, content);
          process.env[envName] = clean;
          reloadCfg();
          return sendJSON(res, 200, { ok: true, provider: hit.id, envVar: envName, file: envFile });
        }

        if (p === '/api/chat' && req.method === 'POST') {
          const body = JSON.parse((await readBody(req)) || '{}');
          const prov = resolveProvider(cfg, body.provider || cfg.provider);
          const models = await listModels(prov, cfg);
          const model = body.model && body.model !== 'auto' ? body.model : guessModel(prov, models);
          const skills = discoverSkills(cfg, cwd);
          const enabledSkills = skills.filter((s) => (body.skills ? body.skills.includes(s.name) : s.enabled));

          const instructions = loadInstructions(cfg._root)
            .map((f) => `# Instructions from ${f.path}\n\n${f.text}`)
            .join('\n\n');
          const baseSys = [
            `You are nullx11code, a concise AI coding agent running in a web UI connected to the local project at ${cfg._root}.`,
            'Use the provided tools when file context is unknown. The user approves write_file and shell actions.',
            instructions,
            cfg.systemPrompt || '',
            skillsPrompt(enabledSkills),
          ]
            .filter(Boolean)
            .join('\n\n');

          // session messages: server owns system prompt
          const history = Array.isArray(body.messages) ? body.messages : [];
          const messages = [{ role: 'system', content: baseSys }, ...history];

          // SSE response
          res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
          });
          const send = (obj) => {
            try {
              res.write(`data: ${JSON.stringify(obj)}\n\n`);
            } catch {
              /* client gone */
            }
          };

          const abort = new AbortController();
          const approvals = new Map();
          const askers = new Map();
          req.on('close', () => {
            abort.abort();
            for (const [, w] of approvals) w(false);
            approvals.clear();
            for (const [, w] of askers) w(null);
            askers.clear();
          });
          server.approvals = approvals;
          server.askers = askers;

          const approve = (action) => {
            // plan agent: deny mutations outright (CLI parity)
            if (webState.agent === 'plan' && (action.kind === 'write' || action.kind === 'shell')) {
              send({ type: 'notice', text: `denied (plan agent): ${action.title}` });
              return Promise.resolve(false);
            }
            // permission rules from config (deny > allow > default)
            const permAction = actionForKind(action.kind);
            const effect = evaluate(permAction, action.resource ?? '*', cfg.permissions);
            if (effect === 'deny') {
              send({ type: 'notice', text: `denied by rule: ${permAction} ${action.resource ?? ''}` });
              return Promise.resolve(false);
            }
            if (effect === 'allow') {
              send({ type: 'notice', text: `allowed by rule (${permAction})` });
              return Promise.resolve(true);
            }
            if (!body.approveTools) return Promise.resolve(false);
            const id = `ap_${Math.random().toString(36).slice(2, 10)}`;
            send({ type: 'approval', id, action });
            return new Promise((resolve) => {
              approvals.set(id, resolve);
              // auto-timeout after 5 minutes
              setTimeout(() => {
                if (approvals.has(id)) {
                  approvals.delete(id);
                  resolve(false);
                }
              }, 300_000);
            });
          };

          const askQuestions = (questions) => {
            const id = `q_${Math.random().toString(36).slice(2, 10)}`;
            send({ type: 'question', id, questions });
            return new Promise((resolve) => {
              askers.set(id, resolve);
              setTimeout(() => {
                if (askers.has(id)) {
                  askers.delete(id);
                  resolve(null);
                }
              }, 300_000);
            });
          };

          try {
            for await (const ev of runTurn({
              prov,
              model,
              messages,
              ctx: {
                root: cfg._root,
                cwd,
                temperature: cfg.temperature,
                maxTokens: cfg.maxTokens,
                approve,
                askQuestions,
                skills: webState.skills,
                agent: webState.agent,
                get todos() {
                  return webState.todos;
                },
                set todos(v) {
                  webState.todos = v;
                },
              },
              signal: abort.signal,
            })) {
              if (abort.signal.aborted) break;
              if (ev.type === 'delta') send({ type: 'delta', text: ev.text });
              else if (ev.type === 'tool_start') send({ type: 'tool_start', id: ev.id, name: ev.name, args: ev.args });
              else if (ev.type === 'tool_end') send({ type: 'tool_end', id: ev.id, name: ev.name, result: ev.result });
              else if (ev.type === 'error') send({ type: 'error', message: ev.message });
              else if (ev.type === 'done') send({ type: 'done', usage: ev.usage || null, steps: ev.steps, model, provider: prov.id });
            }
          } catch (e) {
            if (!abort.signal.aborted) send({ type: 'error', message: e.message || String(e) });
          }
          send({ type: 'end' });
          res.end();
          return;
        }

        if (p === '/api/approve' && req.method === 'POST') {
          const { id, approved } = JSON.parse((await readBody(req)) || '{}');
          const waiter = server.approvals?.get(id);
          if (waiter) {
            server.approvals.delete(id);
            waiter(!!approved);
          }
          return sendJSON(res, 200, { ok: true });
        }

        if (p === '/api/answer' && req.method === 'POST') {
          const { id, answers } = JSON.parse((await readBody(req)) || '{}');
          const waiter = server.askers?.get(id);
          if (waiter) {
            server.askers.delete(id);
            waiter(Array.isArray(answers) ? answers : null);
          }
          return sendJSON(res, 200, { ok: true });
        }

        // command palette: list builtin + custom commands for the web slash popup
        if (p === '/api/commands' && req.method === 'GET') {
          const entries = commandEntries(COMMANDS, webState.extras);
          return sendJSON(
            res,
            200,
            entries.map((e) => ({ name: e.name, desc: e.description || '', kind: e.kind, example: e.example || '' }))
          );
        }

        // run a slash command server-side (model switching, help, extras → prompt…)
        if (p === '/api/command' && req.method === 'POST') {
          const { name, args = '' } = JSON.parse((await readBody(req)) || '{}');
          const bare = String(name || '').replace(/^\//, '');
          webState.refreshExtras();
          const entries = commandEntries(COMMANDS, webState.extras);
          const inv = resolveInvocation(entries, bare);
          let output = null;
          let prompt = null;
          if (inv.kind === 'exact' || inv.kind === 'unique') {
            const m = inv.match;
            if (m.kind === 'builtin') {
              const out = await webState.cmd(m.name, String(args));
              if (out && typeof out === 'object' && out.prompt) {
                prompt = out.prompt;
              } else {
                output = out;
              }
            } else {
              prompt = renderExtra(m.ref, String(args), { root: cfg._root || cwd });
              output = `> /${m.name}${String(args) ? ' · ' + args : ''}`;
            }
          } else if (inv.kind === 'ambiguous') {
            output = `matches: ${inv.candidates.map((c) => '/' + c.name).join(', ')}`;
          } else {
            output = `unknown command /${bare} — try /api/commands`;
          }
          return sendJSON(res, 200, {
            output,
            prompt,
            model: webState.model,
            provider: webState.prov?.id ?? cfg.provider,
            agent: webState.agent,
          });
        }

        // expand @file mentions (and attached images) server-side
        if (p === '/api/expand' && req.method === 'POST') {
          const { text } = JSON.parse((await readBody(req)) || '{}');
          const expanded = expandMentions(String(text || ''), cfg._root || cwd);
          return sendJSON(res, 200, {
            text: expanded.text,
            files: expanded.files,
            images: expanded.images,
          });
        }

        sendJSON(res, 404, { error: 'unknown api route' });
        return;
      }

      // ---------- static ----------
      let rel = p === '/' ? '/index.html' : p;
      // assets can live in /assets (repo) — map to repo assets dir
      if (rel.startsWith('/assets/')) {
        const abs = path.join(ASSETS_DIR, rel.slice('/assets/'.length));
        if (!abs.startsWith(ASSETS_DIR)) {
          res.writeHead(403);
          res.end('forbidden');
          return;
        }
        return serveFile(res, abs);
      }
      const abs = path.join(WEB_DIR, rel);
      if (!abs.startsWith(WEB_DIR)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return serveFile(res, abs);
      // SPA fallback
      serveFile(res, path.join(WEB_DIR, 'index.html'));
    } catch (e) {
      sendJSON(res, 500, { error: e.message || String(e) });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const actualPort = server.address().port;
  const lan = lanAddress();
  return {
    server,
    port: actualPort,
    url: `http://localhost:${actualPort}`,
    lanUrl: lan ? `http://${lan}:${actualPort}` : null,
    close: () => new Promise((r) => server.close(r)),
  };
}
