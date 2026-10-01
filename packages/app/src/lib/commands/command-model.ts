import type { AgentCapabilities, AgentFamily } from '../agent-capabilities';

export type CommandKind = 'prompt' | 'action' | 'terminal';
export type LoomriaActionId =
  | 'model'
  | 'mode'
  | 'effort'
  | 'clear'
  | 'compact'
  | 'cost'
  | 'context'
  | 'new'
  | 'resume'
  | 'fork';
export type CommandRun =
  /** prompt: send "/name args" as a user message. */
  | { type: 'send' }
  /** Loomria handles it; no model call unless the action says so. */
  | { type: 'action'; action: LoomriaActionId }
  /** Needs the TUI; offer "Open in terminal". */
  | { type: 'terminal' };

export type Command = {
  /** `${source}:${name}` */
  id: string;
  /** Without the leading slash. */
  name: string;
  description?: string;
  argumentHint?: string;
  kind: CommandKind;
  source: 'agent' | 'loomria';
  /** Opens a second list instead of taking free text. */
  choices?: 'model' | 'mode' | 'effort' | 'past_chats';
  run: CommandRun;
};

/** Claude built-ins that only work in the interactive TUI. */
export const CLAUDE_TUI_ONLY: readonly string[] = [
  'config',
  'login',
  'logout',
  'doctor',
  'ide',
  'terminal-setup',
  'vim',
  'permissions',
  'agents',
  'mcp',
  'hooks',
  'memory',
  'status',
  'upgrade',
  'bug',
  'release-notes',
  'export',
  'add-dir',
  'statusline',
  'output-style',
  'install-github-app',
  'privacy-settings',
];

/** Built-ins verified to work as plain prompts over stream-json (filled by spike S7). */
export const CLAUDE_VERIFIED_PASSTHROUGH: readonly string[] = [];

type ActionDef = {
  description: string;
  argumentHint?: string;
  choices?: Command['choices'];
};

const ACTION_DEFS: Record<LoomriaActionId, ActionDef> = {
  model: { description: 'Change the model', argumentHint: '[model]', choices: 'model' },
  mode: { description: 'Change the permission mode', argumentHint: '[mode]', choices: 'mode' },
  effort: { description: 'Set the reasoning effort', argumentHint: '[level]', choices: 'effort' },
  clear: { description: 'Start a new chat in this pane' },
  compact: { description: 'Summarize the conversation to free context' },
  cost: { description: 'Show session cost and token usage' },
  context: { description: 'Show context window usage' },
  new: { description: 'Open a new pane for this agent' },
  resume: { description: 'Resume a past chat', choices: 'past_chats' },
  fork: { description: 'Fork the current chat' },
};

export function buildCommandList(input: {
  family: AgentFamily;
  caps: AgentCapabilities['commands'];
  agentCommands: { name: string; description?: string; argumentHint?: string }[];
}): Command[] {
  const { family, caps, agentCommands } = input;
  const out: Command[] = [];
  const seen = new Set<string>();
  const actionIds = new Set<string>(caps.actions);

  for (const action of caps.actions) {
    if (seen.has(action)) continue;
    seen.add(action);
    const def = ACTION_DEFS[action];
    out.push({
      id: `loomria:${action}`,
      name: action,
      description: def.description,
      ...(def.argumentHint ? { argumentHint: def.argumentHint } : {}),
      kind: 'action',
      source: 'loomria',
      ...(def.choices ? { choices: def.choices } : {}),
      run: { type: 'action', action },
    });
  }

  for (const raw of agentCommands) {
    const name = raw.name.replace(/^\/+/, '');
    if (!name || actionIds.has(name) || seen.has(name)) continue;
    seen.add(name);
    const tuiOnly =
      family === 'claude' &&
      CLAUDE_TUI_ONLY.includes(name) &&
      !CLAUDE_VERIFIED_PASSTHROUGH.includes(name);
    const kind: CommandKind = tuiOnly ? 'terminal' : 'prompt';
    if (kind === 'terminal' && !caps.terminalFallback) continue;
    if (kind === 'prompt' && !caps.prompt) continue;
    out.push({
      id: `agent:${name}`,
      name,
      ...(raw.description ? { description: raw.description } : {}),
      ...(raw.argumentHint ? { argumentHint: raw.argumentHint } : {}),
      kind,
      source: 'agent',
      run: tuiOnly ? { type: 'terminal' } : { type: 'send' },
    });
  }
  return out;
}

/** Null unless the text starts with "/" (and not "//"). */
export function parseSlashInput(text: string): { name: string; args: string } | null {
  if (!text.startsWith('/') || text.startsWith('//')) return null;
  const m = /^\/(\S*)(?:\s+([\s\S]*))?$/.exec(text);
  if (!m) return null;
  return { name: m[1] ?? '', args: (m[2] ?? '').trim() };
}

export function resolveSubmit(
  text: string,
  commands: Command[],
):
  | { kind: 'plain'; text: string }
  | { kind: 'command'; command: Command; args: string }
  | { kind: 'unknown'; name: string } {
  if (text.startsWith('//')) return { kind: 'plain', text: text.slice(1) };
  const parsed = parseSlashInput(text);
  if (!parsed) return { kind: 'plain', text };
  const command = commands.find((c) => c.name === parsed.name);
  if (!command) return { kind: 'unknown', name: parsed.name };
  return { kind: 'command', command, args: parsed.args };
}
