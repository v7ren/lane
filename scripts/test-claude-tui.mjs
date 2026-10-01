import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createServer as createNetServer } from 'node:net';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const appRoot = `${root}/packages/app`;
let baseUrl = process.env.LOOMRIA_E2E_URL ?? '';
const paneId = 'claude-chat-e2e';
const activePaneId = 'spawned-claude-chat-e2e';
const companionId = 'claude-tui-e2e';
const assistantText = 'Earlier reply remains readable while Claude is rate limited.';
const terminalText = 'TUI RESUMED SESSION OUTPUT';

let server;
let browser;

async function waitForServer(url, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await delay(250);
  }
  throw new Error(`Vite did not become ready at ${url}`);
}

async function startServerIfNeeded() {
  if (process.env.LOOMRIA_E2E_URL) {
    await waitForServer(baseUrl);
    return;
  }

  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const viteCli = `${root}/node_modules/vite/bin/vite.js`;
  server = spawn(process.execPath, [viteCli, '--config', 'vite.config.ts', '--host', '127.0.0.1', '--port', port, '--strictPort'], {
    cwd: appRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, LOOMRIA_DEV_PORT: port },
  });
  server.stdout.on('data', (chunk) => process.stdout.write(chunk));
  server.stderr.on('data', (chunk) => process.stderr.write(chunk));
  server.once('exit', (code) => {
    if (code && code !== 0) console.error(`Vite exited with code ${code}`);
  });
  await waitForServer(baseUrl);
}

async function getFreePort() {
  const probe = createNetServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  if (!address || typeof address === 'string') {
    await new Promise((resolve) => probe.close(resolve));
    throw new Error('Could not reserve an available Vite port');
  }
  await new Promise((resolve) => probe.close(resolve));
  return String(address.port);
}

