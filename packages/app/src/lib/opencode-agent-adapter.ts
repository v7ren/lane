import type { AgentEvent, AgentEventEnvelope, Capabilities } from './agent-events';
import type { OpenCodePermission, SessionMessagesView } from './opencode-chat';
import { flattenMessageText } from './opencode-chat';

export function opencodeCapabilities(): Capabilities {
  return {
    chat: true,
    send_prompt: true,
    approvals: true,
    cancel: false,
    file_changes: false,
    attach_tui: true,
  };
}

/** Adapts polled OpenCode chat data into AgentEvent envelopes (fallback until session_* exists). */
export function opencodeViewToEnvelopes(
  paneId: string,
  view: SessionMessagesView | null,
  permissions: OpenCodePermission[],
  seqStart = 1,
): AgentEventEnvelope[] {
  const out: AgentEventEnvelope[] = [];
  let seq = seqStart;
  if (!view) return out;

  for (const message of view.messages) {
    const text = flattenMessageText(message);
    if (!text) continue;
    const role = message.role.toLowerCase() === 'user' ? 'user' : 'assistant';
    const messageId = message.id ?? `msg-${seq}`;
    const event: AgentEvent = {
      type: 'message_completed',
      turn_id: view.session_id,
      message_id: messageId,
      role,
      text,
    };
    out.push({ pane_id: paneId, seq: seq++, event });
  }

  if (view.pending_question) {
    out.push({
      pane_id: paneId,
      seq: seq++,
      event: {
        type: 'approval_requested',
        approval_id: view.pending_question.request_id ?? `q-${seq}`,
        title: 'Agent question',
        detail: view.pending_question.question,
        kind: 'other',
        options: ['allow_once', 'deny'],
      },
    });
  }

  for (const perm of permissions) {
    out.push({
      pane_id: paneId,
      seq: seq++,
      event: {
        type: 'approval_requested',
        approval_id: perm.id,
        title: 'Permission required',
        detail: perm.id,
        kind: 'command',
        options: ['allow_once', 'allow_always', 'deny'],
      },
    });
  }

  return out;
}
