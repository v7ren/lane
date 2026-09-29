import type { AgentEvent, AgentEventEnvelope, ApprovalDecision } from './agent-events';

export type TimelineMessage = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  streaming: boolean;
};

export type TimelineTool = {
  id: string;
  name: string;
  inputSummary: string;
  status?: 'running' | 'ok' | 'error';
  outputSummary?: string;
};

export type TimelineApproval = {
  id: string;
  title: string;
  detail: string;
  kind: 'command' | 'edit' | 'other';
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

function upsertMessage(
  messages: TimelineMessage[],
  id: string,
  role: 'assistant' | 'user',
  text: string,
  streaming: boolean,
): TimelineMessage[] {
  const idx = messages.findIndex((m) => m.id === id);
  if (idx === -1) {
    return [...messages, { id, role, text, streaming }];
  }
  const next = messages.slice();
  next[idx] = { id, role, text, streaming };
  return next;
}

function applyEvent(vm: AgentTimelineViewModel, event: AgentEvent): AgentTimelineViewModel {
  switch (event.type) {
    case 'turn_started':
      return { ...vm, turnActive: true };
    case 'message_delta':
      return {
        ...vm,
        messages: upsertMessage(
          vm.messages,
          event.message_id,
          event.role,
          (vm.messages.find((m) => m.id === event.message_id)?.text ?? '') + event.text,
          true,
        ),
      };
    case 'message_completed':
      return {
        ...vm,
        messages: upsertMessage(vm.messages, event.message_id, event.role, event.text, false),
      };
    case 'tool_started': {
      const tools = vm.tools.filter((t) => t.id !== event.tool_id);
      tools.push({
        id: event.tool_id,
        name: event.name,
        inputSummary: event.input_summary,
        status: 'running',
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
            }
          : t,
      );
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
    case 'usage':
      return { ...vm, usage: { ...vm.usage, ...event } };
    case 'rate_limited':
      return { ...vm, rateLimit: { message: event.message, retry_at_ms: event.retry_at_ms } };
    case 'turn_completed':
      return {
        ...vm,
        turnActive: false,
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
