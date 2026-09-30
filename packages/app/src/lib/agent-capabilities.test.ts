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
  it('every object is fully populated with booleans', () => {
    const keys = Object.keys(OPENCODE_CAPABILITIES).sort();
    for (const caps of ALL) {
      expect(Object.keys(caps).sort()).toEqual(keys);
      for (const v of Object.values(caps)) expect(typeof v).toBe('boolean');
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
