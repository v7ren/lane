/** User-owned shell PTY panes (not coding-agent sessions). */
const USER_SHELL_AGENT_TYPES = new Set([
  'powershell',
  'pwsh',
  'bash',
  'zsh',
  'cmd',
  'fish',
]);

export function isUserShellPane(agentType: string): boolean {
  return USER_SHELL_AGENT_TYPES.has(agentType);
}

export function isAgentSessionPane(agentType: string): boolean {
  return !isUserShellPane(agentType);
}
