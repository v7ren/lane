import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AgentEventEnvelope, ApprovalDecision, Capabilities } from './agent-events';
import { isTauriRuntime } from './is-tauri';

const AGENT_EVENT_CHANNEL = 'agent://event';
const noopUnlisten: UnlistenFn = () => {};

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
  await invoke('session_send_prompt', { args: { paneId, text } });
}

export async function sessionRespondApproval(
  paneId: string,
  approvalId: string,
  decision: ApprovalDecision,
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke('session_respond_approval', { args: { paneId, approvalId, decision } });
}

export async function sessionCancelTurn(paneId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke('session_cancel_turn', { paneId });
}

export async function sessionOpenInTui(paneId: string): Promise<string> {
  if (!isTauriRuntime()) throw new Error('session_open_in_tui unavailable outside Tauri');
  return invoke<string>('session_open_in_tui', { paneId });
}

export function subscribeAgentEvents(
  onEnvelope: (envelope: AgentEventEnvelope) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) return Promise.resolve(noopUnlisten);
  return listen<AgentEventEnvelope>(AGENT_EVENT_CHANNEL, (ev) => {
    onEnvelope(ev.payload);
  });
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
