import { beforeEach, describe, expect, it, vi } from 'vitest';

const writeInput = vi.fn(async () => undefined);
vi.mock('./tauri', () => ({ tauri: { writeInput: (...args: unknown[]) => writeInput(...(args as [])) } }));

import { answerClaudeTrustPrompt, isClaudeTrustPrompt } from './claude-trust-prompt';

describe('claude trust prompt', () => {
  beforeEach(() => writeInput.mockClear());

  it('recognises the trust screen and ignores normal output', () => {
    expect(isClaudeTrustPrompt('Security guide\n❯ No, exit\n  Yes, I trust this folder')).toBe(true);
    expect(isClaudeTrustPrompt('> hi\nHello there')).toBe(false);
  });

  it('answers by moving to "Yes" and confirming, as raw keys', async () => {
    await answerClaudeTrustPrompt('tui-1');
    expect(writeInput.mock.calls).toEqual([
      ['tui-1', '\x1b[B', false],
      ['tui-1', '\r', false],
    ]);
  });
});
