import { appConfigDir, join } from '@tauri-apps/api/path';

import { LazyStore } from '@tauri-apps/plugin-store';

import {

  DEFAULT_LLM_MODELS,

  modelKey,

  type LlmModel,

  type LlmProvider,

  type Settings,

} from '@loomria/shared';

import { toPublicSettings } from './bridge-settings';

import { applyKeybinds } from './keybinds';

import { applyAccent } from './theme-accent';

import { tauri } from './tauri';



/** Canonical on-disk settings file (app config dir). */

export const SETTINGS_STORE_FILENAME = 'settings.json';

const LEGACY_STORE_FILENAME = 'puppet-master.settings.json';

export const SETTINGS_KEY = 'settings';

const LEGACY_SIDEBAR_WIDTH_KEY = 'pm-sidebar-width';



export const MIN_SIDEBAR_WIDTH = 300;

export const MAX_SIDEBAR_WIDTH = 800;

export const SIDEBAR_WIDTH_PRESETS = [300, 360, 400, 480, 640] as const;

export type SidebarWidthPreset = (typeof SIDEBAR_WIDTH_PRESETS)[number];



export const SIDEBAR_WIDTH_PRESET_LABELS: Record<SidebarWidthPreset, string> = {

  300: 'Compact',

  360: 'Comfortable',

  400: 'Balanced',

  480: 'Wide',

  640: 'Extra wide',

};



export function isSidebarWidthPreset(width: number): width is SidebarWidthPreset {

  return (SIDEBAR_WIDTH_PRESETS as readonly number[]).includes(width);

}



let cached: LazyStore | null = null;

let migrationDone = false;



/** Serializes every read/modify/write to settings.json (all top-level keys). */

let settingsFileQueue: Promise<void> = Promise.resolve();



/** @internal test hook */
export function resetSettingsFileQueueForTests(): void {
  settingsFileQueue = Promise.resolve();
  invalidateSettingsCache();
}

async function closeSettingsStore(): Promise<void> {
  if (!cached) return;
  try {
    await cached.close();
  } catch {
    /* ignore */
  }
  cached = null;
}

export function enqueueSettingsFileWrite<T>(fn: () => Promise<T>): Promise<T> {

  const run = settingsFileQueue.then(async () => {
    await migrateLegacySettingsFile();
    return fn();
  });

  settingsFileQueue = run.then(

    () => undefined,

    () => undefined,

  );

  return run;

}



export function clampSidebarWidth(width: number): number {

  if (!Number.isFinite(width)) return 360;

  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));

}



export type AppTheme = Settings['theme'];



export function applyTheme(theme: AppTheme): void {

  if (typeof document === 'undefined') return;

  document.documentElement.dataset.theme = theme;

}



/** Applies accent colour and keyboard bindings from settings to the running app. */

export function applyRuntimeSettings(s: Settings): void {

  applyAccent(s.accent_color);

  applyKeybinds(s.keybinds);

}



function store(): LazyStore {

  if (!cached) {

    cached = new LazyStore(SETTINGS_STORE_FILENAME, { defaults: {}, autoSave: false });

  }

  return cached;

}



/** Single LazyStore instance for settings.json (shared with recent-workspaces, etc.). */

export function getSettingsLazyStore(): LazyStore {

  return store();

}



/** Drop in-memory cache after the bridge writes settings on disk. */

export function invalidateSettingsCache(): void {

  cached = null;

  migrationDone = false;

}



const DEFAULT_SETTINGS: Settings = {

  default_provider: 'anthropic',

  default_model: 'claude-sonnet-4-6',

  custom_models: [],

  orchestrator_backend: 'api',

  sidebar_width: 360,

  theme: 'dark',

  developer_use_rust_mcp: false,

};



function readLegacySidebarWidth(): number | undefined {

  if (typeof localStorage === 'undefined') return undefined;

  const stored = localStorage.getItem(LEGACY_SIDEBAR_WIDTH_KEY);

  if (!stored) return undefined;

  const parsed = Number.parseInt(stored, 10);

  return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : undefined;

}



/** Unpack settings values stored as arrays or corrupted array-spreads from LazyStore. */
export function coerceStoredSettings(raw: unknown): Settings | null | undefined {
  if (raw == null) return undefined;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const coerced = coerceStoredSettings(item);
      if (coerced) return coerced;
    }
    return undefined;
  }
  if (typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const nested = record['0'];
  const fromNested =
    nested && typeof nested === 'object' && !Array.isArray(nested)
      ? coerceStoredSettings(nested)
      : undefined;
  const { 0: _legacy0, 1: _legacy1, ...rest } = record;
  if (fromNested || Object.keys(rest).length > 0) {
    return { ...(fromNested ?? {}), ...rest } as Settings;
  }
  return record as Settings;
}

