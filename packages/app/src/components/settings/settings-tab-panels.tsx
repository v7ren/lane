import { useEffect, useState } from 'react';
import { homeDir } from '@tauri-apps/api/path';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import type { Settings } from '@loomria/shared';
import { resolveSettingsFilePath } from '../../lib/settings';
import { tauri, type AppInstallInfo } from '../../lib/tauri';
import { FieldInput, SettingBlock, SettingsSection } from './settings-ui';

export interface SettingsTabContext {
  settings: Settings;
  setSettings: (next: Settings) => void;
  projectPath: string | null;
  onProjectPathChange?: (path: string) => Promise<void>;
  bridgeUrl: string | null;
  /** Applies the interface mode to the running shell immediately (the shell owns persistence). */
  onUiModeChange?: (mode: 'agent' | 'ide') => void;
}

const UI_MODE_OPTIONS: { id: 'agent' | 'ide'; label: string; hint: string }[] = [
  { id: 'agent', label: 'Agent-first', hint: 'The conversation fills the window.' },
  { id: 'ide', label: 'IDE', hint: 'Explorer, editor and bottom panel.' },
];

export function SettingsTabPanel({
  tab: _tab,
  ctx,
}: {
  tab: 'general';
  ctx: SettingsTabContext;
}) {
  const { settings, setSettings, projectPath, onProjectPathChange, onUiModeChange } = ctx;
  const uiMode = settings.ui_mode ?? 'agent';
  const [settingsPath, setSettingsPath] = useState('settings.json');
  const [installInfo, setInstallInfo] = useState<AppInstallInfo | null>(null);
  const [agentManifestErrors, setAgentManifestErrors] = useState<
    { file: string; message: string }[]
  >([]);

  useEffect(() => {
    void resolveSettingsFilePath().then(setSettingsPath);
    void tauri.getAppInstallInfo().then(setInstallInfo);
    void tauri.listAgents().then((catalog) => setAgentManifestErrors(catalog.report.errors));
  }, []);

  const pickPath = async () => {
    if (!onProjectPathChange) return;
    const result = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: (await homeDir()) ?? projectPath ?? undefined,
    });
    if (typeof result === 'string') {
      await onProjectPathChange(result);
      setSettings({ ...settings, project_path: result });
    }
  };

  return (
    <SettingsSection title="Project" description="Default cwd for new panes.">
      <SettingBlock label="Interface" description="Switch any time from the title bar." implemented>
        <div className="flex gap-2" role="radiogroup" aria-label="Interface" data-testid="settings-ui-mode">
          {UI_MODE_OPTIONS.map((opt) => {
            const selected = uiMode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`settings-ui-mode-${opt.id}`}
                title={opt.hint}
                className={[
                  'flex-1 rounded-lg border px-3 py-2 text-left text-sm transition',
                  selected
                    ? 'border-pm-accent/60 bg-pm-border/40 text-pm-text'
                    : 'border-pm-border text-pm-muted hover:bg-pm-border/30',
                ].join(' ')}
                onClick={() => {
                  setSettings({ ...settings, ui_mode: opt.id });
                  onUiModeChange?.(opt.id);
                }}
              >
                <span className="block font-medium">{opt.label}</span>
                <span className="block text-xs text-pm-muted">{opt.hint}</span>
              </button>
            );
          })}
        </div>
      </SettingBlock>
      <SettingBlock label="Folder" implemented>
        <div className="flex gap-2">
          <FieldInput value={settings.project_path ?? projectPath ?? ''} readOnly />
          <button
            type="button"
            className="px-2 py-1 text-xs rounded border border-pm-border hover:bg-pm-border/40"
            onClick={() => void pickPath()}
          >
            Browse
          </button>
        </div>
      </SettingBlock>
      {installInfo && (
        <SettingBlock label="Version" implemented>
          <FieldInput value={installInfo.version} readOnly />
        </SettingBlock>
      )}
      <SettingBlock label="Settings file" implemented>
        <FieldInput value={settingsPath} readOnly />
      </SettingBlock>
      {agentManifestErrors.length > 0 && (
        <SettingBlock label="Agent manifest errors" implemented>
          <ul className="text-xs text-pm-err space-y-1 list-disc pl-4">
            {agentManifestErrors.map((err) => (
              <li key={err.file}>
                <span className="font-mono">{err.file}</span>: {err.message}
              </li>
            ))}
          </ul>
        </SettingBlock>
      )}
    </SettingsSection>
  );
}
