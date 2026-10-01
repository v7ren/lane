import { describe, expect, it } from 'vitest';
import { composerFeaturesOpenCode } from './commands/agent';
import {
  CLAUDE_CAPABILITIES,
  CODEX_CAPABILITIES,
  NO_AGENT_CAPABILITIES,
  OPENCODE_CAPABILITIES,
  capabilitiesForAgentType,
  type AgentCapabilities,
} from './agent-capabilities';

const ALL: AgentCapabilities[] = [
  OPENCODE_CAPABILITIES,
  CODEX_CAPABILITIES,
  CLAUDE_CAPABILITIES,
  NO_AGENT_CAPABILITIES,
];

describe('agent capabilities', () => {
  it('every object is fully populated', () => {
    const keys = Object.keys(OPENCODE_CAPABILITIES).sort();
    for (const caps of ALL) {
      expect(Object.keys(caps).sort()).toEqual(keys);
      for (const [k, v] of Object.entries(caps)) {
        if (k === 'commands') continue;
        expect(typeof v).toBe('boolean');
      }
      expect(typeof caps.commands.prompt).toBe('boolean');
      expect(typeof caps.commands.terminalFallback).toBe('boolean');
      expect(Array.isArray(caps.commands.actions)).toBe(true);
    }
  });

  it('declares the initial command capabilities', () => {
    expect(CLAUDE_CAPABILITIES.questions).toBe(true);
    expect(CLAUDE_CAPABILITIES.commands.prompt).toBe(true);
    expect(CLAUDE_CAPABILITIES.commands.actions).toEqual([
      'model', 'mode', 'cost', 'context', 'new', 'resume', 'clear',
    ]);
    expect(CODEX_CAPABILITIES.commands.prompt).toBe(false);
    expect(OPENCODE_CAPABILITIES.commands.actions).toEqual([
      'model', 'cost', 'context', 'new', 'resume',
    ]);
    expect(NO_AGENT_CAPABILITIES.commands.actions).toEqual([]);
    for (const caps of ALL) {
      expect(caps.effort).toBe(false);
      expect(caps.contextBar).toBe(false);
    }
  });

  it('OpenCode matches todays composer feature set', () => {
    const f = composerFeaturesOpenCode();
    expect(OPENCODE_CAPABILITIES.fileMentions).toBe(f.mentions);
    expect(OPENCODE_CAPABILITIES.slashCommands).toBe(f.slashCommands);
    expect(OPENCODE_CAPABILITIES.shellMode).toBe(f.shellMode);
    expect(OPENCODE_CAPABILITIES.attachments).toBe(f.attach);
    expect(OPENCODE_CAPABILITIES.permissionModes).toBe(f.permissionPicker);
    expect(OPENCODE_CAPABILITIES.models).toBe(f.modelPicker);
    expect(OPENCODE_CAPABILITIES.abort).toBe(f.stop);
  });

  it('Codex and Claude do not advertise OpenCode-only composer features', () => {
    for (const caps of [CODEX_CAPABILITIES, CLAUDE_CAPABILITIES]) {
      expect(caps.fileMentions).toBe(false);
      expect(caps.slashCommands).toBe(false);
      expect(caps.shellMode).toBe(false);
      expect(caps.attachments).toBe(false);
      expect(caps.permissionModes).toBe(false);
      expect(caps.models).toBe(false);
    }
  });

  it('resolves by agent type', () => {
    expect(capabilitiesForAgentType('opencode_native')).toBe(OPENCODE_CAPABILITIES);
    expect(capabilitiesForAgentType('codex')).toBe(CODEX_CAPABILITIES);
    expect(capabilitiesForAgentType('claude_code')).toBe(CLAUDE_CAPABILITIES);
    expect(capabilitiesForAgentType('powershell')).toBe(NO_AGENT_CAPABILITIES);
    expect(capabilitiesForAgentType(null)).toBe(NO_AGENT_CAPABILITIES);
  });
});
