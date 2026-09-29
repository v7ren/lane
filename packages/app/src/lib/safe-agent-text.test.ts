import { describe, expect, it } from 'vitest';
import { escapeAgentText, isSafeHttpUrl } from './safe-agent-text';

describe('safe agent text', () => {
  it('neutralizes script/img payloads', () => {
    const raw = '<img onerror=alert(1)><script>alert(1)</script>';
    const out = escapeAgentText(raw);
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('allows only http(s) links', () => {
    expect(isSafeHttpUrl('https://example.com')).toBe(true);
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
  });
});
