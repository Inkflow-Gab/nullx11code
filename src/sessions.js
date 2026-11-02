// Session persistence: JSON files under ~/.nullx11code/sessions (or project .nullx11code/sessions).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { globalDir, projectDir, writeJson } from './config.js';

function sessionsDir(cwd = process.cwd(), project = false) {
  const dir = project ? path.join(projectDir(cwd), 'sessions') : path.join(globalDir(), 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function newSessionId() {
  const d = new Date();
  const stamp = d.toISOString().slice(0, 19).replace(/[-:T]/g, '');
  return `${stamp}_${crypto.randomBytes(3).toString('hex')}`;
}

export function saveSession(session, { project = false, cwd } = {}) {
  const dir = sessionsDir(cwd, project);
  const file = path.join(dir, `${session.id}.json`);
  writeJson(file, session);
  return file;
}

export function loadSession(id, { project = false, cwd } = {}) {
  for (const dir of [sessionsDir(cwd, true), sessionsDir(cwd, false)]) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'));
      if (s?.id) return s;
    } catch {
      /* next */
    }
  }
  return null;
}

export function listSessions({ project = false, cwd, limit = 30 } = {}) {
  const out = [];
  const dirs = [sessionsDir(cwd, true), sessionsDir(cwd, false)];
  const seen = new Set();
  for (const dir of dirs) {
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
      continue;
    }
    for (const f of files) {
      const id = f.replace(/\.json$/, '');
      if (seen.has(id)) continue;
      seen.add(id);
      try {
        const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        out.push({
          id: s.id,
          title: s.title || '(untitled)',
          messages: Array.isArray(s.messages) ? s.messages.length : 0,
          model: s.model || null,
          provider: s.provider || null,
          updatedAt: s.updatedAt || s.createdAt || null,
        });
      } catch {
        /* skip corrupt */
      }
    }
  }
  out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return out.slice(0, limit);
}

export function createSession({ provider, model, cwd, project = false } = {}) {
  return {
    id: newSessionId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    title: null,
    provider: provider || null,
    model: model || null,
    cwd: cwd || process.cwd(),
    messages: [],
  };
}

/** Keep message history trimmed for API limits: system + first N + last M. */
export function trimMessages(messages, { keepFirst = 4, keepLast = 20 } = {}) {
  if (messages.length <= keepFirst + keepLast) return messages;
  const head = messages.slice(0, keepFirst);
  const tail = messages.slice(-keepLast);
  const omitted = messages.length - head.length - tail.length;
  return [
    ...head,
    {
      role: 'system',
      content: `(${omitted} earlier messages omitted for context — ask the user if you need details from them.)`,
    },
    ...tail,
  ];
}
