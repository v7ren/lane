export type SettingsSectionId =
  | 'general'
  | 'providers'
  | 'mcp'
  | 'config'
  | 'theme'
  | 'keybinds'
  | 'agents';

export interface SettingsSectionDef {
  id: SettingsSectionId;
  label: string;
  implemented: boolean;
}

export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  { id: 'general', label: 'General', implemented: true },
  { id: 'providers', label: 'Providers', implemented: true },
  { id: 'mcp', label: 'MCP', implemented: false },
  { id: 'config', label: 'Config', implemented: false },
  { id: 'theme', label: 'Theme', implemented: false },
  { id: 'keybinds', label: 'Keybinds', implemented: false },
  { id: 'agents', label: 'Agents', implemented: true },
];
