import { describe, expect, it } from 'vitest';
import { SettingsSchema } from './schemas';

describe('SettingsSchema ui_mode', () => {
  it('defaults to agent', () => {
    expect(SettingsSchema.parse({}).ui_mode).toBe('agent');
  });
  it('accepts ide and rejects unknown values', () => {
    expect(SettingsSchema.parse({ ui_mode: 'ide' }).ui_mode).toBe('ide');
    expect(SettingsSchema.safeParse({ ui_mode: 'zen' }).success).toBe(false);
  });
});
