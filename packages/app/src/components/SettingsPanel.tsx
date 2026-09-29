import { useEffect, useMemo, useState } from 'react';
import type { Settings } from '@loomria/shared';
import { findBridgeUrl } from '../lib/bridge';
import { loadSettings, saveSettings } from '../lib/settings';
import type { UpdateCheckResult } from '../lib/app-update';
import { SettingsTabPanel, type SettingsTabContext } from './settings/settings-tab-panels';
import { SETTINGS_TABS, type SettingsTabId } from './settings/settings-ui';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  projectPath?: string | null;
  onProjectPathChange?: (path: string) => Promise<void>;
  updateCheck?: UpdateCheckResult | null;
  updateChecking?: boolean;
  onCheckForUpdates?: () => void;
  onOpenRelease?: () => void;
}

export function SettingsPanel({
  open,
  onClose,
  onSaved,
  projectPath = null,
  onProjectPathChange,
  updateCheck,
  updateChecking,
  onCheckForUpdates,
  onOpenRelease,
}: Props) {
  const [tab, setTab] = useState<SettingsTabId>('general');
  const [search, setSearch] = useState('');
  const [settings, setSettings] = useState<Settings>({
    default_provider: 'anthropic',
    default_model: 'claude-sonnet-4-6',
    custom_models: [],
    orchestrator_backend: 'api',
    mobile_input_delay_ms: 250,
    mobile_input_visible: true,
    dev_server_port: 1420,
    sidebar_width: 360,
    theme: 'dark',
    developer_use_rust_mcp: false,
  });
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [bridgeUrl, setBridgeUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void loadSettings().then((loaded) => setSettings(loaded));
    void findBridgeUrl().then((url) => setBridgeUrl(url));
  }, [open]);

  const filteredTabs = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return SETTINGS_TABS;
    return SETTINGS_TABS.filter((item) => item.label.toLowerCase().includes(query));
  }, [search]);

  const tabCtx: SettingsTabContext = {
    settings,
    setSettings,
    projectPath,
    onProjectPathChange,
    bridgeUrl,
    updateCheck,
    updateChecking,
    onCheckForUpdates,
    onOpenRelease,
  };

  if (!open) return null;

  const handleSave = async () => {
    await saveSettings(settings);
    if (settings.project_path && onProjectPathChange) {
      await onProjectPathChange(settings.project_path);
    }
    setSavedAt(Date.now());
    onSaved?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-pm-bg text-pm-text">
      <aside className="flex w-72 shrink-0 flex-col border-r border-pm-border bg-pm-panel">
        <div className="border-b border-pm-border p-4">
          <h2 className="text-lg font-semibold">Settings</h2>
          <input
            className="mt-3 w-full rounded border border-pm-border bg-pm-bg px-2 py-1 text-sm"
            placeholder="Search tabs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {filteredTabs.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`w-full rounded px-3 py-2 text-left text-sm ${tab === item.id ? 'bg-pm-accent/20' : 'hover:bg-pm-border/40'}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="border-t border-pm-border p-4 flex gap-2">
          <button type="button" className="pm-btn flex-1" onClick={() => void handleSave()}>Save</button>
          <button type="button" className="pm-btn flex-1" onClick={onClose}>Close</button>
        </div>
        {savedAt && <p className="px-4 pb-2 text-xs text-pm-muted">Saved</p>}
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        <SettingsTabPanel tab={tab} ctx={tabCtx} />
      </main>
    </div>
  );
}
