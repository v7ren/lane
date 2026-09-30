import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OpenCodeRequestArgs } from '../../lib/opencode/client';
import { getUserPickedSessionModel } from '../../lib/opencode/session-model-prefs';
import { setOpenCodeTransport } from '../../lib/opencode/transport';
import { ProvidersSection } from './ProvidersSection';

const FAKE_KEY = 'FAKE-TEST-VALUE-123';

const providers = {
  all: [
    { id: 'alpha', name: 'Alpha', models: { 'a-1': { id: 'a-1', name: 'Alpha One' } } },
    {
      id: 'beta',
      name: 'Beta',
      models: { 'b-1': { id: 'b-1', name: 'Beta One' }, 'b-2': { id: 'b-2', name: 'Beta Two' } },
    },
    { id: 'gamma', name: 'Gamma', models: {} },
  ],
  default: {},
  connected: ['alpha'],
};
const providerAuth = { gamma: [{ type: 'oauth', label: 'Login' }] };

let calls: OpenCodeRequestArgs[];
let putBehavior: () => unknown;
let container: HTMLDivElement;
let root: Root;

function installTransport() {
  setOpenCodeTransport(async (args) => {
    calls.push(args);
    if (args.method === 'GET' && args.path === '/provider') return providers;
    if (args.method === 'GET' && args.path === '/provider/auth') return providerAuth;
    if (args.method === 'PUT') return putBehavior();
    throw new Error(`unexpected ${args.method} ${args.path}`);
  });
}

async function mount(paneId: string | null = 'pane-1', sessionId: string | null = 'sess-1') {
  root = createRoot(container);
  await act(async () => {
    root.render(<ProvidersSection paneId={paneId} sessionId={sessionId} />);
  });
}

const q = <T extends Element>(sel: string) => container.querySelector(sel) as T;
const rowFor = (id: string) => q<HTMLElement>(`[data-provider-id="${id}"]`);

async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

async function typeInto(el: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  calls = [];
  putBehavior = () => true;
  localStorage.clear();
  installTransport();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setOpenCodeTransport(null);
});

describe('ProvidersSection', () => {
  it('asks for an OpenCode agent when there is no pane', async () => {
    await mount(null, null);
    expect(q('[data-testid="providers-no-pane"]')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('lists providers with connected state and model counts, connected first', async () => {
    await mount();
    const ids = Array.from(container.querySelectorAll('[data-testid="provider-row"]')).map((el) =>
      el.getAttribute('data-provider-id'),
    );
    expect(ids).toEqual(['alpha', 'beta', 'gamma']);
    expect(rowFor('alpha').textContent).toContain('Connected');
    expect(rowFor('alpha').textContent).toContain('1 models');
    expect(rowFor('beta').textContent).toContain('Not connected');
    expect(rowFor('beta').textContent).toContain('2 models');
  });

  it('filters providers by search', async () => {
    await mount();
    await typeInto(q<HTMLInputElement>('[data-testid="providers-search"]'), 'bet');
    expect(container.querySelectorAll('[data-testid="provider-row"]')).toHaveLength(1);
  });

  it('shows a password input and never renders the key; clears it on submit', async () => {
    await mount();
    await click(rowFor('beta').querySelector('[data-testid="provider-toggle"]')!);
    const input = q<HTMLInputElement>('[data-testid="provider-api-key-input"]');
    expect(input.type).toBe('password');
    await typeInto(input, FAKE_KEY);
    await act(async () => {
      q<HTMLFormElement>('form').requestSubmit();
    });
    const put = calls.find((c) => c.method === 'PUT');
    expect(put).toEqual({
      pane_id: 'pane-1',
      method: 'PUT',
      path: '/auth/beta',
      body: { type: 'api', key: FAKE_KEY },
    });
    expect(q('[data-testid="provider-success"]')).toBeTruthy();
    expect(q<HTMLInputElement>('[data-testid="provider-api-key-input"]').value).toBe('');
    expect(container.innerHTML).not.toContain(FAKE_KEY);
    // The list is reloaded after a successful save.
    expect(calls.filter((c) => c.path === '/provider').length).toBeGreaterThanOrEqual(2);
  });

  it('shows the error inline and redacts the key if the server echoes it', async () => {
    putBehavior = () => {
      throw new Error(`HTTP 400 rejected ${FAKE_KEY}`);
    };
    await mount();
    await click(rowFor('beta').querySelector('[data-testid="provider-toggle"]')!);
    await typeInto(q<HTMLInputElement>('[data-testid="provider-api-key-input"]'), FAKE_KEY);
    await act(async () => {
      q<HTMLFormElement>('form').requestSubmit();
    });
    const err = q('[data-testid="provider-error"]');
    expect(err.textContent).toContain('HTTP 400');
    expect(container.innerHTML).not.toContain(FAKE_KEY);
    expect(q('[data-testid="provider-success"]')).toBeNull();
  });

  it('offers no key form for oauth-only providers', async () => {
    await mount();
    await click(rowFor('gamma').querySelector('[data-testid="provider-toggle"]')!);
    expect(q('[data-testid="provider-api-key-input"]')).toBeNull();
    expect(q('[data-testid="provider-not-connectable"]').textContent).toContain('OAuth');
  });

  it('"Use this model" stores the explicit pick for the session', async () => {
    await mount();
    await click(rowFor('alpha').querySelector('[data-testid="provider-toggle"]')!);
    const buttons = container.querySelectorAll('[data-testid="provider-use-model"]');
    expect(buttons).toHaveLength(1);
    await click(buttons[0]);
    expect(getUserPickedSessionModel('pane-1', 'sess-1')).toEqual({
      providerID: 'alpha',
      modelID: 'a-1',
      userPicked: true,
    });
    expect(q('[data-testid="provider-model-picked"]')).toBeTruthy();
  });

  it('disables "Use this model" without a session and filters the model list', async () => {
    await mount('pane-1', null);
    await click(rowFor('alpha').querySelector('[data-testid="provider-toggle"]')!);
    expect(q('[data-testid="provider-no-session"]')).toBeTruthy();
    expect(q<HTMLButtonElement>('[data-testid="provider-use-model"]').disabled).toBe(true);
    await typeInto(q<HTMLInputElement>('[data-testid="provider-model-search"]'), 'zzz');
    expect(container.querySelectorAll('[data-testid="provider-model-row"]')).toHaveLength(0);
  });
});
