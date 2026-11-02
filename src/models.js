// Model family detection + icon metadata.
// The UI uses this to "auto detect the model and show it with its icon".

export const FAMILIES = {
  llama:     { label: 'Llama',    letters: 'LL', color: '#0866FF' },
  qwen:      { label: 'Qwen',     letters: 'QW', color: '#6B4EFF' },
  deepseek:  { label: 'DeepSeek', letters: 'DS', color: '#4D6BFE' },
  nemotron:  { label: 'Nemotron', letters: 'NV', color: '#76B900' },
  mistral:   { label: 'Mistral',  letters: 'MS', color: '#FA5010' },
  gemma:     { label: 'Gemma',    letters: 'GM', color: '#3DDC84' },
  kimi:      { label: 'Kimi',     letters: 'KM', color: '#16A37E' },
  gpt:       { label: 'GPT',      letters: 'GP', color: '#10A37F' },
  claude:    { label: 'Claude',   letters: 'CL', color: '#D97757' },
  gemini:    { label: 'Gemini',   letters: 'GE', color: '#4E8CFF' },
  cohere:    { label: 'Command',  letters: 'CO', color: '#39594D' },
  phi:       { label: 'Phi',      letters: 'PH', color: '#0078D4' },
  glm:       { label: 'GLM',      letters: 'GL', color: '#2E6BFF' },
  yi:        { label: 'Yi',       letters: 'YI', color: '#00B8A9' },
  starcoder: { label: 'StarCoder',letters: 'SC', color: '#F05138' },
  granite:   { label: 'Granite',  letters: 'GR', color: '#5B8DEF' },
  generic:   { label: 'Model',    letters: 'AI', color: '#8B93A7' },
};

// Order matters: first match wins.
const RULES = [
  [/deepseek/i, 'deepseek'],
  [/nemotron/i, 'nemotron'],
  [/llama|meta[-_/]?llama|codellama/i, 'llama'],
  [/qwen|qwq/i, 'qwen'],
  [/mistral|mixtral|codestral|devstral|magistral/i, 'mistral'],
  [/gemma/i, 'gemma'],
  [/kimi|moonshot/i, 'kimi'],
  [/gpt|o[134](?:-\w+)?(?:\b|$)|chatgpt/i, 'gpt'],
  [/claude/i, 'claude'],
  [/gemini/i, 'gemini'],
  [/command[-_]?r|cohere/i, 'cohere'],
  [/\bphi[-_]?\d|phi-?mini|phi-?small/i, 'phi'],
  [/\bglm/i, 'glm'],
  [/\byi[-_]/i, 'yi'],
  [/starcoder|bigcode/i, 'starcoder'],
  [/granite/i, 'granite'],
];

/** Detect which model family an id belongs to. */
export function modelFamily(id = '') {
  for (const [re, fam] of RULES) if (re.test(id)) return fam;
  return 'generic';
}

/** Family metadata (label, terminal letters, brand color, icon file). */
export function familyMeta(id) {
  const key = modelFamily(id);
  return { key, ...FAMILIES[key] };
}

/** Icon path relative to /assets/icons/ (served by the web UI). */
export function familyIconPath(id) {
  return `assets/icons/models/${modelFamily(id)}.svg`;
}
