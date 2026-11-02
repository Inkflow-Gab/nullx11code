// Web server: static UI + JSON/SSE API. Zero dependencies (node:http).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { VERSION, loadConfig, saveProjectConfig } from './config.js';
import { allProviders, resolveProvider, listModels, guessModel } from './providers.js';
import { discoverSkills, setSkillEnabled, skillsPrompt } from './skills.js';
import { discoverExtras } from './extracmds.js';
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

        if (p === '/api/chat' && req.method === 'POST') {
          const body = JSON.parse((await readBody(req)) || '{}');
          const prov = resolveProvider(cfg, body.provider || cfg.provider);
          const models = await listModels(prov, cfg);
          const model = body.model && body.model !== 'auto' ? body.model : guessModel(prov, models);
          const skills = discoverSkills(cfg, cwd);
          const enabledSkills = skills.filter((s) => (body.skills ? body.skills.includes(s.name) : s.enabled));

          const baseSys = [
            `You are nullx11code, a concise AI coding agent running in a web UI connected to the local project at ${cfg._root}.`,
            'Use the provided tools when file context is unknown. The user approves write_file and shell actions.',
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
          req.on('close', () => abort.abort());

          let approvalWaiter = null;
          const approvals = new Map();

          const approve = (action) => {
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

          // client answers approvals via POST /api/approve?id=..
          server.approvals = approvals;

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
