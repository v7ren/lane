export type DemoVariant = 'full' | 'empty';

export function parseDemoVariant(): DemoVariant | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  if (!params.has('demo')) return null;
  const value = params.get('demo');
  if (value === 'empty') return 'empty';
  return 'full';
}

export function isDemoMode(): boolean {
  return parseDemoVariant() !== null;
}

export function readDemoUrlFlags(): {
  view: 'workspace' | 'agent';
  paneId: string | null;
  showTui: boolean;
  palette: boolean;
  collapsed: boolean;
  bottomTab: 'agent' | 'terminal';
} {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view') === 'agent' ? 'agent' : 'workspace';
  const tui = params.get('tui');
  const bottom = params.get('bottom');
  return {
    view,
    paneId: params.get('pane'),
    showTui: tui === '1' || tui === 'open' || tui === 'true',
    palette: params.get('palette') === '1',
    collapsed: params.get('collapsed') === '1',
    bottomTab: bottom === 'terminal' ? 'terminal' : 'agent',
  };
}
