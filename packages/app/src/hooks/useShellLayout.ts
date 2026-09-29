import { useCallback, useEffect, useState } from 'react';
import type { ShellLayout } from '@loomria/shared';
import { clampShellLayout, DEFAULT_SHELL_LAYOUT, mergeShellLayout } from '../lib/shell-layout';
import { loadSettings, saveSettings } from '../lib/settings';

const LAYOUT_STORAGE_KEY = 'loomria-shell-layout-v1';

function readLocalLayout(): ShellLayout | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    return mergeShellLayout(JSON.parse(raw) as ShellLayout);
  } catch {
    return null;
  }
}

function writeLocalLayout(layout: ShellLayout): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
}

export function useShellLayout() {
  const [layout, setLayoutState] = useState<ShellLayout>(() => readLocalLayout() ?? DEFAULT_SHELL_LAYOUT);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const settings = await loadSettings();
        if (settings.shell_layout) {
          setLayoutState(mergeShellLayout(settings.shell_layout));
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const persist = useCallback(async (next: ShellLayout) => {
    const normalized = clampShellLayout(next);
    setLayoutState(normalized);
    writeLocalLayout(normalized);
    try {
      const settings = await loadSettings();
      await saveSettings({ ...settings, shell_layout: normalized });
    } catch {
      /* demo / vitest */
    }
  }, []);

  const patchLayout = useCallback(
    (patch: Partial<ShellLayout>) => {
      void persist(mergeShellLayout({ ...layout, ...patch }));
    },
    [layout, persist],
  );

  const resetPanel = useCallback(
    (key: keyof ShellLayout) => {
      const defaults = DEFAULT_SHELL_LAYOUT;
      patchLayout({ [key]: defaults[key] } as Partial<ShellLayout>);
    },
    [patchLayout],
  );

  return { layout, ready, patchLayout, resetPanel };
}
