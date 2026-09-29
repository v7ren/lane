import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  DEFAULT_SHELL_LAYOUT,
  defaultBottomRatio,
  mergeShellLayout,
} from './shell-layout';

const saveSettings = vi.fn();

vi.mock('./settings', () => ({
  loadSettings: vi.fn(async () => ({ shell_layout: { sidebarWidth: 280 } })),
  saveSettings,
}));

describe('shell layout defaults', () => {
  beforeEach(() => {
    localStorage.clear();
    saveSettings.mockClear();
  });

  it('merges partial layout with defaults', () => {
    const merged = mergeShellLayout({ sidebarWidth: 280 });
    expect(merged.sidebarWidth).toBe(280);
    expect(merged.explorerWidth).toBe(DEFAULT_SHELL_LAYOUT.explorerWidth);
  });

  it('merges persisted width keys with defaults', () => {
    const parsed = mergeShellLayout({ sidebarWidth: 199 });
    expect(parsed.sidebarWidth).toBe(199);
    expect(parsed.sidebarCollapsed).toBe(false);
  });

  it('defaultBottomRatio favors agent panel without editor tabs', () => {
    expect(defaultBottomRatio({ hasEditorTabs: false })).toBe(70);
    expect(defaultBottomRatio({ hasEditorTabs: true })).toBe(42);
  });
});
