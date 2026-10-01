import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AgentEventEnvelope, ApprovalDecision, Capabilities } from './agent-events';
import { isTauriRuntime } from './is-tauri';

const AGENT_EVENT_CHANNEL = 'agent://event';
const noopUnlisten: UnlistenFn = () => {};

/** Invoke payloads for Tauri commands that take a single `args` struct (snake_case fields). */
export function sessionSendPromptInvokePayload(paneId: string, text: string) {
  return {
    args: {
      pane_id: paneId,
      text,
    },
  };
}

export function sessionRespondApprovalInvokePayload(
  paneId: string,
  approvalId: string,
  decision: ApprovalDecision | string,
) {
  return {
    args: {
      pane_id: paneId,
      approval_id: approvalId,
      decision,
    },
  };
}

export async function sessionCapabilities(paneId: string): Promise<Capabilities> {
  if (!isTauriRuntime()) throw new Error('session_capabilities unavailable outside Tauri');
  return invoke<Capabilities>('session_capabilities', { paneId });
}

export async function sessionHistory(paneId: string): Promise<AgentEventEnvelope[]> {
  if (!isTauriRuntime()) return [];
  return invoke<AgentEventEnvelope[]>('session_history', { paneId });
}

export async function sessionSendPrompt(paneId: string, text: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke('session_send_prompt', sessionSendPromptInvokePayload(paneId, text));
}

export async function sessionRespondApproval(
  paneId: string,
  approvalId: string,
  decision: ApprovalDecision | string,
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke(
    'session_respond_approval',
    sessionRespondApprovalInvokePayload(paneId, approvalId, decision),
  );
}

export async function sessionAgentInfo(paneId: string): Promise<unknown> {
  if (!isTauriRuntime()) return null;
  return invoke<unknown>('session_agent_info', { paneId });
}

export async function sessionSetOption(paneId: string, key: string, value: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke('session_set_option', { args: { pane_id: paneId, key, value } });
}

export async function sessionCancelTurn(paneId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke('session_cancel_turn', { paneId });
}

/** Hand the Claude session to the terminal (the chat process stops); returns the terminal pane id. */
export async function sessionOpenInTui(paneId: string): Promise<string> {
  if (!isTauriRuntime()) throw new Error('session_open_in_tui unavailable outside Tauri');
  return invoke<string>('session_open_in_tui', { paneId });
}

/** Take the Claude session back from the terminal: the chat process resumes it. */
export async function sessionClaudeToChat(paneId: string, tuiPaneId?: string): Promise<void> {
  if (!isTauriRuntime()) throw new Error('session_claude_to_chat unavailable outside Tauri');
  await invoke('session_claude_to_chat', { paneId, tuiPaneId: tuiPaneId ?? null });
}

export function subscribeAgentEvents(
  onEnvelope: (envelope: AgentEventEnvelope) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) return Promise.resolve(noopUnlisten);
  return listen<AgentEventEnvelope>(AGENT_EVENT_CHANNEL, (ev) => {
    onEnvelope(ev.payload);
  });
}

/** Upper bound on retained raw envelopes per pane (oldest dropped first). */
export const MAX_ENVELOPE_LOG = 20000;

/**
 * Merge envelopes into an ordered, seq-deduplicated log. Returns the existing
 * array (same identity) when nothing new was added.
 */
export function mergeEnvelopeLog(
  existing: readonly AgentEventEnvelope[],
  incoming: readonly AgentEventEnvelope[],
  limit: number = MAX_ENVELOPE_LOG,
): readonly AgentEventEnvelope[] {
  if (incoming.length === 0) return existing;
  const seen = new Set<number>();
  for (const env of existing) seen.add(env.seq);
  const added: AgentEventEnvelope[] = [];
  for (const env of incoming) {
    if (seen.has(env.seq)) continue;
    seen.add(env.seq);
    added.push(env);
  }
  if (added.length === 0) return existing;
  const merged = [...existing, ...added].sort((a, b) => a.seq - b.seq);
  return merged.length > limit ? merged.slice(merged.length - limit) : merged;
}

export function isSessionCommandMissing(err: unknown): boolean {
  const msg = String(err);
  return (
    msg.includes('session_capabilities') ||
    msg.includes('not found') ||
    msg.includes('Unknown command') ||
    msg.includes('command not found')
  );
}
