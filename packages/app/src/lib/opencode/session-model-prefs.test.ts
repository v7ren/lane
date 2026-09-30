import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getUserPickedSessionModel,
  SESSION_MODEL_CHANGED_EVENT,
  setSessionComposerModel,
} from './session-model-prefs';

describe('setSessionComposerModel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores the pick as user-picked', () => {
    setSessionComposerModel('pane-1', 'sess-1', { providerID: 'p', modelID: 'm' });
    expect(getUserPickedSessionModel('pane-1', 'sess-1')).toEqual({
      providerID: 'p',
      modelID: 'm',
      userPicked: true,
    });
    expect(getUserPickedSessionModel('pane-1', 'other')).toBeNull();
  });

  it('announces the change so an open composer can re-render', () => {
    const listener = vi.fn();
    window.addEventListener(SESSION_MODEL_CHANGED_EVENT, listener);
    setSessionComposerModel('pane-1', 'sess-1', { providerID: 'p', modelID: 'm' });
    window.removeEventListener(SESSION_MODEL_CHANGED_EVENT, listener);
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toEqual({ paneId: 'pane-1', sessionId: 'sess-1' });
  });
});
