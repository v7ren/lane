import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AgentEventEnvelope, ApprovalDecision, Capabilities } from './agent-events';

const AGENT_EVENT_CHANNEL = 'agent://event';

export async function sessionCapabilities(paneId: string): Promise<Capabilities> {
  return invoke<Capabilities>('session_capabilities', { paneId });
}

export async function sessionHistory(paneId: string): Promise<AgentEventEnvelope[]> {
  return invoke<AgentEventEnvelope[]>('session_history', { paneId });
}

export async function sessionSendPrompt(paneId: string, text: string): Promise<void> {
  await invoke('session_send_prompt', { paneId, text });
}

export async function sessionRespondApproval(
  paneId: string,
  approvalId: string,
  decision: ApprovalDecision,
): Promise<void> {
  await invoke('session_respond_approval', { paneId, approvalId, decision });
}

export async function sessionCancelTurn(paneId: string): Promise<void> {
  await invoke('session_cancel_turn', { paneId });
}

export function subscribeAgentEvents(
  onEnvelope: (envelope: AgentEventEnvelope) => void,
): Promise<() => void> {
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
