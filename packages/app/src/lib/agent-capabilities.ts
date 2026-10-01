/**
 * Static, per-agent declaration of what the composer and session chrome may offer.
 * Flags flip to true only as the matching adapter features land, so the UI never
 * advertises unmapped behavior. Values follow docs/phase7-recon.md section 6.
 */
export type AgentCapabilities = {
  /** Model picker and per-session model selection. */
  models: boolean;
  /** Allow/Ask permission-mode pill. */
  permissionModes: boolean;
  /** `/command` picker and slash submit path. */
  slashCommands: boolean;
  /** `@file` mention picker. */
  fileMentions: boolean;
  /** `!cmd` shell mode. */
  shellMode: boolean;
  /** Image/file attachments. */
  attachments: boolean;
  /** Stop/abort the running turn from the composer. */
  abort: boolean;
  fork: boolean;
  revert: boolean;
  /** Show/hide TUI toggle. */
  tuiToggle: boolean;
  /** Agent-initiated multi-choice questions. */
  questions: boolean;
  /** Interactive approvals. */
  permissions: boolean;
};

export const OPENCODE_CAPABILITIES: AgentCapabilities = {
  models: true,
  permissionModes: true,
  slashCommands: true,
  fileMentions: true,
  shellMode: true,
  attachments: true,
  abort: true,
  fork: true,
  revert: true,
  tuiToggle: true,
  questions: true,
  permissions: true,
};

export const CODEX_CAPABILITIES: AgentCapabilities = {
  models: false,
  permissionModes: false,
  slashCommands: false,
  fileMentions: false,
  shellMode: false,
  attachments: false,
  abort: true,
  fork: false,
  revert: false,
  tuiToggle: true,
  questions: false,
  permissions: true,
};

export const CLAUDE_CAPABILITIES: AgentCapabilities = {
  models: false,
  permissionModes: false,
  slashCommands: false,
  fileMentions: false,
  shellMode: false,
  attachments: false,
  abort: true,
  fork: false,
  revert: false,
  tuiToggle: true,
  questions: false,
  permissions: true,
};

/** Unknown agents get nothing beyond plain text send. */
export const NO_AGENT_CAPABILITIES: AgentCapabilities = {
  models: false,
  permissionModes: false,
  slashCommands: false,
  fileMentions: false,
  shellMode: false,
  attachments: false,
  abort: false,
  fork: false,
  revert: false,
  tuiToggle: false,
  questions: false,
  permissions: false,
};

export type AgentFamily = 'opencode' | 'codex' | 'claude' | 'other';

export function agentFamily(agentType: string | null | undefined): AgentFamily {
  switch (agentType) {
    case 'opencode':
    case 'opencode_native':
      return 'opencode';
    case 'codex':
    case 'codex_cli':
      return 'codex';
    case 'claude':
    case 'claude_code':
      return 'claude';
    default:
      return 'other';
  }
}

export function capabilitiesForAgentType(agentType: string | null | undefined): AgentCapabilities {
  const family = agentFamily(agentType);
  switch (family) {
    case 'opencode':
      return OPENCODE_CAPABILITIES;
    case 'codex':
      return CODEX_CAPABILITIES;
    case 'claude':
      return CLAUDE_CAPABILITIES;
    case 'other':
      return NO_AGENT_CAPABILITIES;
    default: {
      const unreachable: never = family;
      return unreachable;
    }
  }
}
