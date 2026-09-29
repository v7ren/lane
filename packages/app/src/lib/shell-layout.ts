import { ShellLayoutSchema, type ShellLayout } from '@loomria/shared';

export const DEFAULT_SHELL_LAYOUT: ShellLayout = ShellLayoutSchema.parse({});

export function mergeShellLayout(partial?: Partial<ShellLayout> | null): ShellLayout {
  return ShellLayoutSchema.parse({ ...DEFAULT_SHELL_LAYOUT, ...(partial ?? {}) });
}

export function clampShellLayout(layout: ShellLayout): ShellLayout {
  return ShellLayoutSchema.parse(layout);
}
