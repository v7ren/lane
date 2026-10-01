import type { AgentEvent, AgentEventEnvelope, ApprovalDecision } from './agent-events';

export type TimelineMessage = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  streaming: boolean;
  reasoning?: string;
  reasoningStreaming?: boolean;
  reasoningDurationMs?: number;
  agent?: string;
  model?: string;
  provider?: string;
  durationMs?: number;
  headerLine?: string;
  turnUsage?: { input_tokens?: number; output_tokens?: number; cost_usd?: number };
};

export type TimelineTool = {
  id: string;
  name: string;
  inputSummary: string;
  status?: 'pending' | 'running' | 'ok' | 'error';
  outputSummary?: string;
  toolState?: string;
  title?: string;
};

export type TimelineApproval = {
  id: string;
  title: string;
  detail: string;
  kind: 'command' | 'edit' | 'question' | 'plan' | 'other';
  options: ApprovalDecision[];
  resolved?: ApprovalDecision;
};

export type AgentTimelineViewModel = {
  messages: TimelineMessage[];
  tools: TimelineTool[];
  approvals: TimelineApproval[];
  pendingApprovals: TimelineApproval[];
  filePaths: string[];
  usage?: { input_tokens?: number; output_tokens?: number; cost_usd?: number };
  rateLimit?: { message: string; retry_at_ms?: number };
  turnActive: boolean;
  lastError?: string;
  maxSeq: number;
};

export function emptyTimelineViewModel(): AgentTimelineViewModel {
  return {
    messages: [],
    tools: [],
    approvals: [],
    pendingApprovals: [],
    filePaths: [],
    turnActive: false,
    maxSeq: -1,
  };
}

