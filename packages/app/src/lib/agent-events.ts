export type ApprovalDecision = 'allow_once' | 'allow_always' | 'deny';

export type Capabilities = {
  chat: boolean;
  send_prompt: boolean;
  approvals: boolean;
  cancel: boolean;
  file_changes: boolean;
  attach_tui: boolean;
};

export type MessageContentKind = 'text' | 'reasoning';
export type MessageTextMode = 'append' | 'replace';

export type NoticeLevel = 'info' | 'warning' | 'error';
export type NoticeAction =
  | { kind: 'retry_chat' }
  | { kind: 'open_terminal' }
  | { kind: 'focus_terminal' }
  | { kind: 'back_to_chat' };
export type PlanStatus = 'pending' | 'in_progress' | 'done';
export type PlanItem = { text: string; status: PlanStatus };

export type ProtocolQuestion = {
  id?: string;
  header: string;
  question: string;
  options: { label: string; description?: string }[];
  multi_select: boolean;
  allow_other: boolean;
  secret: boolean;
};

export type ElicitationField = {
  name: string;
  title?: string;
  kind: 'string' | 'enum' | 'boolean' | 'number';
  options?: string[];
  required: boolean;
  secret?: boolean;
};

/** Structured approval body (spec 2.3). Tagged by `type`. */
export type ApprovalPayload =
  | { type: 'command'; command: string; cwd?: string; reason?: string }
  | {
      type: 'edit';
      path: string;
      edits?: { old_text: string; new_text: string }[];
      content?: string;
      patch?: string;
    }
  | { type: 'questions'; questions: ProtocolQuestion[]; auto_resolution_ms?: number }
  | { type: 'plan'; plan: string; plan_file_path?: string }
  | {
      type: 'elicitation';
      server_name: string;
      message: string;
      fields?: ElicitationField[];
    }
  | { type: 'permissions'; permissions: unknown; reason?: string };

export type AgentEvent =
  | { type: 'turn_started'; turn_id: string }
  | {
      type: 'message_delta';
      turn_id: string;
      message_id: string;
      role: 'assistant' | 'user';
      text: string;
      content_kind?: MessageContentKind;
      text_mode?: MessageTextMode;
    }
  | {
      type: 'message_completed';
      turn_id: string;
      message_id: string;
      role: 'assistant' | 'user';
      text: string;
      content_kind?: MessageContentKind;
      duration_ms?: number;
    }
  | {
      type: 'message_meta';
      turn_id: string;
      message_id: string;
      agent?: string;
      model?: string;
      provider?: string;
      duration_ms?: number;
    }
  | {
      type: 'tool_started';
      turn_id: string;
      tool_id: string;
      name: string;
      input_summary: string;
      tool_state?: string;
      title?: string;
    }
  | {
      type: 'tool_completed';
      turn_id: string;
      tool_id: string;
      status: 'ok' | 'error';
      output_summary: string;
      tool_state?: string;
      title?: string;
    }
  | {
      type: 'approval_requested';
      approval_id: string;
      title: string;
      detail: string;
      kind: 'command' | 'edit' | 'question' | 'plan' | 'other';
      options: ApprovalDecision[];
      payload?: ApprovalPayload;
    }
  | { type: 'approval_resolved'; approval_id: string; decision: ApprovalDecision }
  | { type: 'files_changed'; paths: string[] }
  | {
      type: 'usage';
      input_tokens?: number;
      output_tokens?: number;
      cost_usd?: number;
      context_tokens?: number;
      context_window?: number;
    }
  | { type: 'rate_limited'; retry_at_ms?: number; message: string }
  | {
      type: 'turn_completed';
      turn_id: string;
      status: 'ok' | 'cancelled' | 'error';
      error?: string;
    }
  | { type: 'error'; message: string }
  | {
      type: 'notice';
      id: string;
      level: NoticeLevel;
      text: string;
      source?: string;
      action?: NoticeAction;
      sticky?: boolean;
      cleared?: boolean;
    }
  | { type: 'plan_updated'; turn_id?: string; items: PlanItem[]; explanation?: string }
  | { type: 'tool_output_delta'; turn_id: string; tool_id: string; chunk: string };

export type AgentEventEnvelope = {
  pane_id: string;
  seq: number;
  event: AgentEvent;
  /** Hub registration this event belongs to; changes on re-register. */
  epoch?: number;
  /** Event came from history replay, not the live stream. */
  replayed?: boolean;
  /** Wall-clock ms when the hub committed it. */
  ts_ms?: number;
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
