import { beforeEach, describe, expect, it } from 'vitest';
import {
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

  it('clearing returns the terminal pane to close, once', () => {
    setTuiCompanion('chat-1', 'tui-1');
    expect(clearTuiCompanion('chat-1')).toBe('tui-1');
    expect(clearTuiCompanion('chat-1')).toBeUndefined();
    expect(getTuiCompanion('chat-1')).toBeUndefined();
  });
});
