import { describe, expect, it } from 'vitest';
import { parseClaudeInfo } from './claude-info';

describe('parseClaudeInfo', () => {
  it('reads models, commands, mode and account from the initialize reply', () => {
    const info = parseClaudeInfo({
      models: [
        { value: 'default', displayName: 'Default (recommended)', description: 'Sonnet 5.5' },
        { value: 'opus', displayName: 'Opus 5.5' },
        { displayName: 'no value' },
      ],
      commands: [{ name: 'design', description: 'Make a design', argumentHint: '[brief]' }, { name: '' }],
      current_permission_mode: 'plan',
      account: { subscriptionType: 'Claude Pro', email: 'someone@example.com' },
    });
    expect(info?.models.map((m) => m.value)).toEqual(['default', 'opus']);
    expect(info?.commands).toEqual([
      { name: 'design', description: 'Make a design', argumentHint: '[brief]' },
    ]);
    expect(info?.permissionMode).toBe('plan');
    expect(info?.account).toBe('Claude Pro');
  });

  it('falls back to defaults and rejects non-objects', () => {
    expect(parseClaudeInfo({})?.permissionMode).toBe('default');
    expect(parseClaudeInfo(null)).toBeNull();
    expect(parseClaudeInfo('x')).toBeNull();
  });
});
