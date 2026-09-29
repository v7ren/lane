import { describe, expect, it } from 'vitest';
import { createPromptMessageId } from './prompt-send';

describe('createPromptMessageId', () => {
  it('returns non-empty unique ids', () => {
    const a = createPromptMessageId();
    const b = createPromptMessageId();
    expect(a.startsWith('msg_')).toBe(true);
    expect(b.startsWith('msg_')).toBe(true);
    expect(a.length).toBeGreaterThan(8);
    expect(b).not.toBe(a);
  });
});
