import { describe, expect, it } from 'vitest';
import { fromOpenCode } from './from-opencode.js';
import { applyOpenCodeWireEvent, createEmptyOpenCodeStore } from '../opencode/store.js';

describe.skip('live OpenCode adapter (manual)', () => {
  it('maps a real prompt turn from the server', async () => {
    // Start `opencode serve --hostname 127.0.0.1 --port <free>` in a temp dir with hello.txt,
    // drive opencodeClient + store replay, then assert fromOpenCode contains user_prompt + assistant_text.
    expect(fromOpenCode).toBeDefined();
    expect(applyOpenCodeWireEvent).toBeDefined();
    expect(createEmptyOpenCodeStore).toBeDefined();
  });
});
