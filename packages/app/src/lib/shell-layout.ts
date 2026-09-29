import { ShellLayoutSchema, type ShellLayout } from '@loomria/shared';

export const BOTTOM_RATIO_TOUCHED_KEY = 'loomria-bottom-ratio-touched';

export function defaultBottomRatio(opts: { hasEditorTabs: boolean }): number {
  return opts.hasEditorTabs ? 42 : 70;
}

export const DEFAULT_SHELL_LAYOUT: ShellLayout = ShellLayoutSchema.parse({
  bottomPanelPercent: defaultBottomRatio({ hasEditorTabs: false }),
});

export function mergeShellLayout(partial?: Partial<ShellLayout> | null): ShellLayout {
  return ShellLayoutSchema.parse({ ...DEFAULT_SHELL_LAYOUT, ...(partial ?? {}) });
}

export function clampShellLayout(layout: ShellLayout): ShellLayout {
  return ShellLayoutSchema.parse(layout);
}

export function readBottomRatioUserTouched(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(BOTTOM_RATIO_TOUCHED_KEY) === '1';
}

export function markBottomRatioUserTouched(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(BOTTOM_RATIO_TOUCHED_KEY, '1');
}
