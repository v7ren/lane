/**
 * OpenCode 1.18.x: `prompt_async` has no permission field (see `session.prompt_async` in schema).
 * Session permission mode is set via PATCH `/session/{sessionID}` body `permission` (PermissionRuleset):
 * `{ permission, pattern, action }[]` where action is `allow` | `deny` | `ask`.
 */

export type ComposerPermissionMode = 'allow' | 'ask';

export type OpenCodePermissionAction = 'allow' | 'deny' | 'ask';

export type OpenCodePermissionRule = {
  permission: string;
  pattern: string;
  action: OpenCodePermissionAction;
};

export function permissionRulesetForComposerMode(
  mode: ComposerPermissionMode,
): OpenCodePermissionRule[] {
  return [{ permission: '*', pattern: '*', action: mode }];
}

export function sessionPermissionPatchBody(mode: ComposerPermissionMode): {
  permission: OpenCodePermissionRule[];
} {
  return { permission: permissionRulesetForComposerMode(mode) };
}

export function composerPermissionModeFromAction(
  action: OpenCodePermissionAction,
): ComposerPermissionMode | null {
  switch (action) {
    case 'allow':
      return 'allow';
    case 'ask':
      return 'ask';
    case 'deny':
      return null;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