export function mergeLoadedSettings(raw: Settings | null | undefined): Settings {

  const merged = { ...DEFAULT_SETTINGS, ...(coerceStoredSettings(raw) ?? {}) };

  const legacySidebar = readLegacySidebarWidth();

  return {

    ...merged,

    sidebar_width: clampSidebarWidth(merged.sidebar_width ?? legacySidebar ?? 360),

    theme: merged.theme ?? 'dark',

    developer_use_rust_mcp: merged.developer_use_rust_mcp ?? false,

  };

}



function normalizeSettings(s: Settings): Settings {

  return {

    ...s,

    sidebar_width: clampSidebarWidth(s.sidebar_width ?? 360),

    theme: s.theme ?? 'dark',

    developer_use_rust_mcp: s.developer_use_rust_mcp ?? false,

  };

}



async function migrateLegacySettingsFile(): Promise<void> {

  if (migrationDone) return;

  migrationDone = true;



  try {

    const modern = store();

    const existing = await modern.get<Settings>(SETTINGS_KEY);

    if (existing) return;



    const legacy = new LazyStore(LEGACY_STORE_FILENAME, { defaults: {}, autoSave: false });

    const fromLegacy = await legacy.get<Settings>(SETTINGS_KEY);

    if (!fromLegacy) return;



    await modern.set(SETTINGS_KEY, fromLegacy);

    await modern.save();

  } catch {

    /* migration is best-effort */

  }

}



/** Absolute path to the canonical settings.json in the app config directory. */

export async function resolveSettingsFilePath(): Promise<string> {

  try {

    return join(await appConfigDir(), SETTINGS_STORE_FILENAME);

  } catch {

    return SETTINGS_STORE_FILENAME;

  }

}



export async function loadSettings(): Promise<Settings> {

  return enqueueSettingsFileWrite(async () => {

    try {

      await store().reload();

      const raw = await store().get<Settings>(SETTINGS_KEY);

      const merged = mergeLoadedSettings(raw);

      applyTheme(merged.theme ?? 'dark');

      applyRuntimeSettings(merged);

      return merged;

    } catch {

      const merged = mergeLoadedSettings(undefined);

      applyTheme(merged.theme ?? 'dark');

      return merged;

    }

  });

}



export type SettingsPatch = Partial<Settings> | ((current: Settings) => Partial<Settings>);



async function persistSettingsMerged(next: Settings): Promise<Settings> {

  const normalized = normalizeSettings(next);

  applyTheme(normalized.theme ?? 'dark');

  applyRuntimeSettings(normalized);

  await store().set(SETTINGS_KEY, normalized);

  await store().save();

  try {
    await tauri.syncPublicSettings(JSON.stringify(toPublicSettings(normalized)));
  } catch {
    /* bridge sync is best-effort */
  }

  void tauri.pushSettingsEvent(JSON.stringify(toPublicSettings(normalized)));

  return normalized;

}



/** Apply a patch to the latest persisted settings object through a single writer queue. */

export async function updateSettings(patch: SettingsPatch): Promise<Settings> {

  return enqueueSettingsFileWrite(async () => {

    const raw = await store().get<Settings>(SETTINGS_KEY);

    const current = mergeLoadedSettings(raw);

    const delta = typeof patch === 'function' ? patch(current) : patch;

    return persistSettingsMerged({ ...current, ...delta });

  });

}



/** @deprecated Prefer updateSettings with a patch. */

export async function saveSettings(s: Settings): Promise<void> {

  await updateSettings(s);

}



export async function syncPublicSettingsToBridge(): Promise<void> {

  try {

    const s = await loadSettings();

    await tauri.syncPublicSettings(JSON.stringify(toPublicSettings(s)));

  } catch {

    /* bridge sync is best-effort */

  }

}



/** Preset + user custom models, deduped by provider+model_id (custom wins on label). */

export function listModels(settings?: Settings): LlmModel[] {

  const custom = settings?.custom_models ?? [];

  const byKey = new Map<string, LlmModel>();

  for (const m of DEFAULT_LLM_MODELS) {

    byKey.set(modelKey(m), m);

  }

  for (const m of custom) {

    byKey.set(modelKey(m), m);

  }

  return [...byKey.values()];

}



export function findModel(settings: Settings, provider: LlmProvider, modelId: string): LlmModel | undefined {

  return listModels(settings).find((m) => m.provider === provider && m.model_id === modelId);

}



export function getApiKey(settings: Settings, provider: LlmProvider): string {

  switch (provider) {

    case 'anthropic':

      return settings.anthropic_api_key ?? '';

    case 'openai':

      return settings.openai_api_key ?? '';

    case 'openrouter':

      return settings.openrouter_api_key ?? '';

    default: {

      const _exhaustive: never = provider;

      return _exhaustive;

    }

  }

}



export { modelKey };


