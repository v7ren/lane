import { useEffect, useState, type KeyboardEvent } from 'react';
import type { Settings } from '@loomria/shared';
import { findBridgeUrl } from '../lib/bridge';
import { loadSettings, updateSettings } from '../lib/settings';
import { SettingsTabPanel, type SettingsTabContext } from './settings/settings-tab-panels';
import { ComingSoonPanel } from './settings/ComingSoonPanel';
import { SETTINGS_SECTIONS, type SettingsSectionId } from './settings/settings-sections';

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
  const [section, setSection] = useState<SettingsSectionId>('general');

  useEffect(() => {
    if (!open) return;
    setSection('general');
    void loadSettings().then(setSettings);
    void findBridgeUrl().then(setBridgeUrl);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

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

  const onListKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const idx = SETTINGS_SECTIONS.findIndex((def) => def.id === section);
    const step = e.key === 'ArrowDown' ? 1 : -1;
    const next =
      SETTINGS_SECTIONS[(idx + step + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length];
    setSection(next.id);
    document.querySelector<HTMLElement>(`[data-testid="settings-nav-${next.id}"]`)?.focus();
  };

  const renderSection = (id: SettingsSectionId) => {
    switch (id) {
      case 'general':
        return (
          <>
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
          </>
        );
      case 'agents':
      case 'providers':
      case 'mcp':
      case 'config':
      case 'theme':
      case 'keybinds':
        return (
          <ComingSoonPanel title={SETTINGS_SECTIONS.find((def) => def.id === id)?.label ?? id} />
        );
      default: {
        const unreachable: never = id;
        return unreachable;
      }
    }
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
        className="w-full max-w-3xl rounded-lg border border-pm-border bg-pm-panel p-4 shadow-xl"
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
        <div className="flex gap-4">
          <nav
            aria-label="Settings sections"
            data-testid="settings-nav"
            className="flex w-40 shrink-0 flex-col gap-1"
            onKeyDown={onListKeyDown}
          >
            {SETTINGS_SECTIONS.map((def) => (
              <button
                key={def.id}
                type="button"
                data-testid={`settings-nav-${def.id}`}
                aria-current={def.id === section ? 'page' : undefined}
                tabIndex={def.id === section ? 0 : -1}
                className={[
                  'rounded px-2 py-1.5 text-left text-sm',
                  def.id === section
                    ? 'bg-pm-border/60 text-pm-text'
                    : 'text-pm-muted hover:bg-pm-border/40',
                ].join(' ')}
                onClick={() => setSection(def.id)}
              >
                {def.label}
              </button>
            ))}
          </nav>
          <div className="min-h-[320px] min-w-0 flex-1" data-testid="settings-content">
            {renderSection(section)}
          </div>
        </div>
      </div>
    </div>
  );
}
