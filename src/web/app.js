// nullx11code web app — landing animation + chat (no frameworks, no deps).
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

/* own vector avatars — no emoji */
const USER_SVG = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8.5" r="3.75"/><path d="M4.5 20.5c1.2-3.4 4-5.5 7.5-5.5s6.3 2.1 7.5 5.5"/></svg>`;
const TOOL_SVG = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/></svg>`;

const state = {
  version: '0.1.0',
  providers: [],
  provider: null,
  models: [],
  model: null,
  modelMeta: new Map(),
  skills: [],
  sessions: [],
  messages: [],
  busy: false,
  sessionId: null,
};

/* ═══════════ helpers ═══════════ */

function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), ms);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/* tiny markdown → html (code fences extracted first with a safe sentinel) */
function renderMarkdown(src) {
  const codeBlocks = [];
  let text = String(src).replace(/```(\w*)\n?([\s\S]*?)(?:```|$)/g, (_, lang, code) => {
    codeBlocks.push(code.replace(/\n$/, ''));
    return `\n%%CODE${codeBlocks.length - 1}%%\n`;
  });
  text = escapeHtml(text);
  text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  text = text.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  const lines = text.split('\n');
  const out = [];
  let inList = false;
  let para = [];
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.join('<br>')}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  for (const line of lines) {
    const codeMatch = line.match(/^%%CODE(\d+)%%$/);
    if (codeMatch) {
      flushPara();
      closeList();
      out.push(`<pre><code>${codeBlocks[+codeMatch[1]]}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara();
      closeList();
      const lv = h[1].length;
      out.push(`<h${lv}>${h[2]}</h${lv}>`);
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      flushPara();
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${li[1]}</li>`);
      continue;
    }
    const q = line.match(/^&gt;\s?(.*)$/);
    if (q) {
      flushPara();
      closeList();
      out.push(`<blockquote>${q[1]}</blockquote>`);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }
    closeList();
    para.push(line);
  }
  flushPara();
  closeList();
  return out.join('');
}

const FAMILY = {
  llama: ['LL', '#0866FF', 'Llama'], qwen: ['QW', '#6B4EFF', 'Qwen'], deepseek: ['DS', '#4D6BFE', 'DeepSeek'],
  nemotron: ['NV', '#76B900', 'Nemotron'], mistral: ['MS', '#FA5010', 'Mistral'], gemma: ['GM', '#3DDC84', 'Gemma'],
  kimi: ['KM', '#16A37E', 'Kimi'], gpt: ['GP', '#10A37F', 'GPT'], claude: ['CL', '#D97757', 'Claude'],
  gemini: ['GE', '#4E8CFF', 'Gemini'], cohere: ['CO', '#39594D', 'Command'], phi: ['PH', '#0078D4', 'Phi'],
  glm: ['GL', '#2E6BFF', 'GLM'], yi: ['YI', '#00B8A9', 'Yi'], starcoder: ['SC', '#F05138', 'StarCoder'],
  granite: ['GR', '#5B8DEF', 'Granite'], generic: ['AI', '#8B93A7', 'Model'],
};

function modelFamily(id = '') {
  const rules = [
    [/deepseek/i, 'deepseek'], [/nemotron/i, 'nemotron'], [/llama|meta[-_/]?llama/i, 'llama'],
    [/qwen|qwq/i, 'qwen'], [/mistral|mixtral|codestral|devstral/i, 'mistral'], [/gemma/i, 'gemma'],
    [/kimi|moonshot/i, 'kimi'], [/gpt|chatgpt/i, 'gpt'], [/\bo[134]-/, 'gpt'],
    [/claude/i, 'claude'], [/gemini/i, 'gemini'], [/command[-_]?r|cohere/i, 'cohere'],
    [/\bphi[-_]?\d/i, 'phi'], [/\bglm/i, 'glm'], [/\byi[-_]/i, 'yi'],
    [/starcoder/i, 'starcoder'], [/granite/i, 'granite'],
  ];
  for (const [re, fam] of rules) if (re.test(id)) return fam;
  return 'generic';
}

function modelIconHtml(id, size = 15) {
  const fam = modelFamily(id);
  const letters = FAMILY[fam][0];
  return `<span class="model-icon"><img src="/assets/icons/models/${fam}.svg" alt="${FAMILY[fam][2]}" width="${size}" height="${size}" onerror="this.parentElement.textContent='${letters}'"/></span>`;
}

/* ═══════════ landing: install animation ═══════════ */

const INSTALL_CMDS = {
  curl: 'curl -fsSL https://raw.githubusercontent.com/Inkflow-Gab/nullx11code/main/install.sh | sh',
  npm: 'npm i -g https://codeload.github.com/Inkflow-Gab/nullx11code/tar.gz/refs/heads/main',
  npx: 'npx nullx11code "hello from my phone"',
};

const TYPE_SCRIPTS = {
  curl: [
    { t: 'type', text: INSTALL_CMDS.curl },
    { t: 'wait', ms: 250 },
    { t: 'hudInit' },
    { t: 'status', state: 'boot', text: '01/07 ENV' },
    { t: 'env', k: 'runtime', v: 'node v22.22.3', ok: true },
    { t: 'env', k: 'package', v: 'npm 10.9.8', ok: true },
    { t: 'env', k: 'platform', v: 'linux-x64 · zero npm dependencies', ok: true },
    { t: 'status', state: 'resolve', text: '02/07 RESOLVE' },
    { t: 'log', msg: 'release pinned — nullx11code v0.1.0', cls: 'info' },
    { t: 'log', msg: 'manifest ok · 71 files · 1.40 MB', cls: 'dim' },
    { t: 'status', state: 'download', text: '03/07 TRANSFER' },
    { t: 'download', name: 'nullx11code-0.1.0.tar.gz', total: 1.4, ms: 2200 },
    { t: 'status', state: 'verify', text: '04/07 VERIFY' },
    { t: 'log', msg: 'sha256 9f3c1e…a7b2 matches manifest ✓', cls: 'ok' },
    { t: 'status', state: 'extract', text: '05/07 EXTRACT' },
    { t: 'log', msg: 'unpacked src/ bin/ assets/icons/ (71 files)', cls: 'dim' },
    { t: 'status', state: 'link', text: '06/07 LINK' },
    { t: 'log', msg: 'binaries → nullx11code, n11', cls: '' },
    { t: 'log', msg: 'scaffolded .nullx11/ {skills, commands}', cls: '' },
    { t: 'status', state: 'complete', text: '07/07 READY' },
    { t: 'log', msg: '0 dependencies — nothing else to install', cls: 'ok' },
    { t: 'done', time: '2.8s' },
    { t: 'wait', ms: 4200 },
  ],
  npm: [
    { t: 'type', text: INSTALL_CMDS.npm },
    { t: 'wait', ms: 250 },
    { t: 'hudInit' },
    { t: 'status', state: 'boot', text: '01/06 ENV' },
    { t: 'env', k: 'runtime', v: 'node v22.22.3', ok: true },
    { t: 'env', k: 'package', v: 'npm 10.9.8', ok: true },
    { t: 'status', state: 'resolve', text: '02/06 RESOLVE' },
    { t: 'log', msg: 'resolving tarball refs/heads/main', cls: 'info' },
    { t: 'status', state: 'download', text: '03/06 TRANSFER' },
    { t: 'download', name: 'nullx11code-0.1.0.tgz', total: 1.4, ms: 1700 },
    { t: 'status', state: 'verify', text: '04/06 VERIFY' },
    { t: 'log', msg: 'sha256 ok · no transitive deps', cls: 'ok' },
    { t: 'status', state: 'link', text: '05/06 LINK' },
    { t: 'log', msg: 'linked nullx11code, n11 → global bin', cls: '' },
    { t: 'status', state: 'complete', text: '06/06 READY' },
    { t: 'log', msg: 'next: nullx11code doctor (check free keys)', cls: 'info' },
    { t: 'done', time: '1.9s' },
    { t: 'wait', ms: 4200 },
  ],
  npx: [
    { t: 'type', text: INSTALL_CMDS.npx },
    { t: 'wait', ms: 300 },
    { t: 'hudInit' },
    { t: 'status', state: 'boot', text: '01/05 ENV' },
    { t: 'env', k: 'mode', v: 'ephemeral · cached after 1st run', ok: true },
    { t: 'status', state: 'download', text: '02/05 TRANSFER' },
    { t: 'download', name: 'nullx11code (streamed)', total: 0.4, ms: 1000 },
    { t: 'status', state: 'verify', text: '03/05 VERIFY' },
    { t: 'log', msg: 'package cache hit · checksum ok', cls: 'ok' },
    { t: 'status', state: 'complete', text: '04/05 READY' },
    { t: 'log', msg: 'no API keys yet — NVIDIA_API_KEY=… in .env', cls: 'warn' },
    { t: 'done', time: '1.2s' },
    { t: 'wait', ms: 4200 },
  ],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let animRun = 0;
async function playInstallAnimation(kind) {
  const runId = ++animRun;
  const out = $('#term-out');
  const bar = $('#term-bar');
  const hud = $('#hud');
  if (!out || !hud) return;

  // ── reset ──
  out.innerHTML = '';
  bar.style.width = '0%';
  hud.classList.add('hidden');
  $('#hud-grid').innerHTML = '';
  $('#hud-log').innerHTML = '';
  $('#segbar').innerHTML = '';
  $('#hud-dl').classList.add('hidden');
  $('#hud-done').classList.add('hidden');
  $('#hud-hash').textContent = 'sha256 —';
  $('#hud-hash').classList.remove('locked');
  const st = $('#hud-status');
  st.dataset.state = 'boot';
  $('#hud-status-text').textContent = '00/00 BOOT';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const script = TYPE_SCRIPTS[kind] || TYPE_SCRIPTS.curl;

  const stamp = () => {
    const d = new Date();
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  };

  const addLog = (msg, cls = '') => {
    const line = document.createElement('div');
    line.className = `hud-log-line ${cls}`;
    line.innerHTML = `<time>${stamp()}</time><span></span>`;
    line.querySelector('span').textContent = msg;
    $('#hud-log').appendChild(line);
    return line;
  };

  let overall = 0;
  const setOverall = (pct) => {
    overall = Math.max(overall, Math.min(100, pct));
    bar.style.width = `${overall}%`;
  };

  const steps = {
    async type(text) {
      const prefix = '<span class="ps1">$</span> ';
      if (reduced) {
        out.innerHTML = prefix + escapeHtml(text);
        return;
      }
      let acc = prefix;
      out.innerHTML = acc + '<span class="cursor"></span>';
      for (const ch of text) {
        if (runId !== animRun) return;
        acc += escapeHtml(ch);
        out.innerHTML = acc + '<span class="cursor"></span>';
        await sleep(12 + Math.random() * 24);
      }
      out.innerHTML = acc + '<span class="cursor"></span>';
    },
    async wait(ms) {
      await sleep(reduced ? 0 : ms);
    },
    hudInit() {
      hud.classList.remove('hidden');
      // force reflow so the entrance animation replays on tab switch
      void hud.offsetWidth;
      setOverall(6);
    },
    async status(s) {
      st.dataset.state = s.state;
      $('#hud-status-text').textContent = s.text;
      await sleep(reduced ? 0 : 130);
    },
    async env(row) {
      // three direct grid children per row → columns always align
      const k = document.createElement('span');
      k.className = 'hud-k';
      k.textContent = row.k;
      const v = document.createElement('span');
      v.className = 'hud-v';
      v.textContent = row.v;
      const ok = document.createElement('span');
      ok.className = 'hud-check';
      ok.textContent = '✓';
      $('#hud-grid').append(k, v, ok);
      await sleep(reduced ? 0 : 160);
    },
    async log(line) {
      addLog(line.msg, line.cls);
      await sleep(reduced ? 0 : 170);
    },
    async download(d) {
      const dl = $('#hud-dl');
      dl.classList.remove('hidden');
      $('#hud-dl-name').textContent = `↓ ${d.name}`;
      const SEG = 36;
      const segbar = $('#segbar');
      segbar.innerHTML = '';
      const segs = [];
      for (let i = 0; i < SEG; i++) {
        const s = document.createElement('i');
        segbar.appendChild(s);
        segs.push(s);
      }
      const t0 = performance.now();
      const frames = reduced ? 1 : 44;
      const from = overall; // glide from wherever the phase creep left the bar
      const to = Math.min(95, from + 30);
      for (let i = 1; i <= frames; i++) {
        if (runId !== animRun) return;
        const pct = i / frames;
        const lit = Math.round(pct * SEG);
        for (let s = 0; s < SEG; s++) segs[s].classList.toggle('on', s < lit);
        const elapsed = (performance.now() - t0) / 1000 || 0.001;
        const got = d.total * pct;
        const speed = got / elapsed;
        const eta = speed > 0 ? (d.total - got) / speed : 0;
        $('#hud-pct').textContent = `${Math.round(pct * 100)}%`;
        $('#hud-bytes').textContent = `${got.toFixed(2)} / ${d.total.toFixed(2)} MB`;
        $('#hud-speed').textContent = `${speed.toFixed(2)} MB/s`;
        $('#hud-eta').textContent = pct >= 1 ? 'ETA 0s' : `ETA ${eta.toFixed(1)}s`;
        $('#hud-hash').textContent = `sha256 ${Math.random().toString(16).slice(2, 10)}…${Math.random().toString(16).slice(2, 6)}`;
        setOverall(from + (to - from) * pct);
        await sleep(reduced ? 0 : d.ms / frames);
      }
      // lock the real hash
      $('#hud-hash').textContent = 'sha256 9f3c1e…a7b2';
      $('#hud-hash').classList.add('locked');
      $('#hud-pct').textContent = '100%';
      $('#hud-bytes').textContent = `${d.total.toFixed(2)} / ${d.total.toFixed(2)} MB`;
      $('#hud-eta').textContent = 'ETA 0s';
      await sleep(reduced ? 0 : 160);
    },
    async done(res) {
      $('#hud-time').textContent = res.time;
      $('#hud-done').classList.remove('hidden');
      setOverall(100);
      await sleep(reduced ? 0 : 200);
    },
  };

  let phase = 0;
  for (const step of script) {
    if (runId !== animRun) return;
    phase++;
    // overall progress creep: map step index onto 0–95 (done sets 100)
    if (step.t !== 'done' && step.t !== 'download') setOverall(8 + (phase / script.length) * 85);
    const fn = steps[step.t];
    if (fn) await fn(step);
  }
  if (runId === animRun) setOverall(100);
}

/* ═══════════ landing: flowing binary rain (canvas) ═══════════ */

function startBinaryRain() {
  const canvas = document.getElementById('binary-rain');
  if (!canvas) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  let cols = [];
  let raf = 0;
  let running = true;
  const GLYPHS = '01';

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colW = 22;
    const n = Math.ceil(rect.width / colW);
    cols = Array.from({ length: n }, (_, i) => ({
      x: i * colW + 4,
      y: Math.random() * rect.height,
      speed: 0.35 + Math.random() * 0.85,
      len: 6 + Math.floor(Math.random() * 14),
      green: Math.random() < 0.4,
      trail: [],
    }));
  }

  function frame() {
    if (!running) return;
    const w = canvas.width / (Math.min(window.devicePixelRatio || 1, 2));
    const h = canvas.height / (Math.min(window.devicePixelRatio || 1, 2));
    ctx.clearRect(0, 0, w, h);
    ctx.font = '600 13px ui-monospace, Menlo, monospace';
    for (const col of cols) {
      col.y += col.speed;
      if (col.y - col.len * 16 > h) {
        col.y = -Math.random() * 120;
        col.speed = 0.35 + Math.random() * 0.85;
        col.len = 6 + Math.floor(Math.random() * 14);
        col.green = Math.random() < 0.4;
      }
      for (let i = 0; i < col.len; i++) {
        const gy = col.y - i * 16;
        if (gy < -16 || gy > h + 16) continue;
        const head = i === 0;
        const alpha = head ? 0.95 : Math.max(0.04, 0.55 - i * 0.05);
        ctx.fillStyle = col.green
          ? `rgba(118, 185, 0, ${head ? 1 : alpha})`
          : `rgba(232, 238, 247, ${head ? 0.9 : alpha * 0.7})`;
        const g = GLYPHS[(Math.floor(col.y / 16) + i * 7 + col.x) % 2];
        ctx.fillText(g, col.x, gy);
      }
    }
    raf = requestAnimationFrame(frame);
  }

  resize();
  frame();
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(raf);
    } else if (!running) {
      running = true;
      frame();
    }
  });
}

/* ═══════════ landing: provider strip ═══════════ */

function renderProvStrip() {
  const strip = $('#prov-strip');
  if (!strip) return;
  strip.innerHTML = state.providers
    .map(
      (p) => `
    <span class="prov-pill" title="${escapeHtml(p.notes || '')}">
      <img src="/assets/icons/providers/${p.id}.svg" alt="" width="18" height="18"
           onerror="this.style.display='none'"/>
      ${escapeHtml(p.name)}
      <span class="${p.free ? 'free' : 'paid'}">${p.free ? 'free' : 'paid'}</span>
    </span>`
    )
    .join('');
}

/* ═══════════ app: chrome ═══════════ */

function renderProviders() {
  const sel = $('#provider-select');
  sel.innerHTML = state.providers
    .map((p) => `<option value="${p.id}" ${p.id === state.provider ? 'selected' : ''}>${escapeHtml(p.name)}${p.free ? ' · free' : ''}${p.detected ? '' : ' · no key'}</option>`)
    .join('');
  renderKeySetup();
}

/* show the easy key panel only while at least one remote provider lacks a key */
function renderKeySetup() {
  const panel = $('#key-setup');
  if (!panel) return;
  const needy = state.providers.filter((p) => !p.detected && !p.local && p.hasEnv);
  if (!needy.length) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  const sel = $('#key-provider');
  const cur = sel.value;
  sel.innerHTML = needy
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}${p.free ? ' · free' : ''}</option>`)
    .join('');
  if (cur && needy.some((p) => p.id === cur)) sel.value = cur;
  updateKeyLink();
}

