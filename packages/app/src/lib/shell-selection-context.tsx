import { createContext, useContext, type ReactNode } from 'react';

export type BottomPanelTab = 'agent' | 'terminal';
export type ActivityRailSection = 'sessions' | 'workspaces';

export type ShellSelectionState = {
  selectedPaneId: string | null;
  setSelectedPaneId: (id: string | null) => void;
  selectedSessionId: string | null;
  setSelectedSessionId: (id: string | null) => void;
  selectSession: (paneId: string, sessionId?: string) => void;
  bottomTab: BottomPanelTab;
  setBottomTab: (tab: BottomPanelTab) => void;
  showTui: boolean;
  setShowTui: (value: boolean | ((prev: boolean) => boolean)) => void;
  selectedTerminalPaneId: string | null;
  setSelectedTerminalPaneId: (id: string | null) => void;
  railSection: ActivityRailSection;
  setRailSection: (section: ActivityRailSection) => void;
  sidebarColumnOpen: boolean;
  setSidebarColumnOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  rightRailOpen: boolean;
  setRightRailOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  paletteFileMode: boolean;
  setPaletteFileMode: (file: boolean) => void;
};

const ShellSelectionContext = createContext<ShellSelectionState | null>(null);

export function ShellSelectionProvider({
  value,
  children,
}: {
  value: ShellSelectionState;
  children: ReactNode;
}) {
  return <ShellSelectionContext.Provider value={value}>{children}</ShellSelectionContext.Provider>;
}

export function useShellSelection(): ShellSelectionState {
  const ctx = useContext(ShellSelectionContext);
  if (!ctx) {
    throw new Error('useShellSelection must be used within ShellSelectionProvider');
  }
  return ctx;
}
