// Skills: folders of SKILL.md files, project-selectable, injected into the system prompt.
// Layout of a skill folder:
//   <skills-dir>/<skill-name>/SKILL.md
// SKILL.md starts with frontmatter:
//   ---
//   name: code-review
//   description: Reviews diffs for bugs and security issues
//   always: false
//   ---
import fs from 'node:fs';
import path from 'node:path';
import { skillDirs } from './config.js';

const MAX_SKILL_BYTES = 64 * 1024;

/** Tiny frontmatter parser: key: value lines between --- fences. */
export function parseFrontmatter(raw) {
  const text = String(raw);
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text.trim() };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v === 'true') v = true;
    else if (v === 'false') v = false;
    meta[kv[1]] = v;
  }
  return { meta, body: m[2].trim() };
}

function readSkillDir(dir) {
  const skills = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return skills;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const skillPath = path.join(dir, ent.name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    try {
      const stat = fs.statSync(skillPath);
      if (stat.size > MAX_SKILL_BYTES) continue;
      const { meta, body } = parseFrontmatter(fs.readFileSync(skillPath, 'utf8'));
      skills.push({
        name: String(meta.name || ent.name),
        description: String(meta.description || ''),
        always: meta.always === true || meta.always === 'true',
        path: skillPath,
        dir: path.dirname(skillPath),
        source: dir,
        body,
      });
    } catch {
      /* unreadable skill */
    }
  }
  return skills;
}

/** Discover all skills from configured dirs + project + global. Later sources override earlier same-name. */
export function discoverSkills(cfg, cwd = process.cwd()) {
  const dirs = skillDirs(cfg, cwd);
  const byName = new Map();
  for (const d of dirs) {
    for (const s of readSkillDir(d)) byName.set(s.name, s);
  }
  const enabled = new Set(cfg.skills?.enabled || []);
  return [...byName.values()].map((s) => ({
    ...s,
    // `always` skills are on by default; others must be enabled in config.
    enabled: s.always || enabled.has(s.name),
  }));
}

/** Toggle a skill on/off and persist to project config. */
export function setSkillEnabled(cfg, name, on, saveFn) {
  const set = new Set(cfg.skills?.enabled || []);
  const skill = discoverSkills(cfg).find((s) => s.name === name);
  if (skill?.always) return set; // always-on can't be disabled
  if (on) set.add(name);
  else set.delete(name);
  cfg.skills = { ...cfg.skills, enabled: [...set] };
  saveFn?.({ skills: cfg.skills });
  return set;
}

/** Build the "## Active skills" system-prompt block. */
export function skillsPrompt(skills) {
  const active = skills.filter((s) => s.enabled);
  if (!active.length) return '';
  const parts = [
    '## Active skills',
    'Follow the instructions of any skill below when its topic applies to the user request.',
  ];
  for (const s of active) {
    parts.push(`\n### Skill: ${s.name}\n${s.description ? `_${s.description}_\n` : ''}${s.body}`);
  }
  return parts.join('\n');
}

/** Cheap keyword suggester: which skill might apply to this message? */
export function suggestSkills(skills, message) {
  const text = String(message).toLowerCase();
  const words = new Set(text.split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  const out = [];
  for (const s of skills) {
    if (s.enabled) continue;
    const hay = `${s.name} ${s.description}`.toLowerCase();
    let score = 0;
    for (const w of words) if (hay.includes(w)) score++;
    if (score >= 1) out.push({ skill: s, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 2).map((x) => x.skill);
}

/** Create a scaffold skill folder. */
export function createSkill(dir, name, { description = '' } = {}) {
  const target = path.join(dir, name);
  fs.mkdirSync(target, { recursive: true });
  const file = path.join(target, 'SKILL.md');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      `---\nname: ${name}\ndescription: ${description}\nalways: false\n---\n\n# ${name}\n\nDescribe what the model should do when this skill is active.\n`
    );
  }
  return file;
}
