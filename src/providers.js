// Provider registry: free-first, NVIDIA NIM as the flagship.
// Every provider is OpenAI-compatible (`/chat/completions`, `/models`).
import { getApiKey } from './config.js';

export const PROVIDERS = [
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    color: '#76B900',
    free: true,
    env: ['NVIDIA_API_KEY', 'NVAPI_KEY'],
    base: 'https://integrate.api.nvidia.com/v1',
    docs: 'https://build.nvidia.com/',
    keyUrl: 'https://build.nvidia.com/explore/discover',
    notes: 'Free credits on signup — no card required to start.',
    preferred: [/deepseek-r1/i, /llama-3\.3-70b/i, /qwen.*coder/i, /nemotron.*70b/i],
    fallback: [
      'deepseek-ai/deepseek-r1',
      'meta/llama-3.3-70b-instruct',
      'meta/llama-3.1-8b-instruct',
      'nvidia/llama-3.1-nemotron-70b-instruct',
      'qwen/qwen2.5-coder-32b-instruct',
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    color: '#F55036',
    free: true,
    env: ['GROQ_API_KEY'],
    base: 'https://api.groq.com/openai/v1',
    docs: 'https://console.groq.com/keys',
    keyUrl: 'https://console.groq.com/keys',
    notes: 'Free tier with extremely fast inference.',
    preferred: [/llama-3\.3-70b/i, /deepseek-r1-distill/i, /llama-3\.1-8b/i],
    fallback: [
      'llama-3.3-70b-versatile',
      'deepseek-r1-distill-llama-70b',
      'llama-3.1-8b-instant',
      'gemma2-9b-it',
    ],
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    color: '#7C3AED',
    free: true,
    env: ['CEREBRAS_API_KEY'],
    base: 'https://api.cerebras.ai/v1',
    docs: 'https://cloud.cerebras.ai/',
    keyUrl: 'https://cloud.cerebras.ai/',
    notes: 'Free developer tier, wafer-scale speed.',
    preferred: [/llama-3\.3-70b/i, /qwen.*32b/i, /llama3\.1-8b/i],
    fallback: ['llama3.3-70b', 'llama3.1-8b', 'qwen-3-32b'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    color: '#6C72E5',
    free: true,
    env: ['OPENROUTER_API_KEY'],
    base: 'https://openrouter.ai/api/v1',
    docs: 'https://openrouter.ai/docs',
    keyUrl: 'https://openrouter.ai/settings/keys',
    notes: 'Hundreds of models; look for `:free` ids.',
    preferred: [/:free$/i, /deepseek.*free/i],
    fallback: [
      'deepseek/deepseek-chat-v3-0324:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'qwen/qwen3-235b-a22b:free',
      'google/gemini-2.0-flash-exp:free',
    ],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    color: '#4E8CFF',
    free: true,
    env: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    base: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    docs: 'https://aistudio.google.com/apikey',
    keyUrl: 'https://aistudio.google.com/apikey',
    notes: 'Free tier on Gemini Flash models.',
    preferred: [/gemini-2\.5-flash/i, /gemini-2\.0-flash/i, /gemini-2\.5-pro/i],
    fallback: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro'],
  },
  {
    id: 'mistral',
    name: 'Mistral',
    color: '#FA5010',
    free: true,
    env: ['MISTRAL_API_KEY'],
    base: 'https://api.mistral.ai/v1',
    docs: 'https://console.mistral.ai/api-keys',
    keyUrl: 'https://console.mistral.ai/api-keys',
    notes: 'Free tier credits for new accounts.',
    preferred: [/codestral/i, /mistral-small/i, /nemo/i],
    fallback: ['mistral-small-latest', 'codestral-latest', 'open-mistral-nemo', 'mistral-large-latest'],
  },
  {
    id: 'github',
    name: 'GitHub Models',
    color: '#EDEDED',
    free: true,
    env: ['GITHUB_TOKEN', 'GH_TOKEN'],
    base: 'https://models.inference.ai.azure.com',
    docs: 'https://github.com/marketplace/models',
    keyUrl: 'https://github.com/settings/tokens',
    notes: 'Free with your GitHub token.',
    preferred: [/gpt-4o-mini/i, /gpt-4o/i, /deepseek/i],
    fallback: ['gpt-4o-mini', 'gpt-4o', 'DeepSeek-R1', 'Meta-Llama-3.1-8B-Instruct'],
  },
  {
    id: 'together',
    name: 'Together AI',
    color: '#0B5FFF',
    free: false,
    env: ['TOGETHER_API_KEY'],
    base: 'https://api.together.xyz/v1',
    docs: 'https://api.together.ai/',
    keyUrl: 'https://api.together.ai/settings/api-keys',
    notes: 'Sign-up credit sometimes available.',
    preferred: [/deepseek-v3/i, /llama-3\.3-70b/i],
    fallback: ['deepseek-ai/DeepSeek-V3', 'meta-llama/Llama-3.3-70B-Instruct-Turbo'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    color: '#10A37F',
    free: false,
    env: ['OPENAI_API_KEY'],
    base: 'https://api.openai.com/v1',
    docs: 'https://platform.openai.com/api-keys',
    keyUrl: 'https://platform.openai.com/api-keys',
    notes: 'Paid — listed for completeness.',
    preferred: [/gpt-4o-mini/i, /gpt-4\.1-mini/i, /gpt-4o/i],
    fallback: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'],
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    color: '#B8BCC8',
    free: true,
    local: true,
    env: [],
    base: 'http://127.0.0.1:11434/v1',
    docs: 'https://ollama.com/',
    keyUrl: null,
    notes: 'Runs entirely on your machine — fully offline.',
    preferred: [/llama3\.3/i, /qwen2\.5-coder/i, /deepseek/i],
    fallback: [],
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (local)',
    color: '#4C8BF5',
    free: true,
    local: true,
    env: [],
    base: 'http://127.0.0.1:1234/v1',
    docs: 'https://lmstudio.ai/',
    keyUrl: null,
    notes: 'Local models via LM Studio server.',
    preferred: [/qwen/i, /llama/i],
    fallback: [],
  },
];

/** Custom OpenAI-compatible endpoints from config (`providers.custom`). */
function customProviders(cfg) {
  const out = [];
  for (const [id, c] of Object.entries(cfg?.providers || {})) {
    if (!c?.baseUrl || id === 'custom') continue;
    if (PROVIDERS.some((p) => p.id === id)) continue;
    out.push({
      id,
      name: c.name || id,
      color: c.color || '#8B93A7',
      free: !!c.free,
      env: [],
      base: String(c.baseUrl).replace(/\/+$/, ''),
      docs: null,
      keyUrl: null,
      notes: 'Custom endpoint from config.',
      preferred: [],
      fallback: c.models || [],
      custom: true,
      apiKey: c.apiKey || null,
    });
  }
  // Single generic "custom" slot if configured.
  const c = cfg?.providers?.custom;
  if (c?.baseUrl) {
    out.push({
      id: 'custom',
      name: c.name || 'Custom',
      color: '#8B93A7',
      free: !!c.free,
      env: [],
      base: String(c.baseUrl).replace(/\/+$/, ''),
      docs: null,
      keyUrl: null,
      notes: 'Custom OpenAI-compatible endpoint.',
      preferred: [],
      fallback: c.models || [],
      custom: true,
      apiKey: c.apiKey || null,
    });
  }
  return out;
}

/** All known providers (registry + custom from config), each annotated with key status. */
export function allProviders(cfg, env = process.env) {
  return [...PROVIDERS, ...customProviders(cfg)].map((p) => {
    const apiKey = p.custom ? p.apiKey || getApiKey(p, cfg, env) : getApiKey(p, cfg, env);
    const detected = !!apiKey || !!p.local;
    return { ...p, apiKey, detected };
  });
}

/** Pick the provider to use: explicit cfg > first detected free > first detected. */
export function resolveProvider(cfg, explicitId = null) {
  const list = allProviders(cfg);
  const id = explicitId || cfg.provider;
  if (id) {
    const hit = list.find((p) => p.id === id);
    if (hit) return hit;
  }
  const detected = list.filter((p) => p.detected);
  const free = detected.filter((p) => p.free);
  return free[0] || detected[0] || list[0];
}

const cache = new Map(); // providerId -> { at, models }

/** Fetch /models with graceful fallback to the static catalog. */
export async function listModels(prov, cfg, { refresh = false } = {}) {
  const key = prov.id;
  const hit = cache.get(key);
  if (!refresh && hit && Date.now() - hit.at < 24 * 3600 * 1000) return hit.models;

  const models = [];
  try {
    const headers = { accept: 'application/json' };
    if (prov.apiKey) headers.authorization = `Bearer ${prov.apiKey}`;
    const url = prov.base.replace(/\/+$/, '') + '/models';
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = await res.json();
      for (const m of data?.data || []) {
        if (!m?.id) continue;
        models.push({
          id: m.id,
          context: m.context_length || m.contextWindow || null,
          ownedBy: m.owned_by || m.author || null,
        });
      }
    }
  } catch {
    /* offline / no key / endpoint without /models */
  }

  if (!models.length && prov.fallback?.length) {
    for (const id of prov.fallback) models.push({ id, context: null, ownedBy: null });
  }
  cache.set(key, { at: Date.now(), models });
  return models;
}

/** Choose the best model for a provider ("auto" mode). */
export function guessModel(prov, models) {
  if (!models?.length) return prov.fallback?.[0] || 'default';
  for (const re of prov.preferred || []) {
    const hit = models.find((m) => re.test(m.id));
    if (hit) return hit.id;
  }
  return models[0].id;
}
