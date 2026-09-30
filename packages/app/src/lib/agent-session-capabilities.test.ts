import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveAgentSessionOnCapabilitiesError } from './agent-session-capabilities';

describe('resolveAgentSessionOnCapabilitiesError', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    warnSpy?.mockRestore();
  });

  it('opencode_native + command missing -> fallback, error null, no console.warn', () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = resolveAgentSessionOnCapabilitiesError(
      new Error('Unknown command session_capabilities'),
      'opencode_native',
    );
    expect(result.source).toBe('opencode_fallback');
    expect(result.error).toBeNull();
    expect(result.capabilities.send_prompt).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('opencode_native + other error -> fallback, error null, console.warn once with original error', () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = new Error('invoke failed: backend timeout');
    const result = resolveAgentSessionOnCapabilitiesError(err, 'opencode_native');
    expect(result.source).toBe('opencode_fallback');
    expect(result.error).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[agent-session] capabilities failed, using opencode fallback',
      err,
    );
  });

  it('non-opencode + other error -> native_tui, error surfaced, no fallback warn', () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = resolveAgentSessionOnCapabilitiesError(
      new Error('network down'),
      'claude_code',
    );
    expect(result.source).toBe('native_tui');
    expect(result.error).toBe('Error: network down');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('uses native_tui when session command is missing for non-opencode agents', () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = resolveAgentSessionOnCapabilitiesError(
      new Error('command not found'),
      'claude_code',
    );
    expect(result.source).toBe('native_tui');
    expect(result.error).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
