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
  { id: 'mcp', label: 'MCP', implemented: true },
  { id: 'config', label: 'Config', implemented: true },
  { id: 'theme', label: 'Theme', implemented: true },
  { id: 'keybinds', label: 'Keybinds', implemented: true },
  { id: 'agents', label: 'Agents', implemented: true },
];
