import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from './SettingsPanel';

const catalog = vi.hoisted(() => ({
  value: {
    agents: [
      {
        id: 'claude',
        label: 'Claude Code',
        description: 'Anthropic agent',
        icon: 'c',
        is_tui: true,
        command: 'claude',
        base_args: [],
        show_in_new_pane_menu: true,
        default_worker: false,
      },
    ],
    report: { errors: [{ file: 'bad.toml', message: 'missing id' }] },
  },
}));

vi.mock('../lib/settings', () => ({
  loadSettings: () => Promise.resolve({ project_path: '/p' }),
  updateSettings: vi.fn(() => Promise.resolve()),
  resolveSettingsFilePath: () => Promise.resolve('settings.json'),
}));
vi.mock('../lib/bridge', () => ({ findBridgeUrl: () => Promise.resolve(null) }));
vi.mock('../lib/tauri', () => ({
  tauri: {
    getAppInstallInfo: () => Promise.resolve(null),
    listAgents: () => Promise.resolve(catalog.value),
  },
}));
vi.mock('@tauri-apps/api/path', () => ({ homeDir: () => Promise.resolve('/') }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();

async function mount() {
  root = createRoot(container);
  await act(async () => {
    root.render(<SettingsPanel open onClose={onClose} projectPath="/p" />);
  });
}

const nav = (id: string) =>
  container.querySelector(`[data-testid="settings-nav-${id}"]`) as HTMLButtonElement;

beforeEach(() => {
  onClose.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('SettingsPanel sections', () => {
  it('renders General plus all six sections', async () => {
    await mount();
    const labels = Array.from(container.querySelectorAll('[data-testid^="settings-nav-"]')).map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(['General', 'Providers', 'MCP', 'Config', 'Theme', 'Keybinds', 'Agents']);
    expect(nav('general').getAttribute('aria-current')).toBe('page');
  });

  it('switches section on click', async () => {
    await mount();
    await act(async () => nav('theme').click());
    expect(nav('theme').getAttribute('aria-current')).toBe('page');
    expect(nav('general').getAttribute('aria-current')).toBeNull();
  });

  it('shows a coming-soon notice for placeholder sections', async () => {
    await mount();
    for (const id of ['providers', 'mcp', 'config', 'theme', 'keybinds']) {
      await act(async () => nav(id).click());
      expect(container.querySelector('[data-testid="settings-coming-soon"]')?.textContent).toContain(
        'Coming soon',
      );
    }
  });

  it('moves selection with arrow keys', async () => {
    await mount();
    await act(async () => {
      nav('general').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(nav('providers').getAttribute('aria-current')).toBe('page');
  });

  it('closes on Escape', async () => {
    await mount();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });
});
