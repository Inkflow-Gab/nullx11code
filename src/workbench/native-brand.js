// Presentation-only branding for the complete native application. Never walk
// and replace arbitrary text nodes: conversations, code, provider names and
// tool output must retain their exact content and semantics.
const namespace = 'http://www.w3.org/2000/svg';
function wordmark(svg, compact) {
  if (svg.dataset.nullxBranded || svg.closest('pre, code, [data-component="markdown"], [data-component="message"]')) return;
  svg.dataset.nullxBranded = 'true';
  svg.setAttribute('viewBox', compact ? '0 0 56 56' : '0 0 350 72');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'nullx11code');
  const text = document.createElementNS(namespace, 'text');
  text.setAttribute('x', compact ? '4' : '3');
  text.setAttribute('y', compact ? '41' : '51');
  text.setAttribute('fill', 'currentColor');
  text.setAttribute('font-family', 'ui-monospace, SFMono-Regular, Consolas, monospace');
  text.setAttribute('font-size', compact ? '29' : '49');
  text.setAttribute('font-weight', '650');
  text.setAttribute('letter-spacing', '-3');
  text.textContent = compact ? 'n₁₁' : 'nullx11code';
  svg.replaceChildren(text);
}
function sync() {
  if (document.title === 'OpenCode') document.title = 'nullx11code — Advanced workspace';
  else if (document.title.endsWith(' | OpenCode')) document.title = document.title.slice(0, -11) + ' | nullx11code';
  for (const svg of document.querySelectorAll('svg[data-component="logo-mark"],svg[data-component="logo-splash"]')) wordmark(svg, true);
  // Exact viewBoxes from the pinned release's decorative Logo/WordmarkV2.
  for (const svg of document.querySelectorAll('svg[viewBox="0 0 234 42"], [data-component="session-new-design"] svg[viewBox="0 0 720 129"]')) wordmark(svg, false);
}
function start() {
  if (document.getElementById('nullx11-native-bar')) return;
  const bar = document.createElement('header');
  bar.id = 'nullx11-native-bar';
  bar.setAttribute('aria-label', 'nullx11code advanced workspace');
  const brand = document.createElement('a');
  brand.href = '/'; brand.className = 'nullx11-native-name'; brand.textContent = 'n₁₁  nullx11code';
  const label = document.createElement('span'); label.className = 'nullx11-native-mode'; label.textContent = 'ADVANCED WORKSPACE';
  const attribution = document.createElement('span'); attribution.className = 'nullx11-native-credit'; attribution.textContent = 'Powered by OpenCode · MIT';
  const back = document.createElement('a'); back.href = '/'; back.className = 'nullx11-native-back'; back.textContent = '← Focused workspace';
  // The native SPA delegates same-origin anchor clicks to its router. Leaving
  // for the separate focused app requires a document navigation, not an SPA
  // route change. Preserve browser modifier/new-tab behavior.
  for (const link of [brand, back]) link.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); event.stopPropagation();
    window.location.assign('/');
  });
  bar.append(brand, label, attribution, back);
  document.body.prepend(bar);
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; sync(); });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  sync();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