function formatHeaderLine(message: TimelineMessage): string | undefined {
  if (message.role !== 'assistant') return undefined;
  const parts: string[] = [];
  if (message.agent) {
    parts.push(capitalize(message.agent));
  }
  if (message.model) {
    parts.push(message.model);
  }
  if (message.durationMs != null) {
    parts.push(formatDuration(message.durationMs));
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`;
  }
  return `${Math.round(seconds)}s`;
}

function upsertMessage(messages: TimelineMessage[], next: TimelineMessage): TimelineMessage[] {
  const idx = messages.findIndex((m) => m.id === next.id);
  const merged: TimelineMessage = {
    ...(idx === -1 ? {} : messages[idx]),
    ...next,
    headerLine: formatHeaderLine({ ...(idx === -1 ? next : messages[idx]), ...next }),
  };
  if (idx === -1) {
    return [...messages, merged];
  }
  const out = messages.slice();
  out[idx] = merged;
  return out;
}

function findMessage(messages: TimelineMessage[], id: string): TimelineMessage | undefined {
  return messages.find((m) => m.id === id);
}

function applyTextDelta(
  messages: TimelineMessage[],
  messageId: string,
  role: 'assistant' | 'user',
  delta: string,
  mode: 'append' | 'replace',
  kind: 'text' | 'reasoning',
): TimelineMessage[] {
  const existing = findMessage(messages, messageId);
  const base: TimelineMessage = existing ?? {
    id: messageId,
    role,
    text: '',
    streaming: true,
  };
  if (kind === 'reasoning') {
    const prev = base.reasoning ?? '';
    const reasoning = mode === 'replace' ? delta : prev + delta;
    return upsertMessage(messages, {
      ...base,
      role,
      reasoning,
      reasoningStreaming: true,
    });
  }
  const prev = base.text ?? '';
  const text = mode === 'replace' ? delta : prev + delta;
  return upsertMessage(messages, {
    ...base,
    role,
    text,
    streaming: true,
  });
}

function finalizeStreamingMessages(messages: TimelineMessage[]): TimelineMessage[] {
  return messages.map((m) =>
    m.streaming || m.reasoningStreaming
      ? { ...m, streaming: false, reasoningStreaming: false }
      : m,
  );
}

function mapToolPhase(state?: string): TimelineTool['status'] {
  if (!state) return 'running';
  const lower = state.toLowerCase();
  if (lower === 'pending' || lower === 'waiting') return 'pending';
  if (lower === 'running') return 'running';
  if (lower.includes('error') || lower.includes('fail')) return 'error';
  if (lower === 'completed' || lower === 'done' || lower === 'success') return 'ok';
  return 'running';
}

function applyEvent(vm: AgentTimelineViewModel, event: AgentEvent): AgentTimelineViewModel {
  switch (event.type) {
    case 'turn_started':
      return { ...vm, turnActive: true };
    case 'message_delta': {
      const kind = event.content_kind ?? 'text';
      const mode = event.text_mode ?? 'append';
      return {
        ...vm,
        messages: applyTextDelta(vm.messages, event.message_id, event.role, event.text, mode, kind),
      };
    }
    case 'message_completed': {
      const kind = event.content_kind ?? 'text';
      const existing = findMessage(vm.messages, event.message_id);
      const base: TimelineMessage = existing ?? {
        id: event.message_id,
        role: event.role,
        text: '',
        streaming: false,
      };
      if (kind === 'reasoning') {
        return {
          ...vm,
          messages: upsertMessage(vm.messages, {
            ...base,
            role: event.role,
            reasoning: event.text,
            reasoningStreaming: false,
            reasoningDurationMs: event.duration_ms ?? base.reasoningDurationMs,
          }),
        };
      }
      return {
        ...vm,
        messages: upsertMessage(vm.messages, {
          ...base,
          role: event.role,
          text: event.text,
          streaming: false,
        }),
      };
    }
    case 'message_meta': {
      const existing = findMessage(vm.messages, event.message_id);
      const base: TimelineMessage = existing ?? {
        id: event.message_id,
        role: 'assistant',
        text: '',
        streaming: true,
      };
      return {
        ...vm,
        messages: upsertMessage(vm.messages, {
          ...base,
          agent: event.agent ?? base.agent,
          model: event.model ?? base.model,
          provider: event.provider ?? base.provider,
          durationMs: event.duration_ms ?? base.durationMs,
        }),
      };
    }
    case 'tool_started': {
      const tools = vm.tools.filter((t) => t.id !== event.tool_id);
      tools.push({
        id: event.tool_id,
        name: event.name,
        inputSummary: event.input_summary,
        status: mapToolPhase(event.tool_state),
        toolState: event.tool_state,
        title: event.title,
      });
      return { ...vm, tools };
    }
    case 'tool_completed': {
      const tools: TimelineTool[] = vm.tools.map((t) =>
        t.id === event.tool_id
          ? {
              ...t,
              status: event.status === 'ok' ? ('ok' as const) : ('error' as const),
              outputSummary: event.output_summary,
              toolState: event.tool_state ?? t.toolState,
              title: event.title ?? t.title,
            }
          : t,
      );
      if (!tools.some((t) => t.id === event.tool_id)) {
        tools.push({
          id: event.tool_id,
          name: event.title ?? 'tool',
          inputSummary: '',
          status: event.status === 'ok' ? 'ok' : 'error',
          outputSummary: event.output_summary,
          toolState: event.tool_state,
          title: event.title,
        });
      }
      return { ...vm, tools };
    }
    case 'approval_requested': {
      const approval: TimelineApproval = {
        id: event.approval_id,
        title: event.title,
        detail: event.detail,
        kind: event.kind,
        options: event.options,
      };
      const approvals = [...vm.approvals.filter((a) => a.id !== event.approval_id), approval];
      return {
        ...vm,
        approvals,
        pendingApprovals: approvals.filter((a) => !a.resolved),
      };
    }
    case 'approval_resolved': {
      const approvals = vm.approvals.map((a) =>
        a.id === event.approval_id ? { ...a, resolved: event.decision } : a,
      );
      return {
        ...vm,
        approvals,
        pendingApprovals: approvals.filter((a) => !a.resolved),
      };
    }
    case 'files_changed':
      return { ...vm, filePaths: [...new Set([...vm.filePaths, ...event.paths])] };
    case 'usage': {
      const usage = { ...vm.usage, ...event };
      let lastAssistantIdx = -1;
      for (let i = vm.messages.length - 1; i >= 0; i -= 1) {
        if (vm.messages[i]?.role === 'assistant') {
          lastAssistantIdx = i;
          break;
        }
      }
      const messages = vm.messages.map((m, idx) =>
        idx === lastAssistantIdx ? { ...m, turnUsage: usage } : m,
      );
      return { ...vm, usage, messages };
    }
    case 'rate_limited':
      return { ...vm, rateLimit: { message: event.message, retry_at_ms: event.retry_at_ms } };
    case 'turn_completed':
      return {
        ...vm,
        turnActive: false,
        messages: finalizeStreamingMessages(vm.messages),
        lastError: event.status === 'error' ? event.error ?? 'Turn failed' : vm.lastError,
      };
    case 'error':
      return { ...vm, lastError: event.message };
    default: {
      const _never: never = event;
      return _never;
    }
  }
}

export function mergeAgentEventEnvelopes(
  existing: AgentTimelineViewModel,
  envelopes: AgentEventEnvelope[],
): AgentTimelineViewModel {
  const sorted = [...envelopes].sort((a, b) => a.seq - b.seq);
  let vm = existing;
  for (const env of sorted) {
    if (env.seq <= vm.maxSeq) continue;
    vm = applyEvent(vm, env.event);
    vm = { ...vm, maxSeq: env.seq };
  }
  return vm;
}

export function reduceAgentTimeline(
  history: AgentEventEnvelope[],
  live: AgentEventEnvelope[],
): AgentTimelineViewModel {
  return mergeAgentEventEnvelopes(emptyTimelineViewModel(), [...history, ...live]);
}
