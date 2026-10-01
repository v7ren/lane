import { beforeEach, describe, expect, it } from 'vitest';
import {
  canResumeClaudeSession,
  getTuiSyncedTurns,
  tuiNeedsSync,
  clearTuiCompanion,
  companionPaneIds,
  getTuiCompanion,
  resetTuiCompanionsForTests,
  setTuiCompanion,
  tuiPaneIdFor,
} from './tui-companions';

describe('tui companions', () => {
  beforeEach(() => resetTuiCompanionsForTests());

  it('maps a chat pane to its terminal pane and falls back to itself', () => {
    expect(getTuiCompanion('chat-1')).toBeUndefined();
    setTuiCompanion('chat-1', 'tui-1');
    expect(getTuiCompanion('chat-1')).toBe('tui-1');
    expect(tuiPaneIdFor('chat-1', { 'chat-1': 'tui-1' })).toBe('tui-1');
    expect(tuiPaneIdFor('other', { 'chat-1': 'tui-1' })).toBe('other');
  });

  it('lists companion pane ids so they can be hidden from the sidebar', () => {
    expect([...companionPaneIds({ a: 'x', b: 'y' })].sort()).toEqual(['x', 'y']);
  });

  it('remembers how many assistant turns the terminal loaded, until it is replaced or cleared', () => {
    setTuiCompanion('chat-1', 'tui-1');
    expect(getTuiSyncedTurns('chat-1')).toBe(0);
    setTuiCompanion('chat-1', 'tui-2', 3);
    expect(getTuiSyncedTurns('chat-1')).toBe(3);
    clearTuiCompanion('chat-1');
    expect(getTuiSyncedTurns('chat-1')).toBe(0);
  });

  it('needs a sync after every new finished reply, not just the first', () => {
    const turns = (n: number) =>
      Array.from({ length: n }, () => [{ role: 'user' }, { role: 'assistant' }]).flat();
    expect(tuiNeedsSync(turns(1), 'done', 0)).toBe(true);
    expect(tuiNeedsSync(turns(1), 'done', 1)).toBe(false);
    expect(tuiNeedsSync(turns(2), 'done', 1)).toBe(true);
    expect(tuiNeedsSync(turns(2), 'working', 1)).toBe(false);
    expect(tuiNeedsSync(turns(2), 'idle', 2)).toBe(false);
  });

  it('can resume only once the chat has a finished assistant reply', () => {
    const user = { role: 'user' };
    const assistant = { role: 'assistant' };
    expect(canResumeClaudeSession([], 'idle')).toBe(false);
    expect(canResumeClaudeSession([user], 'working')).toBe(false);
    expect(canResumeClaudeSession([user, assistant], 'working')).toBe(false);
    expect(canResumeClaudeSession([user, assistant], 'done')).toBe(true);
    expect(canResumeClaudeSession([user, assistant], 'idle')).toBe(true);
  });

  it('clearing returns the terminal pane to close, once', () => {
    setTuiCompanion('chat-1', 'tui-1');
    expect(clearTuiCompanion('chat-1')).toBe('tui-1');
    expect(clearTuiCompanion('chat-1')).toBeUndefined();
    expect(getTuiCompanion('chat-1')).toBeUndefined();
  });
});
