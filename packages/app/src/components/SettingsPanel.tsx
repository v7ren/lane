import { useEffect, useState } from 'react';
import type { Settings } from '@loomria/shared';
import { findBridgeUrl } from '../lib/bridge';
import { loadSettings, updateSettings } from '../lib/settings';
import { SettingsTabPanel, type SettingsTabContext } from './settings/settings-tab-panels';

interface Props {
  open: boolean;
  onClose: () => void;
  projectPath?: string | null;
  onProjectPathChange?: (path: string) => Promise<void>;
}

export function SettingsPanel({
  open,
  onClose,
  projectPath = null,
  onProjectPathChange,
}: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [bridgeUrl, setBridgeUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void loadSettings().then(setSettings);
    void findBridgeUrl().then(setBridgeUrl);
  }, [open]);

  if (!open || !settings) return null;

  const tabCtx: SettingsTabContext = {
    settings,
    setSettings,
    projectPath,
    onProjectPathChange,
    bridgeUrl,
  };

  const handleSave = async () => {
    const { project_path: panelProjectPath, ...rest } = settings;
    await updateSettings((current) => ({ ...current, ...rest }));
    if (panelProjectPath && onProjectPathChange) {
      await onProjectPathChange(panelProjectPath);
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-pm-border bg-pm-panel p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Settings</h2>
          <button
            type="button"
            className="px-2 py-1 text-xs rounded border border-pm-border hover:bg-pm-border/40"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <SettingsTabPanel tab="general" ctx={tabCtx} />
        <div className="mt-4 border-t border-pm-border pt-3 text-xs text-pm-muted">
          Bridge: {bridgeUrl ?? 'not running'}
        </div>
        <button
          type="button"
          className="mt-4 w-full px-3 py-2 text-sm rounded border border-pm-border bg-pm-bg hover:bg-pm-border/40"
          onClick={() => void handleSave()}
        >
          Save
        </button>
      </div>
    </div>
  );
}
