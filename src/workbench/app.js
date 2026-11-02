import { marked } from '/_nullx/marked.js';
import DOMPurify from '/_nullx/purify.js';

const $ = (id) => document.getElementById(id);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const clean = (text) => DOMPurify.sanitize(marked.parse(text || '', { breaks: false, gfm: true }), { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button', 'video', 'audio'], ALLOW_DATA_ATTR: false });
const store = { get(key) { try { return localStorage.getItem(`nullx11:${key}`); } catch { return null; } }, set(key, value) { try { localStorage.setItem(`nullx11:${key}`, value); } catch { /* private browsing/storage full */ } } };
const state = { meta: null, providers: [], connected: [], agents: [], commands: [], sessions: [], messages: [], current: null, statuses: {}, model: null, agent: 'build', attachments: [], permissions: [], questions: [], tab: 'files', filePath: '', online: false, sending: false, loaded: false };
let source;
let messageTimer;
let sessionTimer;
let syncRunning = false;
let syncAgain = false;
let currentRender = '';
let dialogCleanup = null;
let selectionEpoch = 0;
const busy = () => state.sending || (state.current && ['busy', 'retry'].includes(state.statuses[state.current]?.type));

async function api(route, options = {}) {
  const url = new URL(route, location.origin);
  if (state.meta?.root && !url.searchParams.has('directory')) url.searchParams.set('directory', state.meta.root);
  const response = await fetch(url.pathname + url.search, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers } });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) throw new Error(data?.data?.message || data?.error?.message || data?.error || data?.message || `${route.split('?')[0]} failed (${response.status})`);
  return data;
}
const post = (route, body) => api(route, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
function toast(message, error = false) {
  const node = document.createElement('div');
  node.className = `toast${error ? ' error' : ''}`;
  node.textContent = message;
  $('toasts').append(node);
  setTimeout(() => node.remove(), error ? 8000 : 4000);
}
function error(e) { toast(e.message || 'Something went wrong. Please try again.', true); }
function guarded(fn) { return (...args) => Promise.resolve().then(() => fn(...args)).catch(error); }
function modelName() { return state.model ? (findModel(state.model)?.name || state.model.modelID.split('/').at(-1)) : 'Choose a model'; }
function findModel(ref) { return state.providers.find((p) => p.id === ref?.providerID)?.models?.[ref?.modelID]; }
function hasConnectedModel() { return state.model && state.connected.includes(state.model.providerID); }

function updateControls() {
  $('model-label').textContent = modelName();
  $('agent-button').querySelector('span').textContent = state.agent.charAt(0).toUpperCase() + state.agent.slice(1);
  $('send').hidden = !!busy();
  $('stop').hidden = !busy();
  $('send').disabled = !state.online || !state.loaded;
  $('connection-status').textContent = state.online ? (busy() ? 'Agent working' : 'Engine connected') : 'Connecting';
  $('status-dot').className = `status-dot${state.online ? (busy() ? ' busy' : ' connected') : ''}`;
  $('connection-banner').hidden = state.online;
  $('session-stats').textContent = state.current ? `${state.messages.length} messages` : 'No session started';
  const cost = state.messages.reduce((total, m) => total + (m.info.cost || 0), 0);
  const tokens = state.messages.reduce((total, m) => total + (m.info.tokens?.input || 0) + (m.info.tokens?.output || 0), 0);
  $('usage-label').textContent = tokens ? `${tokens.toLocaleString()} tokens · $${cost.toFixed(4)}` : 'Tool actions follow your permissions';
  $('attachments').hidden = !state.attachments.length;
  $('attachments').innerHTML = state.attachments.map((f, i) => `<span class="attachment-chip">${icon('file')}<span>${esc(f.name)}</span><button type="button" data-remove-attachment="${i}" aria-label="Remove ${esc(f.name)}">×</button></span>`).join('');
}
function renderSessions() {
  $('sessions').innerHTML = state.sessions.length ? state.sessions.map((session) => `<div class="session-row${state.current === session.id ? ' selected' : ''}"><button class="session-button" data-session="${esc(session.id)}" title="${esc(session.title)}">${icon('chat')}<span>${esc(session.title || 'Untitled session')}</span></button><button class="icon-button session-delete" data-delete-session="${esc(session.id)}" title="Delete session" aria-label="Delete ${esc(session.title)}">${icon('trash')}</button></div>`).join('') : '<p class="muted empty-list">No sessions yet.<br>Your next idea starts here.</p>';
  const title = state.sessions.find((s) => s.id === state.current)?.title || 'New session';
  $('session-title').textContent = title;
  document.title = `${state.current ? title : 'Workspace'} — nullx11code`;
}
async function refreshSessions() {
  state.sessions = await api('/session?limit=60');
  renderSessions();
}
function persistDraft() { store.set(`draft:${state.current || 'new'}`, $('prompt').value); }
function resizePrompt() { $('prompt').style.height = 'auto'; $('prompt').style.height = `${Math.min($('prompt').scrollHeight, 240)}px`; }
async function selectSession(id, { initial = false } = {}) {
  persistDraft();
  if (state.submitting) { toast('Your message is being submitted. Please wait a moment.'); return; }
  const epoch = ++selectionEpoch;
  state.current = id;
  state.messages = [];
  state.sessionInfo = null;
  state.attachments = [];
  state.sending = false;
  currentRender = '';
  const url = new URL(location.href);
  id ? url.searchParams.set('session', id) : url.searchParams.delete('session');
  history.replaceState({}, '', url);
  $('prompt').value = store.get(`draft:${id || 'new'}`) || '';
  resizePrompt();
  renderSessions();
  renderMessages();
  if (!initial) $('app').classList.remove('sidebar-open');
  if (id) {
    const [messages, info] = await Promise.all([api(`/session/${encodeURIComponent(id)}/message`), api(`/session/${encodeURIComponent(id)}`)]);
    if (epoch !== selectionEpoch) return;
    state.messages = messages;
    state.sessionInfo = info;
    renderMessages();
    await refreshAttention();
  } else { state.permissions = []; state.questions = []; renderAttention(); }
  await refreshInspector();
  updateControls();
  if (!initial) $('prompt').focus();
}
function renderPart(part) {
  if (part.synthetic || part.ignored) return '';
  if (part.type === 'text') return `<div class="markdown">${clean(part.text)}</div>`;
  if (part.type === 'reasoning' && part.text) return `<details class="reasoning" data-part="${esc(part.id)}"><summary>Thinking</summary>${clean(part.text)}</details>`;
  if (part.type === 'file') return `<div class="attachment-chip">${icon('file')}<span>${esc(part.filename || part.url?.split('/').at(-1) || 'Attachment')}</span></div>`;
  if (part.type === 'tool') {
    const status = part.state || {};
    const label = status.title || part.tool;
    const output = status.error || status.output || JSON.stringify(status.input || {}, null, 2);
    return `<details class="tool-call" data-part="${esc(part.id)}"><summary>${icon(status.status === 'completed' ? 'check' : status.status === 'error' ? 'x' : 'code')}<span>${esc(label)}</span><span class="tool-state">${esc(status.status || 'pending')}</span></summary><pre>${esc(typeof output === 'string' ? output : JSON.stringify(output, null, 2))}</pre></details>`;
  }
  if (part.type === 'compaction') return '<p class="muted">Earlier context was compacted by the engine.</p>';
  return '';
}
function visibleMessages() {
  const index = state.sessionInfo?.revert?.messageID ? state.messages.findIndex((message) => message.info.id === state.sessionInfo.revert.messageID) : -1;
  return index >= 0 ? state.messages.slice(0, index) : state.messages;
}
function renderMessages() {
  const hasMessages = state.messages.length > 0 || !!state.current;
  $('welcome').hidden = hasMessages;
  $('messages').hidden = !hasMessages;
  const signature = JSON.stringify([state.messages, state.sessionInfo?.revert, !!busy()]);
  if (signature === currentRender) { updateControls(); return; }
  currentRender = signature;
  const scroll = $('chat-scroll');
  const stick = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 140;
  const open = new Set([...$('messages').querySelectorAll('details[open][data-part]')].map((d) => d.dataset.part));
  $('messages').innerHTML = (state.sessionInfo?.revert ? '<div class="revert-notice">Last turn reverted. <button data-action="redo">Restore reverted turn</button></div>' : '') + visibleMessages().map((message) => {
    const { info, parts = [] } = message;
    const assistant = info.role === 'assistant';
    const time = info.time?.created ? new Date(info.time.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const errorText = info.error?.data?.message || info.error?.message;
    return `<article class="message" data-message="${esc(info.id)}"><div class="message-header"><span class="avatar${assistant ? ' assistant' : ''}">${assistant ? '✳' : 'YOU'}</span><strong>${assistant ? 'nullx11code' : 'You'}</strong><time>${esc(time)}</time><button class="icon-button message-copy" data-copy-message="${esc(info.id)}" title="Copy message" aria-label="Copy message">${icon('copy')}</button></div><div class="message-body">${parts.map(renderPart).join('')}${errorText ? `<p class="message-error">${esc(errorText)}</p>` : ''}</div></article>`;
  }).join('') + (busy() ? '<div class="typing" aria-label="Agent working"><i></i><i></i><i></i></div>' : '');
  for (const detail of $('messages').querySelectorAll('details[data-part]')) if (open.has(detail.dataset.part)) detail.open = true;
  for (const image of $('messages').querySelectorAll('.markdown img')) image.addEventListener('error', () => image.replaceWith(document.createTextNode(image.alt || '')), { once: true });
  for (const pre of $('messages').querySelectorAll('.markdown pre')) {
    const button = document.createElement('button');
    button.className = 'code-copy'; button.textContent = 'Copy';
    button.addEventListener('click', guarded(async () => { await navigator.clipboard.writeText(pre.querySelector('code')?.textContent || ''); button.textContent = 'Copied'; }));
    pre.prepend(button);
  }
  updateControls();
  if (stick) scroll.scrollTop = scroll.scrollHeight;
}
async function syncMessages() {
  if (!state.current) return;
  if (syncRunning) { syncAgain = true; return; }
  syncRunning = true;
  const id = state.current;
  try {
    const [messages, info] = await Promise.all([api(`/session/${encodeURIComponent(id)}/message`), api(`/session/${encodeURIComponent(id)}`)]);
    if (state.current === id) { state.messages = messages; state.sessionInfo = info; renderMessages(); }
  } catch (e) { if (state.online && state.current === id) error(e); }
  finally { syncRunning = false; if (syncAgain) { syncAgain = false; scheduleMessages(); } }
}
function scheduleMessages() { if (!messageTimer) messageTimer = setTimeout(() => { messageTimer = null; syncMessages(); }, 140); }
function scheduleSessions() { clearTimeout(sessionTimer); sessionTimer = setTimeout(() => refreshSessions().catch(() => {}), 350); }

async function sendMessage(event) {
  event.preventDefault();
  const text = $('prompt').value.trim();
  if (!text || busy()) return;
  if (!hasConnectedModel()) { openModels(); toast('Choose a connected model before sending.'); return; }
  state.sending = true; state.submitting = true; updateControls();
  let id = state.current;
  const attached = [...state.attachments];
  try {
    if (!id) {
      const created = await post('/session', { title: text.slice(0, 75) });
      id = created.id;
      state.current = id;
      history.replaceState({}, '', `/?session=${encodeURIComponent(id)}`);
      await refreshSessions();
    }
    const parts = [{ type: 'text', text }, ...attached.map((file) => ({ type: 'file', mime: 'text/plain', filename: file.name, url: file.url }))];
    const slash = text.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
    const command = slash && state.commands.find((c) => c.name === slash[1]);
    $('prompt').value = ''; state.attachments = []; persistDraft(); store.set('draft:new', ''); resizePrompt();
    state.messages.push({ info: { id: 'optimistic', role: 'user', time: { created: Date.now() } }, parts });
    renderMessages();
    $('chat-scroll').scrollTop = $('chat-scroll').scrollHeight;
    if (command) {
      // Native commands may execute interpolated shell commands. Submission is
      // explicit, and engine permissions continue to govern agent tool calls.
      await post(`/session/${id}/command`, { command: command.name, arguments: slash[2] || '', agent: state.agent, model: `${state.model.providerID}/${state.model.modelID}` });
      state.sending = false;
    } else {
      await post(`/session/${id}/prompt_async`, { agent: state.agent, model: state.model, parts });
    }
    await syncMessages();
  } catch (e) {
    state.sending = false;
    if (!$('prompt').value) { $('prompt').value = text; state.attachments = attached; persistDraft(); resizePrompt(); }
    state.messages = state.messages.filter((m) => m.info.id !== 'optimistic');
    renderMessages(); error(e);
  }
  state.submitting = false;
  updateControls();
}

function connectEvents() {
  source?.close();
  source = new EventSource(`/event?directory=${encodeURIComponent(state.meta.root)}`);
  source.onopen = () => { state.online = true; updateControls(); refreshAttention().catch(() => {}); if (state.current) syncMessages(); };
  source.onerror = () => { state.online = false; updateControls(); };
  source.onmessage = ({ data }) => {
    let event; try { event = JSON.parse(data); } catch { return; }
    const p = event.properties || {};
    const sessionID = p.sessionID || p.info?.sessionID || p.part?.sessionID;
    if (event.type === 'session.status') {
      state.statuses[p.sessionID] = p.status;
      if (p.sessionID === state.current) { if (p.status.type === 'idle') { state.sending = false; refreshInspector().catch(() => {}); } scheduleMessages(); }
      updateControls();
    }
    if (event.type === 'session.idle' && p.sessionID === state.current) { state.sending = false; state.statuses[p.sessionID] = { type: 'idle' }; scheduleMessages(); refreshInspector().catch(() => {}); }
    if (event.type.startsWith('message.') && sessionID === state.current) scheduleMessages();
    if (event.type.startsWith('session.')) scheduleSessions();
    if (event.type.startsWith('permission.') || event.type.startsWith('question.')) refreshAttention().catch(error);
    if (event.type === 'todo.updated' && sessionID === state.current && state.tab === 'tasks') refreshInspector().catch(() => {});
    if (event.type === 'session.error' && (!sessionID || sessionID === state.current)) {
      state.sending = false; updateControls(); scheduleMessages();
      toast(p.error?.data?.message || 'The agent encountered an error. Check your provider and model.', true);
    }
  };
}

function showDialog(title, html, eyebrow = 'NULLX11CODE') {
  if (dialogCleanup) { dialogCleanup(); dialogCleanup = null; }
  $('dialog-title').textContent = title;
  $('dialog-eyebrow').textContent = eyebrow;
  $('dialog-body').innerHTML = html;
  if (!$('dialog').open) $('dialog').showModal();
  requestAnimationFrame(() => $('dialog-body').querySelector('input,textarea,button,select')?.focus());
}
function closeDialog() { $('dialog').close(); }
function listItem({ title, subtitle, badge, action, data = '', glyph = 'chevron' }) {
  return `<button class="list-item" ${action ? `data-action="${action}"` : ''} ${data}>${icon(glyph)}<span class="list-main"><strong>${esc(title)}</strong>${subtitle ? `<small>${esc(subtitle)}</small>` : ''}</span>${badge ? `<span class="list-badge">${esc(badge)}</span>` : ''}</button>`;
}
function searchable(title, placeholder, render, eyebrow) {
  showDialog(title, `<input class="search-input" id="dialog-search" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" autocomplete="off"/><div id="dialog-results" class="dialog-list"></div>`, eyebrow);
  const update = () => { $('dialog-results').innerHTML = render($('dialog-search').value.toLowerCase().trim()); };
  $('dialog-search').addEventListener('input', update); update();
  $('dialog-search').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); $('dialog-results').querySelector('button')?.click(); }
  });
}
function openModels() {
  searchable('Choose your model', 'Search models or providers…', (query) => {
    const providers = [...state.providers].sort((a, b) => Number(state.connected.includes(b.id)) - Number(state.connected.includes(a.id)) || a.name.localeCompare(b.name));
    let total = 0;
    const items = providers.flatMap((provider) => {
      if (!state.connected.includes(provider.id)) return [];
      const models = Object.values(provider.models || {}).filter((model) => `${model.name} ${model.id} ${provider.name}`.toLowerCase().includes(query)).slice(0, query ? 30 : 8);
      if (!models.length || total > 120) return [];
      total += models.length;
      return [`<div class="list-section">${esc(provider.name)}</div>`, ...models.map((model) => listItem({ title: model.name || model.id, subtitle: model.id, badge: state.model?.providerID === provider.id && state.model?.modelID === model.id ? 'SELECTED' : !provider.id.startsWith('nullx11-') && model.cost?.input === 0 && model.cost?.output === 0 ? 'FREE' : undefined, data: `data-model-provider="${esc(provider.id)}" data-model-id="${esc(model.id)}"`, glyph: 'spark' }))];
    });
    return items.join('') + (total ? '' : '<p class="form-note">No matching connected models. Connect a provider to see its models.</p>') + listItem({ title: 'Connect another provider', subtitle: 'NVIDIA, Groq, OpenRouter, Anthropic, and more', action: 'connect', glyph: 'plus' });
  }, 'YOUR MODELS. YOUR CHOICE.');
}
function openAgents() {
  showDialog('Choose an agent', `<p class="form-note">Build can implement changes with your approval. Plan investigates and proposes a path forward without editing your project.</p><div class="dialog-list">${state.agents.filter((a) => !a.hidden && a.mode !== 'subagent').map((agent) => listItem({ title: agent.name, subtitle: agent.description, badge: agent.name === state.agent ? 'SELECTED' : '', data: `data-agent="${esc(agent.name)}"`, glyph: agent.name === 'plan' ? 'file' : 'spark' })).join('')}</div>`);
}
function openPalette() {
  const actions = [
    { title: 'New session', subtitle: 'Start a fresh conversation', action: 'new', glyph: 'plus' },
    { title: 'Choose model', subtitle: 'Search connected models', action: 'models', glyph: 'spark' },
    { title: 'Connect a provider', subtitle: 'Bring your own API key', action: 'connect', glyph: 'key' },
    { title: 'Attach a project file', subtitle: 'Give the agent more context', action: 'attach', glyph: 'file' },
    { title: 'Settings', subtitle: 'Appearance, engine and workspace', action: 'settings', glyph: 'settings' },
    { title: 'Toggle theme', subtitle: 'Switch between light and dark', action: 'theme', glyph: 'sun' },
    { title: 'Advanced workspace', subtitle: 'Advanced OpenCode features', action: 'native', glyph: 'link' },
  ];
  searchable('Go anywhere. Build anything.', 'Search actions, sessions, commands…', (query) => {
    const filtered = actions.filter((a) => `${a.title} ${a.subtitle}`.toLowerCase().includes(query));
    const sessions = state.sessions.filter((s) => s.title.toLowerCase().includes(query)).slice(0, 12);
    const commands = state.commands.filter((c) => `${c.name} ${c.description}`.toLowerCase().includes(query)).slice(0, 12);
    return filtered.map(listItem).join('') + (sessions.length ? '<div class="list-section">SESSIONS</div>' : '') + sessions.map((s) => listItem({ title: s.title, data: `data-session="${esc(s.id)}"`, glyph: 'chat' })).join('') + (commands.length ? '<div class="list-section">COMMANDS</div>' : '') + commands.map((c) => listItem({ title: `/${c.name}`, subtitle: c.description, data: `data-command="${esc(c.name)}"`, glyph: 'code' })).join('');
  }, 'COMMAND CENTER');
}
function openConnect() {
  const favorite = ['nvidia', 'groq', 'cerebras', 'openrouter', 'google', 'anthropic', 'openai'];
  const providers = state.providers.filter((p) => !p.id.startsWith('nullx11-') && p.env?.length && !/vertex|bedrock|copilot/.test(p.id));
  providers.sort((a, b) => (favorite.includes(a.id) ? favorite.indexOf(a.id) : 99) - (favorite.includes(b.id) ? favorite.indexOf(b.id) : 99) || a.name.localeCompare(b.name));
  searchable('Connect a provider', 'Find your provider…', (q) => '<p class="form-note">Your API key is stored by OpenCode on this machine, never in browser storage. Free tiers depend on your provider and account.</p>' + providers.filter((p) => `${p.name} ${p.id}`.toLowerCase().includes(q)).map((p) => listItem({ title: p.name, subtitle: p.env.join(' · '), badge: state.connected.includes(p.id) ? 'CONNECTED' : undefined, data: `data-connect-provider="${esc(p.id)}"`, glyph: 'key' })).join('') + '<p class="form-note">Custom endpoints and OAuth providers are available in the <a href="/?experience=advanced">advanced workspace</a>.</p>', 'NO MODEL LOCK-IN');
}
function providerForm(id) {
  const provider = state.providers.find((p) => p.id === id);
  if (!provider) return;
  showDialog(`Connect ${provider.name}`, `<p class="form-note">Use an API key from your ${esc(provider.name)} account. This does not verify billing or guarantee free usage. Connecting will refresh the engine context; stop any active runs first.</p><form id="provider-form"><label class="form-field">API key<input class="form-input" type="password" id="provider-key" required autocomplete="off" placeholder="Paste your API key"/></label><p class="form-error" id="provider-error" role="alert"></p><button type="submit" class="primary-button" id="provider-save">${icon('key')}Save key & connect</button></form>`);
  $('provider-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.querySelector('#provider-key');
    const save = form.querySelector('#provider-save');
    const key = input.value.trim();
    if (!key) return;
    if (busy()) { $('provider-error').textContent = 'Stop the active run before connecting a provider.'; return; }
    save.disabled = true;
    try {
      const statuses = await api('/session/status');
      if (Object.values(statuses).some((status) => ['busy', 'retry'].includes(status.type))) throw new Error('Stop all active agent runs before refreshing provider connections.');
      await api(`/auth/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ type: 'api', key }) });
      input.value = '';
      await post('/instance/dispose');
      await refreshProviders(); connectEvents();
      toast('Key saved. Choose a model to start; the first request will verify access.');
      if (form.isConnected) { closeDialog(); openModels(); }
    } catch (e) { if (form.isConnected) form.querySelector('#provider-error').textContent = e.message; else error(e); }
    finally { save.disabled = false; }
  });
}
async function refreshProviders() {
  const data = await api('/provider');
  state.providers = data.all || []; state.connected = data.connected || [];
  const saved = store.get('model');
  if (!state.model && saved) { try { state.model = JSON.parse(saved); } catch { /* reset invalid storage */ } }
  if (!state.model && state.meta.model) {
    const slash = state.meta.model.indexOf('/');
    state.model = { providerID: state.meta.model.slice(0, slash), modelID: state.meta.model.slice(slash + 1) };
  }
  if (!findModel(state.model) || !state.connected.includes(state.model?.providerID)) {
    state.model = null;
    const preferred = state.providers.find((p) => state.connected.includes(p.id) && p.id.startsWith('nullx11-')) || state.providers.find((p) => state.connected.includes(p.id));
    if (preferred) {
      const models = Object.values(preferred.models || {});
      const model = models.find((m) => m.cost?.input === 0 && m.cost?.output === 0) || models[0];
      if (model) state.model = { providerID: preferred.id, modelID: model.id };
    }
  }
  updateControls();
}
function toggleTheme() { const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme; store.set('theme', theme); }
function openSettings() {
  showDialog('Make yourself at home', `<div class="settings-row"><span><strong>Appearance</strong><small>Switch between dark and light</small></span><button class="secondary-button" data-action="theme">${icon('sun')}Toggle theme</button></div><div class="settings-row"><span><strong>Agent engine</strong><small>OpenCode ${esc(state.meta.runtimeVersion)} · nullx11code ${esc(state.meta.version)}</small></span><span class="list-badge">LOCAL</span></div><div class="settings-row"><span><strong>Working directory</strong><small>${esc(state.meta.root)}</small></span></div><div class="settings-row"><span><strong>Server authentication</strong><small>${state.meta.authenticated ? 'Password-protected access is enabled.' : 'No password. Keep this server on a trusted network.'}</small></span>${icon(state.meta.authenticated ? 'check' : 'key')}</div><p class="form-note">This workspace uses your real project and the OpenCode engine. Writes and shell commands follow your configured permission rules. Check approvals carefully.</p><div class="settings-actions"><button class="secondary-button" data-action="connect">${icon('key')}Providers</button><a class="secondary-button" href="/?experience=advanced">${icon('link')}Advanced workspace</a></div>`);
}

let attentionEpoch = 0;
async function refreshAttention() {
  const epoch = ++attentionEpoch;
  const [permissions, questions] = await Promise.all([api('/permission'), api('/question')]);
  if (epoch !== attentionEpoch) return;
  state.permissions = permissions.filter((p) => p.sessionID === state.current);
  state.questions = questions.filter((q) => q.sessionID === state.current);
  renderAttention();
}
function renderAttention() {
  const permission = state.permissions[0];
  const question = state.questions[0];
  $('attention').hidden = !permission && !question;
  if (permission) {
    $('attention').innerHTML = `<strong>Approval needed · ${esc(permission.permission)}</strong><pre>${esc(permission.patterns?.join('\n') || JSON.stringify(permission.metadata, null, 2))}</pre><div class="attention-actions"><button class="primary-button" data-permission="${esc(permission.id)}" data-reply="once">Allow once</button><button class="secondary-button" data-permission="${esc(permission.id)}" data-reply="always">Allow for session</button><button class="danger-button" data-permission="${esc(permission.id)}" data-reply="reject">Deny</button></div>`;
  } else if (question) {
    $('attention').innerHTML = `<strong>The agent has a question</strong><form id="question-form">${question.questions.map((q, i) => `<p>${esc(q.question)}</p><div class="question-options">${q.options.map((o) => `<label><input type="${q.multiple ? 'checkbox' : 'radio'}" name="q${i}" value="${esc(o.label)}"/>${esc(o.label)}${o.description ? ` — ${esc(o.description)}` : ''}</label>`).join('')}</div>${q.custom !== false ? `<input class="question-text" name="custom${i}" placeholder="Or write your own answer" aria-label="Custom answer for question ${i + 1}"/>` : ''}`).join('')}<div class="attention-actions"><button class="primary-button" type="submit">Send answers</button><button class="secondary-button" type="button" data-reject-question="${esc(question.id)}">Dismiss</button></div></form>`;
    $('question-form').addEventListener('submit', guarded(async (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      const answers = question.questions.map((_, i) => [...data.getAll(`q${i}`), ...(data.get(`custom${i}`)?.trim() ? [data.get(`custom${i}`).trim()] : [])]);
      if (answers.some((a) => !a.length)) { toast('Please answer each question.', true); return; }
      await post(`/question/${question.id}/reply`, { answers }); await refreshAttention();
    }));
  } else $('attention').replaceChildren();
}

let inspectorEpoch = 0;
async function refreshInspector() {
  const epoch = ++inspectorEpoch;
  if (state.tab === 'files') {
    const files = await api(`/file?path=${encodeURIComponent(state.filePath)}`);
    if (epoch !== inspectorEpoch) return;
    files.sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name));
    $('inspector-content').innerHTML = `<div class="file-path">${icon('folder', 'tiny')}<span>${esc(state.filePath || state.meta.project)}</span>${state.filePath ? '<button data-action="file-up">↑ parent</button>' : ''}</div>` + files.filter((f) => !f.ignored && !['.git', 'node_modules'].includes(f.name)).map((file) => `<button class="file-row ${file.type === 'directory' ? 'directory' : ''}" data-file-path="${esc(file.path)}" data-file-type="${esc(file.type)}" title="${esc(file.path)}">${icon(file.type === 'directory' ? 'folder' : 'file')}<span>${esc(file.name)}</span><span class="file-add">${file.type === 'directory' ? '›' : '+'}</span></button>`).join('');
  } else if (state.tab === 'changes') {
    const changes = state.current ? await api(`/session/${state.current}/diff`) : [];
    if (epoch !== inspectorEpoch) return;
    $('changes-count').textContent = changes.length;
    $('inspector-content').innerHTML = changes.length ? changes.map((file, i) => `<button class="file-row" data-diff="${i}">${icon('file')}<span>${esc(file.file)}</span><span class="change-count"><span class="added">+${file.additions}</span> <span class="removed">−${file.deletions}</span></span></button>`).join('') : `<div class="inspector-empty">${icon('branch')}<strong>A clean slate</strong><p>Changes made by the agent in this session will appear here.</p></div>`;
    $('inspector-content').querySelectorAll('[data-diff]').forEach((button) => button.addEventListener('click', () => {
      const file = changes[Number(button.dataset.diff)];
      showDialog(file.file, `<p class="form-note"><span class="added">+${file.additions} additions</span> · <span class="removed">−${file.deletions} deletions</span></p><h3>Before</h3><pre class="diff-view">${esc(file.before || '(new file)')}</pre><h3>After</h3><pre class="diff-view">${esc(file.after || '(deleted file)')}</pre>`);
    }));
  } else {
    const tasks = state.current ? await api(`/session/${state.current}/todo`) : [];
    if (epoch !== inspectorEpoch) return;
    $('inspector-content').innerHTML = tasks.length ? tasks.map((task) => `<div class="task-item ${esc(task.status)}"><span class="task-check"></span><span>${esc(task.content)}</span></div>`).join('') : `<div class="inspector-empty">${icon('check')}<strong>One step at a time</strong><p>The agent’s task list will appear here when it creates a plan.</p></div>`;
  }
}
function showInspector(tab = state.tab) {
  $('app').classList.remove('no-inspector'); $('app').classList.add('inspector-open');
  state.tab = tab;
  document.querySelectorAll('[data-tab]').forEach((button) => { const selected = button.dataset.tab === tab; button.classList.toggle('selected', selected); button.setAttribute('aria-selected', String(selected)); });
  refreshInspector().catch(error);
}
async function filePreview(filePath) {
  const content = await api(`/file/content?path=${encodeURIComponent(filePath)}`);
  showDialog(filePath.split('/').at(-1), `<p class="form-note">${esc(filePath)}</p>${content.type === 'binary' || content.encoding === 'base64' ? '<p class="form-note">Binary file previews are available in the advanced workspace.</p>' : `<pre class="file-preview">${esc(content.content.length > 262144 ? content.content.slice(0, 262144) + '\n\n[Preview truncated at 256 KiB. Attaching includes the original file.]' : content.content)}</pre><div class="dialog-bottom"><button class="primary-button" data-attach-path="${esc(filePath)}">${icon('plus')}Add to context</button></div>`}`, 'PROJECT FILE');
}
function attachPath(filePath) {
  if (state.attachments.some((f) => f.path === filePath)) { toast('This file is already attached.'); closeDialog(); return; }
  if (state.attachments.length >= 12) { toast('Attach up to 12 files per message.', true); return; }
  const fileURL = new URL(`file://${state.meta.root.replace(/\\/g, '/')}/`);
  fileURL.pathname = fileURL.pathname.replace(/\/$/, '') + '/' + filePath.replace(/^\//, '');
  state.attachments.push({ path: filePath, name: filePath.split('/').at(-1), url: fileURL.href });
  updateControls(); closeDialog(); $('prompt').focus();
}
function openAttach() {
  let timer;
  searchable('Add project context', 'Search project files…', () => '<p class="form-note">Search for a file, or choose one from the workspace panel.</p>', 'GIVE THE AGENT THE RIGHT CONTEXT');
  let epoch = 0;
  $('dialog-search').addEventListener('input', () => {
    clearTimeout(timer); const query = $('dialog-search').value; const own = ++epoch;
    timer = setTimeout(guarded(async () => {
      const files = await api(`/find/file?query=${encodeURIComponent(query)}&limit=40&type=file`);
      if (own !== epoch || !$('dialog-results')) return;
      $('dialog-results').innerHTML = files.length ? files.map((file) => listItem({ title: file.split('/').at(-1), subtitle: file, data: `data-attach-path="${esc(file)}"`, glyph: 'file' })).join('') : '<p class="form-note">No files found.</p>';
    }), 200);
  });
  dialogCleanup = () => { clearTimeout(timer); epoch++; };
  $('dialog-search').dispatchEvent(new Event('input'));
}
function openSessionMenu() {
  if (!state.current) { toast('Start a conversation to use session actions.'); return; }
  showDialog('Session actions', `<div class="dialog-list">${[
    { title: 'Rename session', action: 'rename', glyph: 'file' },
    { title: 'Export conversation', subtitle: 'Download this session as Markdown', action: 'export', glyph: 'download' },
    { title: 'Fork session', subtitle: 'Continue in a separate conversation', action: 'fork', glyph: 'branch' },
    { title: 'Undo last turn', subtitle: 'Revert the last user message and its changes', action: 'undo', glyph: 'clock' },
    { title: 'Restore reverted turn', action: 'redo', glyph: 'clock' },
    { title: 'Delete this session', action: 'delete-current', glyph: 'trash' },
  ].map(listItem).join('')}</div>`);
}
async function deleteSession(id) {
  const title = state.sessions.find((s) => s.id === id)?.title || 'this session';
  showDialog('Delete session?', `<p class="form-note">Delete “${esc(title)}” and its conversation history? Project files are not reverted. This cannot be undone.</p><div class="dialog-bottom"><button class="secondary-button" data-action="close-dialog">Keep session</button><button class="danger-button" data-confirm-delete="${esc(id)}">Delete session</button></div>`);
}
function slashMenu() {
  const match = $('prompt').value.match(/^\/([^\s]*)$/);
  const commands = match ? state.commands.filter((c) => c.name.startsWith(match[1])).slice(0, 8) : [];
  $('slash-menu').hidden = !commands.length;
  $('slash-menu').innerHTML = commands.map((c) => `<button type="button" class="slash-item" data-command="${esc(c.name)}"><strong>/${esc(c.name)}</strong><small>${esc(c.description || '')}</small></button>`).join('');
}

const actions = {
  new: async () => { closeDialog(); await selectSession(null); },
  palette: openPalette, models: openModels, agents: openAgents, connect: openConnect, settings: openSettings,
  'close-dialog': closeDialog, native: () => { location.href = '/?experience=advanced'; },
  theme: toggleTheme, sidebar: () => $('app').classList.toggle('sidebar-open'),
  inspector: () => { const app = $('app'); if (innerWidth > 1190) app.classList.toggle('no-inspector'); else app.classList.toggle('inspector-open'); },
  files: () => showInspector('files'), attach: openAttach,
  refresh: async () => { await refreshSessions(); toast('Sessions refreshed.'); },
  'file-up': () => { state.filePath = state.filePath.replace(/\/?[^/]+\/?$/, ''); return refreshInspector(); },
  stop: async () => { if (!state.current) return; await post(`/session/${state.current}/abort`); state.sending = false; state.statuses[state.current] = { type: 'idle' }; await syncMessages(); updateControls(); },
  'session-menu': openSessionMenu,
  rename: () => {
    const title = state.sessions.find((s) => s.id === state.current)?.title || '';
    showDialog('Rename this session', `<form id="rename-form"><label class="form-field">Session title<input class="form-input" id="rename-title" value="${esc(title)}" required maxlength="160"/></label><button class="primary-button">Save title</button></form>`);
    $('rename-form').addEventListener('submit', guarded(async (event) => { event.preventDefault(); const title = $('rename-title').value.trim(); if (!title) return; await api(`/session/${state.current}`, { method: 'PATCH', body: JSON.stringify({ title }) }); closeDialog(); await refreshSessions(); }));
  },
  export: () => {
    const title = state.sessions.find((s) => s.id === state.current)?.title || 'Conversation';
    const text = `# ${title}\n\n` + visibleMessages().map((m) => `## ${m.info.role === 'assistant' ? 'nullx11code' : 'You'}\n\n` + m.parts.filter((p) => p.type === 'text' && !p.synthetic && !p.ignored).map((p) => p.text).join('\n\n')).join('\n\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    const link = document.createElement('a'); link.href = url; link.download = `nullx11code-${state.current}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); closeDialog();
  },
  fork: async () => { const created = await post(`/session/${state.current}/fork`, {}); closeDialog(); await refreshSessions(); await selectSession(created.id); toast('Conversation forked.'); },
  undo: async () => { if (busy()) throw new Error('Stop the active run before reverting.'); const last = [...state.messages].reverse().find((m) => m.info.role === 'user'); if (!last) return; await post(`/session/${state.current}/revert`, { messageID: last.info.id }); closeDialog(); await syncMessages(); await refreshInspector(); toast('Last turn reverted. Use Restore reverted turn to undo this action.'); },
  redo: async () => { if (busy()) throw new Error('Stop the active run first.'); await post(`/session/${state.current}/unrevert`); closeDialog(); await syncMessages(); await refreshInspector(); toast('Reverted turn restored.'); },
  'delete-current': () => deleteSession(state.current),
};

document.addEventListener('click', guarded(async (event) => {
  const button = event.target.closest('button,a[data-action]');
  if (!button) return;
  if (button.dataset.action) { event.preventDefault(); await actions[button.dataset.action]?.(); return; }
  if (button.dataset.prompt) { $('prompt').value = button.dataset.prompt; resizePrompt(); persistDraft(); $('prompt').focus(); }
  else if (button.dataset.session) { closeDialog(); await selectSession(button.dataset.session); }
  else if (button.dataset.deleteSession) await deleteSession(button.dataset.deleteSession);
  else if (button.dataset.confirmDelete) { const id = button.dataset.confirmDelete; await api(`/session/${id}`, { method: 'DELETE' }); closeDialog(); if (state.current === id) await selectSession(null); await refreshSessions(); toast('Session deleted.'); }
  else if (button.dataset.modelProvider) { state.model = { providerID: button.dataset.modelProvider, modelID: button.dataset.modelId }; store.set('model', JSON.stringify(state.model)); updateControls(); closeDialog(); $('prompt').focus(); }
  else if (button.dataset.agent) { state.agent = button.dataset.agent; updateControls(); closeDialog(); }
  else if (button.dataset.connectProvider) providerForm(button.dataset.connectProvider);
  else if (button.dataset.tab) showInspector(button.dataset.tab);
  else if (button.dataset.filePath) { if (button.dataset.fileType === 'directory') { state.filePath = button.dataset.filePath; await refreshInspector(); } else await filePreview(button.dataset.filePath); }
  else if (button.dataset.attachPath) attachPath(button.dataset.attachPath);
  else if (button.dataset.removeAttachment) { state.attachments.splice(Number(button.dataset.removeAttachment), 1); updateControls(); }
  else if (button.dataset.permission) { button.disabled = true; try { await post(`/permission/${button.dataset.permission}/reply`, { reply: button.dataset.reply }); await refreshAttention(); } finally { button.disabled = false; } }
  else if (button.dataset.rejectQuestion) { await post(`/question/${button.dataset.rejectQuestion}/reject`); await refreshAttention(); }
  else if (button.dataset.copyMessage) { const message = state.messages.find((m) => m.info.id === button.dataset.copyMessage); await navigator.clipboard.writeText(message.parts.filter((p) => p.type === 'text' && !p.synthetic && !p.ignored).map((p) => p.text).join('\n')); toast('Message copied.'); }
  else if (button.dataset.command) { closeDialog(); $('prompt').value = `/${button.dataset.command} `; slashMenu(); resizePrompt(); $('prompt').focus(); }
}));
$('composer-form').addEventListener('submit', guarded(sendMessage));
$('prompt').addEventListener('input', () => { resizePrompt(); persistDraft(); slashMenu(); });
$('prompt').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!$('slash-menu').hidden) $('slash-menu').querySelector('button')?.click(); else $('composer-form').requestSubmit(); }
  if (event.key === 'Escape') $('slash-menu').hidden = true;
});
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openPalette(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); guarded(actions.new)(); }
  if (event.key === 'Escape') { $('app').classList.remove('sidebar-open', 'inspector-open'); $('slash-menu').hidden = true; }
});
$('dialog').addEventListener('keydown', (event) => {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key) || !$('dialog-results')) return;
  const buttons = [...$('dialog-results').querySelectorAll('button')];
  if (!buttons.length) return;
  const index = buttons.indexOf(document.activeElement);
  const next = index < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  event.preventDefault(); buttons[next].focus();
});
$('dialog').addEventListener('click', (event) => { if (event.target === $('dialog')) { const rect = $('dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(); } });
$('dialog').addEventListener('close', () => { if ($('dialog').open) return; if (dialogCleanup) { dialogCleanup(); dialogCleanup = null; } $('dialog-body').replaceChildren(); $('prompt').focus(); });
window.addEventListener('beforeunload', () => { persistDraft(); source?.close(); });

async function boot() {
  document.documentElement.dataset.theme = store.get('theme') || 'dark';
  try {
    state.meta = await api('/_nullx/state');
    $('project-name').textContent = state.meta.project;
    $('breadcrumb-project').textContent = state.meta.project;
    $('project-short').textContent = state.meta.root;
    $('status-project').textContent = state.meta.project;
    $('version').textContent = `v${state.meta.version}`;
    const [, agents, commands, statuses, vcs] = await Promise.all([
      refreshProviders(), api('/agent'), api('/command'), api('/session/status'), api('/vcs').catch(() => null), refreshSessions(),
    ]);
    state.agents = agents; state.commands = commands; state.statuses = statuses || {};
    if (vcs?.branch) { $('branch').querySelector('span').textContent = vcs.branch; $('branch').title = vcs.branch; }
    state.loaded = true; state.online = true;
    connectEvents();
    await selectSession(new URL(location.href).searchParams.get('session'), { initial: true });
    updateControls();
  } catch (e) {
    state.online = false; updateControls();
    $('connection-banner').textContent = 'Could not connect to the engine. Check the server, then reload this page.';
    error(e);
  }
}
boot();
