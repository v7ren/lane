import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OpenCodeRequestArgs } from '../../lib/opencode/client';
import { setOpenCodeTransport } from '../../lib/opencode/transport';
import { ConfigSection } from './ConfigSection';

let config: Record<string, unknown>;
let calls: OpenCodeRequestArgs[];
let patchFailure: string | null;
let container: HTMLDivElement;
let root: Root;

function installTransport() {
  setOpenCodeTransport(async (args) => {
    calls.push(args);
    if (args.method === 'GET' && args.path === '/config') return config;
    if (args.method === 'PATCH' && args.path === '/config') {
      if (patchFailure) throw new Error(patchFailure);
      config = { ...config, ...(args.body as Record<string, unknown>) };
      return config;
    }
    throw new Error(`unexpected ${args.method} ${args.path}`);
  });
}

async function mount(paneId: string | null = 'pane-1') {
  root = createRoot(container);
  await act(async () => {
    root.render(<ConfigSection paneId={paneId} />);
  });
}

const q = <T extends Element>(sel: string) => container.querySelector(sel) as T;
const patches = () => calls.filter((c) => c.method === 'PATCH');

async function typeInto(el: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function choose(el: HTMLSelectElement, value: string) {
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function submit() {
  await act(async () => {
    q<HTMLFormElement>('[data-testid="config-form"]').requestSubmit();
  });
}

beforeEach(() => {
  config = { model: 'alpha/a-1', share: 'manual', username: 'someone', mcp: { x: {} } };
  calls = [];
  patchFailure = null;
  installTransport();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setOpenCodeTransport(null);
});

describe('ConfigSection', () => {
  it('asks for an OpenCode agent when there is no pane', async () => {
    await mount(null);
    expect(q('[data-testid="config-no-pane"]')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('loads config values into the form and keeps save disabled until edited', async () => {
    await mount();
    expect(q<HTMLInputElement>('[data-testid="config-model"]').value).toBe('alpha/a-1');
    expect(q<HTMLSelectElement>('[data-testid="config-share"]').value).toBe('manual');
    expect(q<HTMLSelectElement>('[data-testid="config-autoupdate"]').value).toBe('');
    expect(q<HTMLButtonElement>('[data-testid="config-save"]').disabled).toBe(true);
  });

  it('PATCHes only the changed fields, then re-reads', async () => {
    await mount();
    await choose(q<HTMLSelectElement>('[data-testid="config-autoupdate"]'), 'notify');
    await typeInto(q<HTMLInputElement>('[data-testid="config-small-model"]'), 'beta/b-1');
    await submit();
    expect(patches()).toEqual([
      {
        pane_id: 'pane-1',
        method: 'PATCH',
        path: '/config',
        body: { small_model: 'beta/b-1', autoupdate: 'notify' },
      },
    ]);
    expect(q('[data-testid="config-saved"]')).toBeTruthy();
    expect(q<HTMLButtonElement>('[data-testid="config-save"]').disabled).toBe(true);
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2);
  });

  it('blocks invalid model refs without calling the server', async () => {
    await mount();
    await typeInto(q<HTMLInputElement>('[data-testid="config-model"]'), 'nomodel');
    expect(q('[data-testid="config-model-error"]').textContent).toContain('provider/model');
    expect(q<HTMLButtonElement>('[data-testid="config-save"]').disabled).toBe(true);
    await submit();
    expect(patches()).toHaveLength(0);
  });

  it('shows a server rejection inline and keeps the draft', async () => {
    await mount();
    patchFailure = 'HTTP 400 Expected manual | auto | disabled';
    await choose(q<HTMLSelectElement>('[data-testid="config-share"]'), 'auto');
    await submit();
    expect(q('[data-testid="config-error"]').textContent).toContain('HTTP 400');
    expect(q<HTMLSelectElement>('[data-testid="config-share"]').value).toBe('auto');
    expect(q('[data-testid="config-saved"]')).toBeNull();
  });
});
