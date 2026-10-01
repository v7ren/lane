import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { clearLocalNotice, pushLocalNotice, useLocalNotices } from './local-notices';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function renderNoticeStore(
  paneId: string,
  onSnapshot: (snapshot: ReturnType<typeof useLocalNotices>) => void,
): () => void {
  function Host() {
    onSnapshot(useLocalNotices(paneId));
    return null;
  }

  host = document.createElement('div');
  root = createRoot(host);
  const rerender = () => act(() => root?.render(createElement(Host)));
  rerender();
  return rerender;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host = null;
});

describe('local notices', () => {
  it('publishes pushes and clears through a stable external-store snapshot', () => {
    const paneId = 'notice-store-push-subscribe';
    const snapshots: ReturnType<typeof useLocalNotices>[] = [];
    const rerender = renderNoticeStore(paneId, (snapshot) => snapshots.push(snapshot));

    const initialSnapshot = snapshots.at(-1);
    expect(initialSnapshot).toEqual([]);

    // A parent render with no store update must keep the same snapshot identity.
    rerender();
    expect(snapshots.at(-1)).toBe(initialSnapshot);

    let id = '';
    act(() => {
      id = pushLocalNotice(paneId, {
        level: 'info',
        text: 'Local result',
        afterTurnId: 'turn-1',
      });
    });
    expect(snapshots.at(-1)).toEqual([
      { id, level: 'info', text: 'Local result', afterTurnId: 'turn-1' },
    ]);
    expect(snapshots.at(-1)).not.toBe(initialSnapshot);
    expect(Object.isFrozen(snapshots.at(-1))).toBe(true);
    expect(Object.isFrozen(snapshots.at(-1)?.[0])).toBe(true);

    act(() => clearLocalNotice(paneId, id));
    expect(snapshots.at(-1)).toEqual([]);
    expect(snapshots.at(-1)).toBe(initialSnapshot);
  });

  it('isolates notices by pane and preserves insertion order', () => {
    const paneId = 'notice-store-pane-a';
    const otherPaneId = 'notice-store-pane-b';
    const snapshots: ReturnType<typeof useLocalNotices>[] = [];
    renderNoticeStore(paneId, (snapshot) => snapshots.push(snapshot));

    act(() => {
      pushLocalNotice(paneId, { level: 'warning', text: 'First' });
      pushLocalNotice(paneId, { level: 'error', text: 'Second' });
      pushLocalNotice(otherPaneId, { level: 'info', text: 'Other pane' });
    });

    expect(snapshots.at(-1)).toMatchObject([
      { level: 'warning', text: 'First' },
      { level: 'error', text: 'Second' },
    ]);
  });
});
