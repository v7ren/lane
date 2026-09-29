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
}

export function SettingsTabPanel({
  tab: _tab,
  ctx,
}: {
  tab: 'general';
  ctx: SettingsTabContext;
}) {
  const { settings, setSettings, projectPath, onProjectPathChange } = ctx;
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
