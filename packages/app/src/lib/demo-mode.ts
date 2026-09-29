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

export function readDemoUrlFlags(): { view: 'workspace' | 'agent'; paneId: string | null } {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view') === 'agent' ? 'agent' : 'workspace';
  return { view, paneId: params.get('pane') };
}