function updateKeyLink() {
  const p = state.providers.find((x) => x.id === $('#key-provider')?.value);
  const link = $('#key-link');
  if (!link) return;
  if (p?.keyUrl) {
    link.href = p.keyUrl;
    link.textContent = `get a ${p.free ? 'free ' : ''}key at ${p.keyUrl.replace(/^https?:\/\//, '')} →`;
    link.classList.remove('hidden');
  } else {
    link.classList.add('hidden');
  }
}

async function saveKey() {
  const provider = $('#key-provider').value;
  const key = $('#key-input').value.trim();
  if (!key) return toast('paste a key first');
  try {
    const res = await api('/api/keys', { method: 'POST', body: { provider, key } });
    if (res.error) return toast(res.error);
    $('#key-input').value = '';
    toast(`key saved to .env (${res.envVar})`);
    const data = await api('/api/state');
    state.providers = data.providers;
    renderProviders();
    state.provider = provider;
    $('#provider-select').value = provider;
    await loadModels(true);
  } catch (e) {
    toast('save failed: ' + e.message);
  }
}

async function loadModels(refresh = false) {
  const data = await api(`/api/models?provider=${encodeURIComponent(state.provider || '')}${refresh ? '&refresh=1' : ''}`);
  state.models = data.models || [];
  state.modelMeta = new Map(state.models.map((m) => [m.id, m]));
  if (!state.model || !state.models.some((m) => m.id === state.model)) {
    state.model = data.suggested;
  }
  const sel = $('#model-select');
  sel.innerHTML = state.models
    .map((m) => `<option value="${escapeHtml(m.id)}" ${m.id === state.model ? 'selected' : ''}>${escapeHtml(m.id)}</option>`)
    .join('');
  updateModelChrome();
}

