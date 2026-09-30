import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: { type: string; data: unknown }) => void;
let push: Handler | null = null;

vi.mock('../lib/bridge-auth', () => ({
  loadBridgeSession: vi.fn().mockResolvedValue({ baseUrl: 'http://127.0.0.1:1' }),
}));
vi.mock('../lib/bridge', () => ({
  findBridgeUrl: vi.fn().mockResolvedValue('http://127.0.0.1:1'),
  subscribeBridgeEvents: vi.fn((_url: string, handler: Handler) => {
    push = handler;
    return () => {
      push = null;
    };
  }),
}));

import { resetSessionRailForTests, useSessionRail } from './useSessionRail';

function Probe({ id }: { id: string }) {
  const states = useSessionRail();
  return <span data-testid={id}>{states.get('p1')?.state ?? 'none'}</span>;
}

let container: HTMLDivElement;
let roots: Root[] = [];

function mount(node: React.ReactNode): HTMLDivElement {
  const host = document.createElement('div');
  container.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

beforeEach(() => {
  resetSessionRailForTests();
  push = null;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots = [];
  container.remove();
});

describe('useSessionRail', () => {
  it('shares one state across callers, including ones mounted after the event', async () => {
    const early = mount(<Probe id="early" />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(push).not.toBeNull();

    act(() =>
      push!({ type: 'session_state', data: { pane_id: 'p1', state: 'done', updated_at_ms: 1 } }),
    );
    expect(early.textContent).toBe('done');

    // A component that mounts after the event still sees it (this used to show "none").
    const late = mount(<Probe id="late" />);
    expect(late.textContent).toBe('done');
  });

  it('ignores unrelated events', async () => {
    const host = mount(<Probe id="a" />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => push!({ type: 'other', data: { pane_id: 'p1', state: 'working' } }));
    expect(host.textContent).toBe('none');
  });
});
