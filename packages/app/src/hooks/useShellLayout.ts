import { useCallback, useEffect, useState } from 'react';
import type { ShellLayout } from '@loomria/shared';
import {
  clampShellLayout,
  DEFAULT_SHELL_LAYOUT,
  markBottomRatioUserTouched,
  mergeShellLayout,
} from '../lib/shell-layout';
import { loadSettings, saveSettings } from '../lib/settings';

const LAYOUT_STORAGE_KEY = 'loomria-shell-layout-v2';

type PersistedLayout = Pick<
  ShellLayout,
  'sidebarWidth' | 'explorerWidth' | 'rightRailWidth' | 'bottomPanelPercent'
>;

function readPersistedWidths(): Partial<PersistedLayout> | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedLayout;
  } catch {
    return null;
  }
}

function writePersistedWidths(layout: ShellLayout): void {
  if (typeof localStorage === 'undefined') return;
  const payload: PersistedLayout = {
    sidebarWidth: layout.sidebarWidth,
    explorerWidth: layout.explorerWidth,
    rightRailWidth: layout.rightRailWidth,
    bottomPanelPercent: layout.bottomPanelPercent,
  };
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(payload));
}

export function useShellLayout() {
  const [layout, setLayoutState] = useState<ShellLayout>(() =>
    mergeShellLayout(readPersistedWidths()),
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const settings = await loadSettings();
        if (settings.shell_layout) {
          setLayoutState(
            mergeShellLayout({
              ...readPersistedWidths(),
              ...settings.shell_layout,
              sidebarCollapsed: false,
              explorerCollapsed: false,
              rightRailCollapsed: false,
              bottomPanelCollapsed: false,
            }),
          );
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const persist = useCallback(async (next: ShellLayout) => {
    const normalized = clampShellLayout(next);
    setLayoutState(normalized);
    writePersistedWidths(normalized);
    try {
      const settings = await loadSettings();
      await saveSettings({
        ...settings,
        shell_layout: {
          ...normalized,
          sidebarCollapsed: false,
          rightRailCollapsed: false,
          explorerCollapsed: false,
        },
      });
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

  const resetVisibility = useCallback(() => {
    patchLayout({
      sidebarCollapsed: false,
      explorerCollapsed: false,
      rightRailCollapsed: false,
      bottomPanelCollapsed: false,
    });
  }, [patchLayout]);

  const markBottomPanelResized = useCallback(() => {
    markBottomRatioUserTouched();
  }, []);

  return { layout, ready, patchLayout, resetPanel, resetVisibility, markBottomPanelResized };
}
