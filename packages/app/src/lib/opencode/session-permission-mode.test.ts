import { describe, expect, it } from 'vitest';

import {
  composerPermissionModeFromAction,
  permissionRulesetForComposerMode,
  sessionPermissionPatchBody,
} from './session-permission-mode.js';

describe('session-permission-mode', () => {
  it('maps allow and ask to wildcard ruleset', () => {
    expect(permissionRulesetForComposerMode('allow')).toEqual([
      { permission: '*', pattern: '*', action: 'allow' },
    ]);
    expect(permissionRulesetForComposerMode('ask')).toEqual([
      { permission: '*', pattern: '*', action: 'ask' },
    ]);
    expect(sessionPermissionPatchBody('ask').permission[0]?.action).toBe('ask');
  });

  it('composerPermissionModeFromAction is exhaustive', () => {
    expect(composerPermissionModeFromAction('allow')).toBe('allow');
    expect(composerPermissionModeFromAction('ask')).toBe('ask');
    expect(composerPermissionModeFromAction('deny')).toBeNull();
  });
});
