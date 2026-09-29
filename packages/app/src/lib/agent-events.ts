export type ApprovalDecision = 'allow_once' | 'allow_always' | 'deny';

export type Capabilities = {
  chat: boolean;
  send_prompt: boolean;
  approvals: boolean;
  cancel: boolean;
  file_changes: boolean;
  attach_tui: boolean;
};

export type AgentEvent =
  | { type: 'turn_started'; turn_id: string }
  | {
      type: 'message_delta';
      turn_id: string;
      message_id: string;
      role: 'assistant' | 'user';
      text: string;
    }
  | {
      type: 'message_completed';
      turn_id: string;
      message_id: string;
      role: 'assistant' | 'user';
      text: string;
    }
  | {
      type: 'tool_started';
      turn_id: string;
      tool_id: string;
      name: string;
      input_summary: string;
    }
  | {
      type: 'tool_completed';
      turn_id: string;
      tool_id: string;
      status: 'ok' | 'error';
      output_summary: string;
    }
  | {
      type: 'approval_requested';
      approval_id: string;
      title: string;
      detail: string;
      kind: 'command' | 'edit' | 'other';
      options: ApprovalDecision[];
    }
  | { type: 'approval_resolved'; approval_id: string; decision: ApprovalDecision }
  | { type: 'files_changed'; paths: string[] }
  | {
      type: 'usage';
      input_tokens?: number;
      output_tokens?: number;
      cost_usd?: number;
    }
  | { type: 'rate_limited'; retry_at_ms?: number; message: string }
  | {
      type: 'turn_completed';
      turn_id: string;
      status: 'ok' | 'cancelled' | 'error';
      error?: string;
    }
  | { type: 'error'; message: string };

export type AgentEventEnvelope = {
  pane_id: string;
  seq: number;
  event: AgentEvent;
};

export function capabilitiesNativeTuiOnly(): Capabilities {
  return {
    chat: false,
    send_prompt: false,
    approvals: false,
    cancel: false,
    file_changes: false,
    attach_tui: true,
  };
}
