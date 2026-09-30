import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OpenCodeRequestArgs } from '../../lib/opencode/client';
import { setOpenCodeTransport } from '../../lib/opencode/transport';
import { McpSection } from './McpSection';

type Status = Record<string, { status: string; error?: string }>;

let status: Status;
let calls: OpenCodeRequestArgs[];
let failNext: string | null;
let container: HTMLDivElement;
let root: Root;

function installTransport() {
  setOpenCodeTransport(async (args) => {
    calls.push(args);
    if (failNext && args.method !== 'GET') {
      const message = failNext;
      failNext = null;
      throw new Error(message);
    }
    if (args.method === 'GET' && args.path === '/mcp') return status;
    if (args.method === 'POST' && args.path === '/mcp') {
      const body = args.body as { name: string };
      status = { ...status, [body.name]: { status: 'connected' } };
      return status;
    }
    const disconnect = /^\/mcp\/([^/]+)\/disconnect$/.exec(args.path);
    if (args.method === 'POST' && disconnect) {
      status = { ...status, [disconnect[1]]: { status: 'disabled' } };
      return true;
    }
    const connect = /^\/mcp\/([^/]+)\/connect$/.exec(args.path);
    if (args.method === 'POST' && connect) {
      status = { ...status, [connect[1]]: { status: 'connected' } };
      return true;
    }
    throw new Error(`unexpected ${args.method} ${args.path}`);
  });
}

async function mount(paneId: string | null = 'pane-1') {
  root = createRoot(container);
  await act(async () => {
    root.render(<McpSection paneId={paneId} />);
  });
}

const q = <T extends Element>(sel: string) => container.querySelector(sel) as T;
const rowFor = (name: string) => q<HTMLElement>(`[data-mcp-name="${name}"]`);

async function typeInto(el: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submitAdd() {
  await act(async () => {
    q<HTMLFormElement>('[data-testid="mcp-add-form"]').requestSubmit();
  });
}

beforeEach(() => {
  status = { alpha: { status: 'connected' }, broken: { status: 'failed', error: 'spawn failed' } };
  calls = [];
  failNext = null;
  installTransport();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setOpenCodeTransport(null);
});

describe('McpSection', () => {
  it('asks for an OpenCode agent when there is no pane', async () => {
    await mount(null);
    expect(q('[data-testid="mcp-no-pane"]')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('lists servers with status and failure text', async () => {
    await mount();
    expect(rowFor('alpha').querySelector('[data-testid="mcp-status"]')?.textContent).toBe('Connected');
    expect(rowFor('broken').querySelector('[data-testid="mcp-status"]')?.textContent).toBe('Failed');
    expect(rowFor('broken').textContent).toContain('spawn failed');
  });

  it('adds a local server with a parsed command array', async () => {
    await mount();
    await typeInto(q<HTMLInputElement>('[data-testid="mcp-add-name"]'), 'fs');
    await typeInto(q<HTMLInputElement>('[data-testid="mcp-add-command"]'), 'npx -y "my srv"');
    await submitAdd();
    expect(calls.find((c) => c.method === 'POST')).toEqual({
      pane_id: 'pane-1',
      method: 'POST',
      path: '/mcp',
      body: { name: 'fs', config: { type: 'local', command: ['npx', '-y', 'my srv'], enabled: true } },
    });
    expect(rowFor('fs')).toBeTruthy();
    expect(q<HTMLInputElement>('[data-testid="mcp-add-name"]').value).toBe('');
  });

  it('adds a remote server via URL', async () => {
    await mount();
    await act(async () => {
      const select = q<HTMLSelectElement>('[data-testid="mcp-add-kind"]');
      select.value = 'remote';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await typeInto(q<HTMLInputElement>('[data-testid="mcp-add-name"]'), 'web');
    await typeInto(q<HTMLInputElement>('[data-testid="mcp-add-url"]'), 'https://x.test/mcp');
    await submitAdd();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'web',
      config: { type: 'remote', url: 'https://x.test/mcp', enabled: true },
    });
  });

  it('validates the form without calling the server', async () => {
    await mount();
    await submitAdd();
    expect(q('[data-testid="mcp-add-error"]').textContent).toContain('Name');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('shows the server error inline when add fails', async () => {
    await mount();
    failNext = 'HTTP 400 bad config';
    await typeInto(q<HTMLInputElement>('[data-testid="mcp-add-name"]'), 'fs');
    await typeInto(q<HTMLInputElement>('[data-testid="mcp-add-command"]'), 'npx x');
    await submitAdd();
    expect(q('[data-testid="mcp-add-error"]').textContent).toContain('HTTP 400');
    expect(container.querySelector('[data-mcp-name="fs"]')).toBeNull();
  });

  it('disconnects and reconnects a server', async () => {
    await mount();
    const toggle = () => rowFor('alpha').querySelector<HTMLButtonElement>('[data-testid="mcp-toggle"]')!;
    expect(toggle().textContent).toBe('Disconnect');
    await act(async () => toggle().click());
    expect(calls.some((c) => c.method === 'POST' && c.path === '/mcp/alpha/disconnect')).toBe(true);
    expect(rowFor('alpha').querySelector('[data-testid="mcp-status"]')?.textContent).toBe(
      'Disconnected',
    );
    expect(toggle().textContent).toBe('Connect');
    await act(async () => toggle().click());
    expect(calls.some((c) => c.method === 'POST' && c.path === '/mcp/alpha/connect')).toBe(true);
  });

  it('shows an inline error when disconnect fails', async () => {
    await mount();
    failNext = 'MCP server not found: alpha';
    await act(async () =>
      rowFor('alpha').querySelector<HTMLButtonElement>('[data-testid="mcp-toggle"]')!.click(),
    );
    expect(q('[data-testid="mcp-error"]').textContent).toContain('not found');
  });
});