function updateModelChrome() {
  const fam = modelFamily(state.model || '');
  const letters = FAMILY[fam][0];
  const color = FAMILY[fam][1];
  const label = FAMILY[fam][2];
  const prov = state.providers.find((p) => p.id === state.provider);
  const iconHtml = `<img src="/assets/icons/models/${fam}.svg" alt="${label}" width="15" height="15" onerror="this.parentElement.textContent='${letters}'"/>`;
  $('#model-icon').innerHTML = iconHtml;
  $('#head-icon').innerHTML = iconHtml;
  $('#head-icon').style.color = color;
  $('#head-name').textContent = state.model || '…';
  const meta = state.modelMeta.get(state.model);
  $('#model-meta').textContent = `${label}${meta?.context ? ` · ctx ${Math.round(meta.context / 1024)}k` : ''} · ${prov?.name || ''}`;
  const chip = $('#free-chip');
  chip.textContent = prov && prov.free ? 'free tier' : 'paid';
}

function renderSkills() {
  const list = $('#skill-list');
  $('#skills-count').textContent = state.skills.length
    ? `${state.skills.filter((s) => s.enabled).length}/${state.skills.length}`
    : 'none';
  list.innerHTML =
    state.skills
      .map(
        (s) => `
    <li title="${escapeHtml(s.description || '')}">
      <button class="switch ${s.enabled ? 'on' : ''}" data-toggle="${escapeHtml(s.name)}"
        ${s.always ? 'disabled' : ''} aria-label="toggle ${escapeHtml(s.name)}"></button>
      <span class="s-name">${escapeHtml(s.name)}
        <span class="s-desc">${escapeHtml(s.description || '')}</span>
      </span>
    </li>`
      )
      .join('') || `<li style="color:var(--muted);cursor:default">No skills yet — add a folder above</li>`;

  list.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = btn.dataset.toggle;
      const on = !btn.classList.contains('on');
      btn.classList.toggle('on', on);
      try {
        const data = await api('/api/skills/toggle', { method: 'POST', body: { name, enabled: on } });
        state.skills = data.skills;
        renderSkills();
        toast(`skill ${name} ${on ? 'on' : 'off'}`);
      } catch (err) {
        toast(err.message);
      }
    });
  });
}

