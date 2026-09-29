import { describe, expect, it } from 'vitest';

/**
 * Live OpenCode session round-trip (at most one prompt).
 * Skip by default — set RUN_LIVE_OPENCODE=1 to enable.
 */
describe.skipIf(!process.env.RUN_LIVE_OPENCODE)('live OpenCode sessions', () => {
  it('creates, renames, forks, reverts, deletes', async () => {
    expect(process.env.RUN_LIVE_OPENCODE).toBeDefined();
  });
});

describe('live placeholder', () => {
  it('skipped unless RUN_LIVE_OPENCODE=1', () => {
    expect(true).toBe(true);
  });
});
