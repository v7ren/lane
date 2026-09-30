import { describe, expect, it } from 'vitest';
import { effectivePaneStatus, mergePaneAndSessionStatus } from './display-status';

describe('effectivePaneStatus', () => {
  it('drops the always-on running status of a headless pane', () => {
    expect(effectivePaneStatus('running', 'headless')).toBeUndefined();
  });

  it('keeps running for terminal panes', () => {
    expect(effectivePaneStatus('running', 'tui')).toBe('running');
    expect(effectivePaneStatus('running', undefined)).toBe('running');
  });

  it('keeps errors and waiting for headless panes', () => {
    expect(effectivePaneStatus('error', 'headless')).toBe('error');
    expect(effectivePaneStatus('waiting_input', 'headless')).toBe('waiting_input');
  });
});

describe('headless chat pane status follows the session state', () => {
  const headless = (session: string | null) =>
    mergePaneAndSessionStatus(effectivePaneStatus('running', 'headless'), session);

  it('is working while a turn is active and done/idle after it completes', () => {
    expect(headless('working')).toBe('working');
    expect(headless('done')).toBe('done');
    expect(headless('idle')).toBe('idle');
  });

  it('a terminal pane that is running still shows working', () => {
    expect(mergePaneAndSessionStatus(effectivePaneStatus('running', 'tui'), 'done')).toBe('working');
  });
});