function renderSessions() {
  const list = $('#session-list');
  list.innerHTML =
    state.sessions
      .map(
        (s) => `
    <li data-session="${s.id}" class="${s.id === state.sessionId ? 'active' : ''}">
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(s.title || s.id)}</span>
      <span style="color:var(--muted);font-size:11px">${s.messages}</span>
    </li>`
      )
      .join('') || `<li style="color:var(--muted);cursor:default">No sessions yet</li>`;

  list.querySelectorAll('[data-session]').forEach((li) => {
    li.addEventListener('click', async () => {
      try {
        const s = await api(`/api/session/${li.dataset.session}`);
        state.sessionId = s.id;
        state.messages = (s.messages || []).filter((m) => m.role === 'user' || m.role === 'assistant');
        if (s.model) state.model = s.model;
        if (s.provider) {
          state.provider = s.provider;
          renderProviders();
          await loadModels();
        }
        renderMessages();
        renderSessions();
        closeSidebar();
      } catch (err) {
        toast(err.message);
      }
    });
  });
}

/* ═══════════ chat ═══════════ */

function scrollBottom() {
  const el = $('#messages');
  el.scrollTop = el.scrollHeight;
}

function addMessage(role, content) {
  state.messages.push({ role, content });
}

function renderMessages() {
  const box = $('#messages');
  if (!state.messages.length) {
    box.innerHTML = '';
    box.appendChild(emptyStateClone());
    return;
  }
  box.innerHTML = state.messages
    .map((m) => {
      const avatar = m.role === 'user' ? USER_SVG : `<img src="/assets/icons/app-icon.svg" width="17" height="17" alt="">`;
      const body = m.role === 'user' ? escapeHtml(m.content) : renderMarkdown(m.content || '');
      return `<div class="msg ${m.role}"><div class="avatar">${avatar}</div><div class="bubble">${body}</div></div>`;
    })
    .join('');
  scrollBottom();
}

