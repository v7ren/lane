import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDraft, setDraft, clearDraft } from './composer-drafts';

describe('composer-drafts', () => {
  const paneId = 'test-pane-123';
  const storageKey = `loomria-draft:${paneId}`;

  beforeEach(() => {
    // Clear sessionStorage before each test
    localStorage.clear();
    sessionStorage.clear();
    // Clear the module-level draft store by clearing this pane's draft
    clearDraft(paneId);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    localStorage.clear();
    sessionStorage.clear();
    clearDraft(paneId);
  });

  describe('getDraft', () => {
    it('returns empty string when no draft exists', () => {
      const draft = getDraft(paneId);
      expect(draft).toBe('');
    });

    it('returns draft from memory after setDraft', () => {
      setDraft(paneId, 'hello world');
      expect(getDraft(paneId)).toBe('hello world');
    });

    it('returns draft from sessionStorage on first call', () => {
      sessionStorage.setItem(storageKey, 'stored text');
      const draft = getDraft(paneId);
      expect(draft).toBe('stored text');
    });

    it('prefers memory over sessionStorage', () => {
      sessionStorage.setItem(storageKey, 'old text');
      setDraft(paneId, 'new text');
      expect(getDraft(paneId)).toBe('new text');
    });
  });

  describe('setDraft', () => {
    it('updates memory immediately', () => {
      setDraft(paneId, 'test');
      expect(getDraft(paneId)).toBe('test');
    });

    it('writes to sessionStorage after 300ms debounce', () => {
      setDraft(paneId, 'first');
      expect(sessionStorage.getItem(storageKey)).toBeNull();

      vi.advanceTimersByTime(300);
      expect(sessionStorage.getItem(storageKey)).toBe('first');
    });

    it('debounces multiple writes', () => {
      setDraft(paneId, 'a');
      vi.advanceTimersByTime(100);
      setDraft(paneId, 'ab');
      vi.advanceTimersByTime(100);
      setDraft(paneId, 'abc');

      // Only 100ms passed, not 300ms total
      expect(sessionStorage.getItem(storageKey)).toBeNull();

      vi.advanceTimersByTime(300);
      // Now 300ms have passed since the last setDraft
      expect(sessionStorage.getItem(storageKey)).toBe('abc');
    });

    it('clears sessionStorage when setting empty string after delay', () => {
      sessionStorage.setItem(storageKey, 'text');
      setDraft(paneId, '');

      vi.advanceTimersByTime(300);
      expect(sessionStorage.getItem(storageKey)).toBeNull();
    });
  });

  describe('clearDraft', () => {
    it('removes draft from memory', () => {
      setDraft(paneId, 'text');
      clearDraft(paneId);
      expect(getDraft(paneId)).toBe('');
    });

    it('removes draft from sessionStorage immediately', () => {
      sessionStorage.setItem(storageKey, 'text');
      clearDraft(paneId);
      expect(sessionStorage.getItem(storageKey)).toBeNull();
    });

    it('cancels pending debounce', () => {
      setDraft(paneId, 'text');
      clearDraft(paneId);

      vi.advanceTimersByTime(300);
      // The debounced write should not happen
      expect(sessionStorage.getItem(storageKey)).toBeNull();
    });
  });

  describe('round-trip scenario', () => {
    it('preserves draft across component mount/unmount', () => {
      // Simulate: component mounts, user types, component unmounts
      setDraft(paneId, 'hello world');
      vi.advanceTimersByTime(300);

      // Simulate: component remounts with new instance
      const retrieved = getDraft(paneId);
      expect(retrieved).toBe('hello world');
    });

    it('clears on send', () => {
      setDraft(paneId, 'send this');
      vi.advanceTimersByTime(300);
      expect(sessionStorage.getItem(storageKey)).toBe('send this');

      clearDraft(paneId);
      expect(sessionStorage.getItem(storageKey)).toBeNull();
      expect(getDraft(paneId)).toBe('');
    });
  });
});
