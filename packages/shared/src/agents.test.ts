import { describe, expect, it } from 'vitest';
import {
  getDefaultTerminalAgentType,
  getPreset,
  listLaunchPresets,
  listPresets,
  type AgentCatalog,
} from './agents';

const fixtureCatalog: AgentCatalog = {
  agents: [
    {
      id: 'cmd',
      label: 'Command Prompt',
      description: 'Windows Command Prompt',
      icon: 'CMD',
      is_tui: true,
      command: 'cmd.exe',
      base_args: ['/K'],
      show_in_new_pane_menu: false,
      default_worker: false,
    },
    {
      id: 'opencode_native',
      label: 'OpenCode (API)',
      description: 'OpenCode API worker',
      icon: 'OC+',
      is_tui: true,
      command: 'opencode',
      base_args: [],
      show_in_new_pane_menu: true,
      default_worker: true,
      spawn_handler: 'opencode_native',
    },
    {
      id: 'claude',
      label: 'Claude Code',
      description: 'CLI',
      icon: 'CC',
      is_tui: true,
      command: 'claude',
      base_args: [],
      show_in_new_pane_menu: false,
      default_worker: false,
    },
  ],
  report: { errors: [] },
};

describe('agent catalog helpers', () => {
  it('includes cmd in the full preset list', () => {
    expect(listPresets(fixtureCatalog).map((preset) => preset.type)).toContain('cmd');
  });

  it('maps cmd preset fields from manifest summary', () => {
    const preset = getPreset(fixtureCatalog, 'cmd');
    expect(preset?.label).toBe('Command Prompt');
    expect(preset?.command).toBe('cmd.exe');
    expect(preset?.baseArgs).toEqual(['/K']);
  });

  it('only offers agents flagged for the new-pane menu', () => {
    expect(listLaunchPresets(fixtureCatalog).map((preset) => preset.type)).toEqual([
      'opencode_native',
    ]);
    expect(listLaunchPresets(fixtureCatalog)[0]?.label).toBe('OpenCode (API)');
  });

  it('defaults new workers to the manifest marked default_worker', () => {
    expect(getDefaultTerminalAgentType(fixtureCatalog)).toBe('opencode_native');
  });
});
