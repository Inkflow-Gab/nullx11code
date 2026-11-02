// nullx11code web app — landing animation + chat (no frameworks, no deps).
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

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
    { t: 'wait', ms: 350 },
    { t: 'line', text: '→ detecting node … v22.22.3', cls: 'info' },
    { t: 'line', text: '→ fetching nullx11code v0.1.0 (zero dependencies)', cls: 'dim' },
    { t: 'progress', label: 'downloading', ms: 1600 },
    { t: 'line', text: '✓ installed → nullx11code, n11', cls: 'ok' },
    { t: 'line', text: '→ next: nullx11code            (interactive chat)', cls: 'dim' },
    { t: 'line', text: '→ next: nullx11code serve      (web ui)', cls: 'dim' },
    { t: 'wait', ms: 2600 },
  ],
  npm: [
    { t: 'type', text: INSTALL_CMDS.npm },
    { t: 'wait', ms: 350 },
    { t: 'line', text: 'added 1 package in 2s', cls: 'dim' },
    { t: 'line', text: '✓ nullx11code v0.1.0 linked to nullx11code, n11', cls: 'ok' },
    { t: 'wait', ms: 2600 },
  ],
  npx: [
    { t: 'type', text: INSTALL_CMDS.npx },
    { t: 'wait', ms: 500 },
    { t: 'line', text: '  ▗▄▖ ▐▌ ▐▌ nullx11code v0.1.0', cls: 'ok' },
    { t: 'line', text: '  free-first AI coding agent · terminal + web', cls: 'dim' },
    { t: 'line', text: '  no API keys yet — free: put NVIDIA_API_KEY=… in .env', cls: 'warn' },
    { t: 'wait', ms: 2600 },
  ],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let animRun = 0;
async function playInstallAnimation(kind) {
  const runId = ++animRun;
  const out = $('#term-out');
  const bar = $('#term-bar');
  if (!out) return;
  out.innerHTML = '';
  bar.style.width = '0%';

  const write = (html) => {
    out.innerHTML = html;
    out.scrollTop = out.scrollHeight;
  };
  let html = '';
  const script = TYPE_SCRIPTS[kind] || TYPE_SCRIPTS.curl;

  for (const step of script) {
    if (runId !== animRun) return;
    if (step.t === 'type') {
      html += '<span class="ps1">$</span> ';
      for (let i = 0; i < step.text.length; i++) {
        if (runId !== animRun) return;
        html += escapeHtml(step.text[i]);
        write(html + '<span class="cursor"></span>');
        await sleep(14 + Math.random() * 26);
      }
      html += '\n';
      write(html);
    } else if (step.t === 'line') {
      html += `<span class="${step.cls || ''}">${escapeHtml(step.text)}</span>\n`;
      write(html);
      await sleep(140);
    } else if (step.t === 'wait') {
      await sleep(step.ms);
    } else if (step.t === 'progress') {
      const steps = 26;
      for (let i = 1; i <= steps; i++) {
        if (runId !== animRun) return;
        bar.style.width = `${Math.round((i / steps) * 100)}%`;
        const filled = '█'.repeat(i) + '░'.repeat(steps - i);
        write(html + `<span class="dim">${step.label} ${filled} ${Math.round((i / steps) * 100)}%</span>\n<span class="cursor"></span>`);
        await sleep(step.ms / steps);
      }
      html += `<span class="dim">${step.label} 100%</span>\n`;
      write(html + '<span class="cursor"></span>');
    }
  }
  if (runId === animRun) write(html + '<span class="cursor"></span>');
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
      const avatar = m.role === 'user' ? '🙂' : `<img src="/assets/icons/app-icon.svg" width="17" height="17" alt="">`;
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
  const avatar = role === 'user' ? '🙂' : `<img src="/assets/icons/app-icon.svg" width="17" height="17" alt="">`;
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
  div.innerHTML = `<div class="avatar">⚙</div><div class="bubble"><div class="tool-event"><b>${escapeHtml(name)}</b> <span>${escapeHtml(argStr)}</span></div></div>`;
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
