import { describe, expect, it } from 'vitest';
import { decideSessionNotification } from './session-notify-decision';

describe('decideSessionNotification', () => {
  const base = {
    paneId: 'pane-demo-1',
    previousState: 'working',
    nextState: 'needs_approval',
    muted: false,
    mode: 'workspace' as const,
    focusedPaneId: null as string | null,
    windowFocused: true,
  };

  it('does not notify when session is muted', () => {
    const d = decideSessionNotification({ ...base, muted: true });
    expect(d.notify).toBe(false);
    if (!d.notify) expect(d.reason).toBe('muted');
  });

  it('does not notify when agent session is focused and window is focused', () => {
    const d = decideSessionNotification({
      ...base,
      mode: 'agent',
      focusedPaneId: 'pane-demo-1',
      windowFocused: true,
    });
    expect(d.notify).toBe(false);
    if (!d.notify) expect(d.reason).toBe('focused_agent_session');
  });

  it('notifies once on transition into needs_approval', () => {
    const d = decideSessionNotification({ ...base, nextState: 'needs_approval' });
    expect(d.notify).toBe(true);
    if (d.notify) {
      expect(d.title).toBe('Approval needed');
    }
  });

  it('notifies once on transition into done', () => {
    const d = decideSessionNotification({
      ...base,
      previousState: 'working',
      nextState: 'done',
    });
    expect(d.notify).toBe(true);
    if (d.notify) expect(d.title).toBe('Session finished');
  });

  it('does not re-notify when state is unchanged', () => {
    const d = decideSessionNotification({
      ...base,
      previousState: 'needs_approval',
      nextState: 'needs_approval',
    });
    expect(d.notify).toBe(false);
    if (!d.notify) expect(d.reason).toBe('unchanged_state');
  });
});

describe('decideSessionNotification replayed', () => {
  it('never notifies for replayed history', () => {
    const d = decideSessionNotification({
      paneId: 'p',
      previousState: 'working',
      nextState: 'done',
      muted: false,
      mode: 'workspace',
      focusedPaneId: null,
      windowFocused: false,
      replayed: true,
    });
    expect(d.notify).toBe(false);
    if (!d.notify) expect(d.reason).toBe('replayed');
  });
});
