import { useEffect, useState } from 'react';
import { homeDir } from '@tauri-apps/api/path';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import type { Settings } from '@loomria/shared';
import { resolveSettingsFilePath } from '../../lib/settings';
import type { UpdateCheckResult } from '../../lib/app-update';
import { tauri, type AppInstallInfo } from '../../lib/tauri';
import {
  FieldInput,
  SettingBlock,
  SettingsSection,
  type SettingsTabId,
} from './settings-ui';

export const EMPTY_CUSTOM = { provider: 'openrouter' as const, model_id: '', label: '' };

export interface SettingsTabContext {
  settings: Settings;
  setSettings: (next: Settings) => void;
  projectPath: string | null;
  onProjectPathChange?: (path: string) => Promise<void>;
  bridgeUrl: string | null;
  updateCheck?: UpdateCheckResult | null;
  updateChecking?: boolean;
  onCheckForUpdates?: () => void;
  onOpenRelease?: () => void;
}

export function SettingsTabPanel({ tab, ctx }: { tab: SettingsTabId; ctx: SettingsTabContext }) {
  switch (tab) {
    case 'general':
      return <GeneralTab ctx={ctx} />;
    case 'developer':
      return <DeveloperTab ctx={ctx} />;
    default: {
      const _exhaustive: never = tab;
      return _exhaustive;
    }
  }
}

function GeneralTab({ ctx }: { ctx: SettingsTabContext }) {
  const { settings, setSettings, projectPath, onProjectPathChange, updateCheck, updateChecking, onCheckForUpdates, onOpenRelease } = ctx;
  const [settingsPath, setSettingsPath] = useState('settings.json');
  const [installInfo, setInstallInfo] = useState<AppInstallInfo | null>(null);
  useEffect(() => { void resolveSettingsFilePath().then(setSettingsPath); }, []);
  useEffect(() => { void tauri.getAppInstallInfo().then(setInstallInfo); }, []);

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
    <div className="space-y-6">
      <SettingsSection title="Project" description="Default working directory for new panes.">
        <SettingBlock label="Project folder" implemented>
          <div className="flex gap-2">
            <FieldInput value={settings.project_path ?? projectPath ?? ''} readOnly />
            <button type="button" className="pm-btn" onClick={() => void pickPath()}>Browse</button>
          </div>
        </SettingBlock>
      </SettingsSection>
      <SettingsSection title="About" description="Install metadata and updates.">
        <SettingBlock label="Settings file" implemented>
          <FieldInput value={settingsPath} readOnly />
        </SettingBlock>
        {installInfo && (
          <SettingBlock label="Version" implemented>
            <FieldInput value={installInfo.version} readOnly />
          </SettingBlock>
        )}
        <SettingBlock label="Updates" implemented>
          <button type="button" className="pm-btn" disabled={updateChecking} onClick={onCheckForUpdates}>
            {updateChecking ? 'Checking…' : 'Check for updates'}
          </button>
          {updateCheck?.updateAvailable && (
            <button type="button" className="pm-btn ml-2" onClick={onOpenRelease}>Open release</button>
          )}
        </SettingBlock>
      </SettingsSection>
    </div>
  );
}

function DeveloperTab({ ctx }: { ctx: SettingsTabContext }) {
  const { bridgeUrl } = ctx;
  return (
    <SettingsSection title="Bridge" description="Local HTTP API for pane control.">
      <SettingBlock label="Bridge URL" implemented>
        <FieldInput value={bridgeUrl ?? 'not running'} readOnly />
      </SettingBlock>
    </SettingsSection>
  );
}
