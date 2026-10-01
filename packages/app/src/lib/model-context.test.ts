import { describe, expect, it } from 'vitest';
import { resolveContextWindow } from './model-context';

describe('resolveContextWindow', () => {
  it('prefers the window reported by the event', () => {
    expect(resolveContextWindow({ family: 'claude', model: 'opus', eventWindow: 123_000 })).toBe(123_000);
    expect(resolveContextWindow({ family: 'codex', eventWindow: 258_000 })).toBe(258_000);
  });
  it('Claude: [1m] is 1M, anything else 200k', () => {
    expect(resolveContextWindow({ family: 'claude', model: 'opus[1m]' })).toBe(1_000_000);
    expect(resolveContextWindow({ family: 'claude', model: 'sonnet' })).toBe(200_000);
    expect(resolveContextWindow({ family: 'claude', model: null })).toBe(200_000);
  });
  it('Codex without an event window is unknown', () => {
    expect(resolveContextWindow({ family: 'codex', model: 'gpt' })).toBeUndefined();
  });
  it('OpenCode uses the catalog limit, else unknown', () => {
    expect(resolveContextWindow({ family: 'opencode', catalogLimit: 64_000 })).toBe(64_000);
    expect(resolveContextWindow({ family: 'opencode' })).toBeUndefined();
  });
});
