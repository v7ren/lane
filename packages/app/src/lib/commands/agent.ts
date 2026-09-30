import type { Capabilities } from '../agent-events';
import { opencodeClient } from '../opencode/client.js';
import { getOpenCodeStore } from '../opencode/store.js';
import { findProjectFiles } from '../transcript/opencode-actions.js';
import type { CommandRegistry } from './index';

export type ComposerMode = 'chat' | 'shell';

export type PromptPart =
  | { type: 'text'; text: string }
  | { type: 'file'; mime: string; filename?: string; url: string };

export async function sendOpenCodePrompt(args: {
  paneId: string;
  sessionId: string;
  parts: PromptPart[];
  messageId: string;
  agent?: string;
  model?: { providerID: string; modelID: string };
}) {
  getOpenCodeStore(args.paneId).markSessionOptimisticBusy(args.sessionId);
  await opencodeClient.promptAsync(args.paneId, args.sessionId, {
    messageID: args.messageId,
    parts: args.parts,
    agent: args.agent,
    model: args.model,
  });
}

export async function sendOpenCodeShell(args: {
  paneId: string;
  sessionId: string;
  command: string;
}) {
  await opencodeClient.sessionShell(args.paneId, args.sessionId, { command: args.command });
}

export async function sendOpenCodeSlashCommand(args: {
  paneId: string;
  sessionId: string;
  name: string;
  args?: string;
}) {
  await opencodeClient.sessionCommand(args.paneId, args.sessionId, {
    name: args.name,
    arguments: args.args,
  });
}

export async function abortOpenCodeSession(paneId: string, sessionId: string) {
  await opencodeClient.abortSession(paneId, sessionId);
}

export async function replyOpenCodePermission(
  paneId: string,
  requestId: string,
  reply: 'once' | 'always' | 'reject',
) {
  await opencodeClient.replyPermission(paneId, requestId, { reply });
}

export async function replyOpenCodeQuestion(paneId: string, requestId: string, answer: string) {
  await opencodeClient.replyQuestion(paneId, requestId, { answer });
}

export async function rejectOpenCodeQuestion(paneId: string, requestId: string) {
  await opencodeClient.rejectQuestion(paneId, requestId, {});
}

export async function searchMentionFiles(paneId: string, query: string) {
  try {
    return await findProjectFiles(paneId, query, 12);
  } catch {
    return [];
  }
}

export function composerFeaturesForCapabilities(caps: Capabilities) {
  return {
    attach: caps.send_prompt,
    agentPicker: false,
    modelPicker: false,
    permissionPicker: caps.approvals,
    mentions: caps.send_prompt,
    slashCommands: caps.send_prompt,
    shellMode: caps.send_prompt,
    stop: caps.cancel,
    send: caps.send_prompt,
  };
}

export function composerFeaturesOpenCode() {
  return {
    attach: true,
    agentPicker: true,
    modelPicker: true,
    permissionPicker: true,
    mentions: true,
    slashCommands: true,
    shellMode: true,
    stop: true,
    send: true,
  };
}

/** Agent-scoped palette commands (filled when wiring editor/agent palette deps). */
export function registerAgentCommands(_registry: CommandRegistry): void {}
