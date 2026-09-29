import { describe, expect, it } from 'vitest';

import { composerAllowlistOk, findMissingComposerAllowlistRoutes } from './composer-allowlist.js';

describe('composer allowlist coverage', () => {
  it('includes every composer and dock route', () => {
    const missing = findMissingComposerAllowlistRoutes();
    expect(missing).toEqual([]);
    expect(composerAllowlistOk()).toBe(true);
  });
});
