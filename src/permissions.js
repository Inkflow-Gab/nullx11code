// opencode-style permission rules: allow / deny / ask, evaluated before prompting.
//
// config shape (project or global config.json):
//   "permissions": {
//     "default": "ask",                       // ask | allow | deny
//     "rules": [
//       { "action": "edit",  "resource": "*",        "effect": "allow" },
//       { "action": "shell", "resource": "git *",    "effect": "allow" },
//       { "action": "shell", "resource": "rm -rf *", "effect": "deny"  }
//     ]
//   }
//
// action: 'edit' (write_file + edit), 'shell', 'question', or '*'
// resource: glob-ish pattern — file path for edit, command string for shell, '*' for anything.
// Evaluation: deny rules win first, then allow rules, then the default.

/** Glob-ish matcher: * matches any run (incl. spaces), ? matches one char, rest literal. */
export function matchPattern(pattern, value) {
  const p = String(pattern ?? '*');
  const v = String(value ?? '');
  if (p === '*') return true;
  const esc = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  try {
    return new RegExp(`^${esc}$`, 'i').test(v);
  } catch {
    return p.toLowerCase() === v.toLowerCase();
  }
}

/** Map internal tool kinds to permission actions. */
export function actionForKind(kind) {
  if (kind === 'shell') return 'shell';
  if (kind === 'write' || kind === 'edit') return 'edit';
  if (kind === 'question') return 'question';
  return kind || '*';
}

/**
 * Evaluate rules for an action/resource.
 * @returns {'allow'|'deny'|'ask'}
 */
export function evaluate(action, resource, perms) {
  const rules = Array.isArray(perms?.rules) ? perms.rules : [];
  const res = resource == null ? '*' : String(resource);
  // denies first (opencode: configured denies win)
  for (const r of rules) {
    if (r?.effect !== 'deny') continue;
    if (matchAction(r, action) && matchPattern(r.resource ?? '*', res)) return 'deny';
  }
  for (const r of rules) {
    if (r?.effect !== 'allow') continue;
    if (matchAction(r, action) && matchPattern(r.resource ?? '*', res)) return 'allow';
  }
  const d = perms?.default;
  return d === 'allow' || d === 'deny' ? d : 'ask';
}

function matchRuleKind(rule, action) {
  const a = rule?.action ?? '*';
  return a === '*' || a === action;
}
const matchAction = matchRuleKind;

/** Human-readable rule listing for /permissions. */
export function describeRules(perms) {
  const rules = Array.isArray(perms?.rules) ? perms.rules : [];
  return {
    default: perms?.default || 'ask',
    rules: rules.map((r) => ({
      action: r.action ?? '*',
      resource: r.resource ?? '*',
      effect: r.effect ?? 'ask',
    })),
  };
}