function emptyStateClone() {
  const src = document.createElement('template');
  const orig = document.getElementById('empty-state');
  src.innerHTML = orig
    ? orig.innerHTML
    : `<img src="/assets/icons/app-icon.svg" alt="" width="72" height="72"/><h3>Start coding with <span class="grad">nullx11code</span></h3>`;
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = src.innerHTML;
  return div;
}

function appendLive(role) {
  const box = $('#messages');
  box.querySelector('.empty-state')?.remove();
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  const avatar = role === 'user' ? USER_SVG : `<img src="/assets/icons/app-icon.svg" width="17" height="17" alt="">`;
  div.innerHTML = `<div class="avatar">${avatar}</div><div class="bubble"></div>`;
  box.appendChild(div);
  scrollBottom();
  return div.querySelector('.bubble');
}

function appendToolEvent(name, args = {}) {
  const box = $('#messages');
  const div = document.createElement('div');
  div.className = 'msg';
  const argStr = Object.entries(args)
    .filter(([k]) => k !== 'content')
    .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`)
    .join(' ');
  div.innerHTML = `<div class="avatar">${TOOL_SVG}</div><div class="bubble"><div class="tool-event"><b>${escapeHtml(name)}</b> <span>${escapeHtml(argStr)}</span></div></div>`;
  box.appendChild(div);
  scrollBottom();
  return div.querySelector('.tool-event');
}

async function sendMessage(text) {
  if (state.busy || !text.trim()) return;
  state.busy = true;
  $('#send').disabled = true;
  $('#empty-state')?.remove();

  addMessage('user', text);
  const userBubble = appendLive('user');
  userBubble.textContent = text;

  const bubble = appendLive('assistant');
  bubble.innerHTML = `<span class="typing"><i></i><i></i><i></i></span>`;

  let acc = '';
  let err = null;
  const pendingEvents = [];

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'text/event-stream' },
      body: JSON.stringify({
        provider: state.provider,
        model: state.model,
        messages: state.messages.filter((m) => m.role === 'user' || m.role === 'assistant'),
        approveTools: true,
      }),
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (!chunk.startsWith('data:')) continue;
        let ev;
        try {
          ev = JSON.parse(chunk.slice(5));
        } catch {
          continue;
        }
        if (ev.type === 'delta') {
          acc += ev.text;
          bubble.innerHTML = renderMarkdown(acc) + '<span class="cursor" style="height:14px"></span>';
          scrollBottom();
        } else if (ev.type === 'tool_start') {
          bubble.innerHTML = renderMarkdown(acc);
          pendingEvents.push({ name: ev.name, el: appendToolEvent(ev.name, ev.args) });
        } else if (ev.type === 'tool_end') {
          const hit = [...pendingEvents].reverse().find((p) => p.name === ev.name && !p.done);
          if (hit) {
            hit.done = true;
            hit.el.innerHTML += ` <span class="arrow">→</span> <span>${escapeHtml(String(ev.result).split('\n')[0].slice(0, 160))}</span>`;
          }
        } else if (ev.type === 'approval') {
          const approved = await askApproval(ev.action);
          await fetch('/api/approve', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: ev.id, approved }),
          });
        } else if (ev.type === 'error') {
          err = ev.message;
        } else if (ev.type === 'done') {
          if (ev.model) state.model = ev.model;
        }
      }
    }
  } catch (e) {
    err = e.message;
  }

  bubble.innerHTML = acc ? renderMarkdown(acc) : err ? '' : '<em>(no response)</em>';
  if (err) {
    const note = document.createElement('div');
    note.className = 'error-note';
    note.textContent = `✗ ${err}`;
    bubble.appendChild(note);
  }

  if (acc) addMessage('assistant', acc);
  state.busy = false;
  $('#send').disabled = false;
  scrollBottom();
  refreshSessions();
}

function refreshSessions() {
  api('/api/sessions')
    .then((d) => {
      state.sessions = d.sessions;
      renderSessions();
    })
    .catch(() => {});
}

function askApproval(action) {
  return new Promise((resolve) => {
    const modal = $('#approve-modal');
    $('#ap-title').textContent = action.title || action.kind;
    $('#ap-detail').textContent = action.detail || (action.command ? `$ ${action.command}` : '');
    $('#ap-preview').textContent = action.preview || action.command || '';
    modal.classList.remove('hidden');
    const done = (ok) => {
      modal.classList.add('hidden');
      $('#ap-yes').onclick = null;
      $('#ap-no').onclick = null;
      resolve(ok);
    };
    $('#ap-yes').onclick = () => done(true);
    $('#ap-no').onclick = () => done(false);
  });
}

/* ═══════════ wiring ═══════════ */

function openApp() {
  $('#landing').classList.add('hidden');
  $('#app').classList.remove('hidden');
  location.hash = 'chat';
  setTimeout(() => $('#input')?.focus(), 60);
}

function openHome() {
  $('#app').classList.add('hidden');
  $('#landing').classList.remove('hidden');
  location.hash = '';
  playInstallAnimation(document.querySelector('.tab.active')?.dataset.cmd || 'curl');
}

function closeSidebar() {
  $('#sidebar').classList.remove('open');
}

function bindUI() {
  $('#open-app').onclick = openApp;
  $('#open-app-top').onclick = openApp;
  $('#back-home').onclick = openHome;
  $('#open-side').onclick = () => $('#sidebar').classList.add('open');
  $('#close-side').onclick = closeSidebar;

  $('#replay').onclick = () => {
    playInstallAnimation(document.querySelector('.tab.active')?.dataset.cmd || 'curl');
  };

  $('#copy-cmd').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('#dl-cmd').textContent);
      $('#copy-cmd').textContent = 'Copied ✓';
      setTimeout(() => ($('#copy-cmd').textContent = 'Copy'), 1500);
    } catch {
      toast('Copy manually: long-press the command');
    }
  };

  $$('.tab').forEach((tab) => {
    tab.onclick = () => {
      $$('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      $('#dl-cmd').textContent = INSTALL_CMDS[tab.dataset.cmd];
      playInstallAnimation(tab.dataset.cmd);
    };
  });

  $('#provider-select').onchange = async (e) => {
    state.provider = e.target.value;
    state.model = null;
    try {
      await api('/api/settings', { method: 'POST', body: { provider: state.provider } });
      await loadModels(true);
    } catch (err) {
      toast(err.message);
    }
  };
  $('#model-select').onchange = async (e) => {
    state.model = e.target.value;
    updateModelChrome();
    try {
      await api('/api/settings', { method: 'POST', body: { model: state.model } });
    } catch (err) {
      toast(err.message);
    }
  };

  $('#key-provider').onchange = updateKeyLink;
  $('#key-save').onclick = saveKey;
  $('#key-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveKey();
    }
  });

  $('#add-skills').onclick = async () => {
    const dir = $('#skill-dir').value.trim();
    if (!dir) return toast('Enter a folder path');
    try {
      const data = await api('/api/skills/add', { method: 'POST', body: { dir } });
      state.skills = data.skills;
      $('#skill-dir').value = '';
      renderSkills();
      toast(`added folder · ${data.skills.length} skills`);
    } catch (err) {
      toast(err.message);
    }
  };

  $('#new-chat').onclick = () => {
    state.messages = [];
    state.sessionId = null;
    renderMessages();
    refreshSessions();
    closeSidebar();
    $('#input').focus();
  };
  $('#clear-chat').onclick = () => $('#new-chat').onclick();

  $('#composer').onsubmit = (e) => {
    e.preventDefault();
    const input = $('#input');
    const text = input.value;
    input.value = '';
    input.style.height = 'auto';
    sendMessage(text);
  };

  const input = $('#input');
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 180) + 'px';
    $('#ctx-hint').textContent = `${state.messages.length} msgs · ~${Math.round(state.messages.reduce((n, m) => n + (m.content || '').length, 0) / 4)} tok`;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#composer').requestSubmit();
    }
  });

  document.addEventListener('click', (e) => {
    const s = e.target.closest('.suggestion');
    if (s) sendMessage(s.textContent);
  });
}

/* ═══════════ boot ═══════════ */

async function boot() {
  bindUI();
  playInstallAnimation('curl');
  startBinaryRain();

  try {
    const data = await api('/api/state');
    state.version = data.version;
    state.providers = data.providers;
    state.skills = data.skills;
    state.sessions = data.sessions;
    state.provider = data.settings.provider || (data.providers.find((p) => p.detected) || data.providers[0])?.id;
    state.model = data.settings.model && data.settings.model !== 'auto' ? data.settings.model : null;
    $('#ver').textContent = data.version;
    $('#app-ver').textContent = 'v' + data.version;
    $('#stat-providers').textContent = data.providers.length;
    renderProvStrip();
    renderProviders();
    renderSkills();
    renderSessions();
    if (state.provider) await loadModels();
  } catch (e) {
    console.error(e);
    toast('failed to load state: ' + e.message, 4000);
  }

  if (location.hash === '#chat') openApp();
}

boot();
