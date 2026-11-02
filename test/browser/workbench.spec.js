import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startWorkbench } from '../../src/workbench-server.js';

let root;
let app;
let mock;
let offeredTool = false;
const errors = [];

test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nullx11-browser-'));
  fs.writeFileSync(path.join(root, 'README.md'), '# Browser test project\nReal file context.\n');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/hello.js'), 'export const hello = "world";\n');
  mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const input = JSON.parse(body || '{}');
      const hasTools = input.tools?.some((tool) => tool.function?.name === 'bash');
      const content = '## All set\n\nYour approved tool ran successfully.\n\n```js\nconsole.log("working");\n```\n\n<img src="x" onerror="window.pwned=true">';
      const base = { id: 'chatcmpl-ui', object: 'chat.completion.chunk', created: 1700000000, model: 'test-model' };
      if (hasTools && !offeredTool) {
        offeredTool = true;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_proof', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: "printf 'approved' > agent-proof.txt", description: 'Create an approved proof file' }) } }] }, finish_reason: null }] })}\n\n`);
        res.end(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`);
      } else if (!input.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ...base, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: hasTools ? content : 'Browser test' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 12, total_tokens: 32 } }));
      } else {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: hasTools ? content : 'Browser test' }, finish_reason: null }] })}\n\n`);
        res.end(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 12, total_tokens: 32 } })}\n\ndata: [DONE]\n\n`);
      }
    });
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env, HOME: root, NULLX11_HOME: path.join(root, 'home'), XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'data'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_STATE_HOME: path.join(root, 'state'), OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true' };
  for (const key of ['OPENCODE_CONFIG_CONTENT', 'OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR', 'OPENCODE_SERVER_PASSWORD']) delete env[key];
  app = await startWorkbench({
    port: 0, host: '127.0.0.1', cwd: root, env, runtimeArgs: ['--pure'],
    cfg: { _root: root, _env: {}, provider: 'mock', model: 'test-model', skills: { dirs: [], enabled: [] }, permissions: { default: 'ask', rules: [] }, providers: { mock: { baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, apiKey: 'test-browser-key', models: ['test-model'] } } },
  });
});

test.afterAll(async () => {
  await app?.close();
  if (mock) { mock.closeAllConnections(); await new Promise((resolve) => mock.close(resolve)); }
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

test('branded workspace: file context, streaming, real approval, safe Markdown and session actions', async ({ page }, testInfo) => {
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(app.url);
  await expect(page.getByRole('heading', { name: 'What are we building?' })).toBeVisible();
  await expect(page.getByText('Engine connected', { exact: true })).toBeVisible();
  await expect(page.locator('[data-file-path="README.md"]')).toBeVisible();
  await expect(page.locator('#model-label')).toHaveText('test-model');
  await page.screenshot({ path: testInfo.outputPath('workspace-desktop.png') });
  await page.locator('[data-file-path="src/"]').click();
  await expect(page.locator('[data-file-path="src/hello.js"]')).toBeVisible();
  await page.getByRole('button', { name: '↑ parent' }).click();
  await page.locator('[data-file-path="README.md"]').click();
  await expect(page.locator('.file-preview')).toContainText('Real file context');
  await page.getByRole('button', { name: 'Add to context' }).click();
  await expect(page.locator('#attachments')).toContainText('README.md');
  await page.locator('#prompt').fill('Create the proof file after asking for my approval.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toBeVisible({ timeout: 30000 });
  expect(fs.existsSync(path.join(root, 'agent-proof.txt'))).toBe(false);
  await page.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect(page.locator('.markdown').getByRole('heading', { name: 'All set' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Engine connected', { exact: true })).toBeVisible();
  expect(fs.readFileSync(path.join(root, 'agent-proof.txt'), 'utf8')).toBe('approved');
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
  expect(await page.locator('.markdown [onerror]').count()).toBe(0);
  await expect(page.locator('.markdown code')).toContainText('console.log');
  await expect(page.locator('.tool-call')).toBeVisible();
  await page.getByRole('button', { name: 'Session actions', exact: true }).click();
  await page.getByRole('button', { name: 'Rename session', exact: true }).click();
  await page.locator('#rename-title').fill('Approved build');
  await page.getByRole('button', { name: 'Save title', exact: true }).click();
  await expect(page.locator('#session-title')).toHaveText('Approved build');
  const sessionURL = page.url();
  await page.reload();
  await expect(page.locator('#session-title')).toHaveText('Approved build');
  await expect(page.getByRole('heading', { name: 'All set' })).toBeVisible();
  await expect(page.locator('#messages')).not.toContainText('Called the Read tool');
  await page.getByRole('button', { name: 'Session actions', exact: true }).click();
  await page.getByRole('button', { name: 'Undo last turn', exact: false }).click();
  await expect(page.locator('.revert-notice')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'All set' })).not.toBeVisible();
  await page.getByRole('button', { name: 'Restore reverted turn', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'All set' })).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('#dialog-search').fill('Approved');
  await expect(page.locator('#dialog-results')).toContainText('Approved build');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Session actions', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export conversation', exact: false }).click();
  expect((await download).suggestedFilename()).toMatch(/nullx11code-ses.*\.md/);
  expect(page.url()).toBe(sessionURL);
  await page.screenshot({ path: testInfo.outputPath('workspace-conversation.png') });
  expect(errors).toEqual([]);
});

test('search, theme, native escape hatch, keyboard and responsive mobile layout', async ({ page }, testInfo) => {
  await page.goto(app.url);
  await expect(page.locator('[data-file-path="README.md"]')).toBeVisible();
  await page.locator('[data-action="models"]').click();
  await page.locator('#dialog-search').fill('test-model');
  await expect(page.locator('[data-model-id="test-model"]')).toBeVisible();
  await page.locator('[data-model-id="test-model"]').click();
  await page.locator('[data-prompt]').first().click();
  await expect(page.locator('#prompt')).toHaveValue(/Explore this project/);
  await page.keyboard.press('Control+k');
  await page.locator('#dialog-search').fill('theme');
  await page.getByRole('button', { name: 'Toggle theme', exact: false }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Toggle sidebar', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.getByRole('button', { name: 'New session', exact: false }).click();
  await expect(page.locator('.sidebar')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'What are we building?' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('workspace-mobile.png') });
  await page.getByRole('button', { name: 'Toggle workspace panel', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open advanced workspace' })).toBeVisible();
  expect(await page.getByRole('link', { name: 'Open advanced workspace' }).getAttribute('href')).toBe('/?experience=advanced');
  await page.getByRole('link', { name: 'Open advanced workspace' }).click();
  await expect(page.locator('#nullx11-native-bar')).toBeVisible();
  await expect(page).toHaveTitle(/nullx11code/);
  await expect(page.getByText('Projects', { exact: true }).first()).toBeVisible();
});

test('provider onboarding stores a key on the engine, never in browser storage', async ({ page }) => {
  await page.goto(app.url);
  await expect(page.getByText('Engine connected', { exact: true })).toBeVisible();
  await page.locator('[data-action="connect"]').first().click();
  await page.locator('#dialog-search').fill('Groq');
  await page.locator('[data-connect-provider="groq"]').click();
  await page.locator('#provider-key').fill('gsk_test_only_not_a_real_key');
  await page.getByRole('button', { name: 'Save key & connect' }).click();
  await expect(page.getByRole('heading', { name: 'Choose your model' })).toBeVisible();
  await page.locator('#dialog-search').fill('groq');
  await expect(page.locator('#dialog-results')).toContainText('Groq');
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(stored).not.toContain('gsk_test_only_not_a_real_key');
  const auth = JSON.parse(fs.readFileSync(path.join(root, 'data/opencode/auth.json'), 'utf8'));
  expect(auth.groq.key).toBe('gsk_test_only_not_a_real_key');
  expect(fs.existsSync(path.join(root, '.env'))).toBe(false);
});