async function main() {
  await startServerIfNeeded();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const mockErrors = [];
  page.on('pageerror', (error) => mockErrors.push(error.message));

  await page.addInitScript(({ paneId, activePaneId, companionId, assistantText, terminalText, baseUrl }) => {
    let callbackId = 0;
    let nextPaneList = [
      {
        id: paneId,
        agent_type: 'claude',
        pid: 101,
        status: 'running',
        created_at: 1,
        last_output_at: Date.now(),
        cwd: 'C:/workspace',
        cols: 80,
        rows: 24,
        surface: 'headless',
      },
    ];
    const callbacks = new Map();
    const invokeCalls = [];
    const encode = (value) => Array.from(new TextEncoder().encode(value));
    const emit = (name, payload) => {
      for (const [key, entry] of callbacks) {
        if (entry.name === name) window[`_${entry.handler}`]?.({ event: name, id: key, payload });
      }
    };

    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback(callback, once = false) {
        callbackId += 1;
        const id = callbackId;
        window[`_${id}`] = (value) => {
          callback(value);
          if (once) Reflect.deleteProperty(window, `_${id}`);
        };
        return id;
      },
      unregisterCallback(id) {
        Reflect.deleteProperty(window, `_${id}`);
      },
      invoke(command, args = {}) {
        invokeCalls.push({ command, args });
        const payload = args?.args ?? args;
        switch (command) {
          case 'plugin:event|listen': {
            const id = callbackId++;
            callbacks.set(id, { name: args.event, handler: args.handler });
            return Promise.resolve(id);
          }
          case 'plugin:event|unlisten':
            callbacks.delete(args.eventId);
            return Promise.resolve(null);
          case 'plugin:store|load': return Promise.resolve(1);
          case 'plugin:store|get': return Promise.resolve([null, false]);
          case 'plugin:store|has': return Promise.resolve(false);
          case 'plugin:store|save':
          case 'plugin:store|set':
          case 'plugin:store|delete':
          case 'plugin:store|close': return Promise.resolve(null);
          case 'plugin:path|app_config_dir': return Promise.resolve('C:/mock-config');
          case 'plugin:path|resolve': return Promise.resolve(payload?.path ?? 'C:/mock-config');
          case 'list_panes': return Promise.resolve(nextPaneList);
          case 'list_agents': return Promise.resolve({ agents: [{ id: 'claude', label: 'Claude Code', description: 'Claude', icon: 'claude', is_tui: true, command: 'claude', base_args: [], show_in_new_pane_menu: true, default_worker: false }], report: { errors: [] } });
          case 'get_project_path_cmd':
          case 'get_persisted_project_path_cmd': return Promise.resolve('C:/workspace');
          case 'get_bridge_session': return Promise.resolve({ base_url: '', token: '' });
          case 'session_capabilities':
            return Promise.resolve({ chat: true, send_prompt: true, approvals: false, cancel: true, file_changes: false, attach_tui: false });
          case 'session_history':
            return Promise.resolve([{ pane_id: activePaneId, seq: 1, event: { type: 'message_completed', turn_id: 'turn-1', message_id: 'msg-1', role: 'assistant', text: assistantText } }]);
          case 'session_open_in_tui':
            nextPaneList = [...nextPaneList, {
              id: companionId,
              agent_type: 'claude',
              pid: 202,
              status: 'running',
              created_at: 2,
              last_output_at: Date.now(),
              cwd: 'C:/workspace',
              cols: 80,
              rows: 24,
              surface: 'tui',
            }];
            queueMicrotask(() => emit('pty://panes-changed', { changed: true }));
            return Promise.resolve(companionId);
          case 'spawn_pane': {
            const spawnedId = 'spawned-claude-chat-e2e';
            nextPaneList = [...nextPaneList, {
              id: spawnedId,
              agent_type: payload.agent_type ?? 'claude',
              pid: 303,
              status: 'running',
              created_at: 3,
              last_output_at: Date.now(),
              cwd: payload.cwd ?? 'C:/workspace',
              cols: payload.cols ?? 80,
              rows: payload.rows ?? 24,
              surface: payload.surface ?? 'headless',
            }];
            return Promise.resolve(spawnedId);
          }
          case 'read_pane_raw_buffer': return Promise.resolve([]);
          case 'read_pane_buffer': return Promise.resolve(terminalText);
          case 'read_pane_snapshot': return Promise.resolve('');
          case 'opencode_server_info': return Promise.resolve({ url_hidden: true, healthy: false, directory: 'C:/workspace' });
          case 'fs_list_dir': return Promise.resolve([]);
          case 'resize_pane':
          case 'fs_start_watcher':
          case 'sync_public_settings':
          case 'push_settings_event':
          case 'push_chat_event': return Promise.resolve(null);
          case 'write_pane_input': return Promise.reject(new Error('429 rate limit: Claude is temporarily unavailable'));
          case 'session_send_prompt':
            nextPaneList = nextPaneList.map((pane) => pane.id === activePaneId ? { ...pane, status: 'error' } : pane);
            emit('agent://event', { pane_id: activePaneId, seq: 2, event: { type: 'rate_limited', message: '429 rate limit: Claude is temporarily unavailable' } });
            emit('pty://status', { pane_id: activePaneId, status: 'error' });
            return Promise.reject(new Error('429 rate limit: Claude is temporarily unavailable'));
          case 'plugin:notification|is_permission_granted': return Promise.resolve(false);
          case 'plugin:notification|request_permission': return Promise.resolve('denied');
          default: return Promise.resolve(null);
        }
      },
      transformImage() { return null; },
      runCallback(id, data) { window[`_${id}`]?.(data); },
      async invokeTauriCallback(id, data) { window[`_${id}`]?.(data); },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener(name, id) {
        const entry = Array.from(callbacks.entries()).find(([, listener]) => listener.name === name && listener.handler === id);
        if (entry) callbacks.delete(entry[0]);
      },
    };

    window.__e2eTauri = {
      invokeCalls,
      emitTerminal() {
        emit('terminal-data', { pane_id: companionId, data: encode(`${terminalText}\r\n`) });
      },
      emitRateLimit() {
        nextPaneList = nextPaneList.map((pane) => pane.id === activePaneId ? { ...pane, status: 'error' } : pane);
        emit('agent://event', { pane_id: activePaneId, seq: 2, event: { type: 'rate_limited', message: '429 rate limit: Claude is temporarily unavailable' } });
        emit('pty://status', { pane_id: activePaneId, status: 'error' });
      },
    };
  }, { paneId, activePaneId, companionId, assistantText, terminalText, baseUrl });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('new-pane-button').click();
  await page.getByTestId('new-pane-menu').getByRole('button', { name: /Claude/ }).click();
  await page.getByText(assistantText, { exact: false }).waitFor({ state: 'visible', timeout: 45_000 });

  const showTui = page.getByRole('button', { name: 'Show TUI' });
  await showTui.waitFor({ state: 'visible' });
  await showTui.click();
  const companionColumn = page.locator(`[data-agent-tui-column="${activePaneId}"]`);
  const terminalHost = companionColumn.locator(`[data-terminal-host="${companionId}"]`);
  await terminalHost.waitFor({ state: 'visible', timeout: 20_000 });
  await terminalHost.locator('.xterm').waitFor({ state: 'attached', timeout: 15_000 });
  await page.evaluate(() => window.__e2eTauri.emitTerminal());
  await page.getByText(terminalText, { exact: false }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.evaluate(() => window.__e2eTauri.emitRateLimit());
  try {
    await page.getByText(/429 rate limit: Claude is temporarily unavailable/i).waitFor({ state: 'visible', timeout: 8_000 });
  } catch (error) {
    const pageText = await page.locator('body').innerText();
    const invokes = await page.evaluate(() => window.__e2eTauri.invokeCalls.filter(({ command }) => /session|pane/.test(command)));
    throw new Error(`${error.message}\nVisible page text:\n${pageText}\nTauri invokes:\n${JSON.stringify(invokes)}`);
  }
  await page.getByText(assistantText, { exact: false }).waitFor({ state: 'visible' });
  await page.getByText(terminalText, { exact: false }).waitFor({ state: 'visible' });
  await mkdir(path.dirname(path.join(root, 'docs', 'screenshots', 'claude-tui-regression.png')), { recursive: true });
  await page.screenshot({ path: path.join(root, 'docs', 'screenshots', 'claude-tui-regression.png'), fullPage: false });

  const terminalWrapper = terminalHost.locator('.xterm');
  await terminalWrapper.waitFor({ state: 'attached', timeout: 15_000 });
  const terminalWrapperHandle = await terminalWrapper.elementHandle();

  await page.getByRole('button', { name: 'Hide TUI' }).first().click();
  await page.waitForFunction((selector) => {
    const wrapper = document.querySelector(selector);
    return Boolean(wrapper?.isConnected && !wrapper.closest('[data-agent-tui-column]'));
  }, `#loomria-terminal-park [data-pane-terminal-wrapper="${companionId}"] .xterm`);
  await page.getByRole('button', { name: 'Show TUI' }).click();
  const reopenedHost = page.locator(`[data-agent-tui-column="${activePaneId}"] [data-terminal-host="${companionId}"]`);
  const reopenedTerminal = reopenedHost.locator('.xterm');
  await reopenedTerminal.waitFor({ state: 'attached', timeout: 15_000 });
  const reopenedHandle = await reopenedTerminal.elementHandle();
  if (await terminalWrapperHandle.evaluate((el) => !el.isConnected)) {
    throw new Error('The xterm wrapper was disposed while hiding the TUI');
  }
  if (await terminalWrapperHandle.evaluate((el, selector) => el !== document.querySelector(selector), `[data-agent-tui-column="${activePaneId}"] .xterm`)) {
    throw new Error('Reopening TUI created a new xterm wrapper instead of retaining the companion terminal');
  }
  if (!reopenedHandle) throw new Error('Reopened TUI has no xterm wrapper');
  await page.getByText(terminalText, { exact: false }).waitFor({ state: 'visible' });

  if (mockErrors.length) throw new Error(`Browser errors: ${mockErrors.join('\n')}`);
  console.log('PASS: Claude companion TUI mounts in its terminal host, terminal output and prior chat survive a rate-limit error, and hide/reopen retains xterm.');
}

try {
  await main();
} finally {
  await browser?.close();
  if (server && !server.killed) {
    server.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => server.once('exit', resolve)), delay(5000)]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
}
