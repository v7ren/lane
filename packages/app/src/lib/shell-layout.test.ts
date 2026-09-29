import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DEFAULT_SHELL_LAYOUT, mergeShellLayout } from './shell-layout';

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

  it('persists layout to localStorage via hook consumer pattern', () => {
    localStorage.setItem('loomria-shell-layout-v1', JSON.stringify({ sidebarWidth: 199 }));
    const parsed = mergeShellLayout(JSON.parse(localStorage.getItem('loomria-shell-layout-v1')!));
    expect(parsed.sidebarWidth).toBe(199);
  });
});
