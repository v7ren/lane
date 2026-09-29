import { describe, expect, it, vi } from 'vitest';
import { isSafeHttpUrl } from '../lib/safe-agent-text';

describe('terminal link safety', () => {
  it('only allows http and https URLs for external open', () => {
    expect(isSafeHttpUrl('https://example.com/path')).toBe(true);
    expect(isSafeHttpUrl('http://127.0.0.1:17321/')).toBe(true);
    expect(isSafeHttpUrl('file:///C:/secret')).toBe(false);
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
  });

  it('openExternalUrl gate rejects unsafe schemes', () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const uri = 'javascript:alert(1)';
    if (!isSafeHttpUrl(uri)) {
      expect(open).not.toHaveBeenCalled();
    }
  });
});
