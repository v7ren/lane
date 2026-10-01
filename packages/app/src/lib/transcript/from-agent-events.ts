import type { AgentEvent, AgentEventEnvelope } from '../agent-events.js';
import type { AgentTimelineViewModel } from '../agent-timeline-reducer.js';
import { mapAgentToolStatus, normalizeToolPayload } from './tool-mapping.js';
import {
  flattenTranscriptTurns,
  type AssistantMessageMeta,
  type TranscriptItem,
  type TranscriptNotice,
  type TranscriptTurn,
  type TranscriptViewModel,
} from './types.js';

type TurnBuilder = {
  id: string;
  role: 'user' | 'assistant';
  items: TranscriptItem[];
  meta: AssistantMessageMeta;
  messageIds: Set<string>;
};

type ToolRecord = {
  builderKey: string;
  name: string;
  rawInput: string;
};

type BuildState = {
  builders: Map<string, TurnBuilder>;
  order: string[];
  tools: Map<string, ToolRecord>;
  globalFilePaths: string[];
  turnActive: boolean;
  lastError?: string;
  rateLimit?: TranscriptViewModel['rateLimit'];
  errorSeq: number;
  stickyNotices: Map<string, TranscriptNotice>;
};

function emptyTurn(id: string, role: 'user' | 'assistant'): TurnBuilder {
  return {
    id,
    role,
    items: [],
    meta: {},
    messageIds: new Set(),
  };
}

function userKey(messageId: string): string {
  return `user:${messageId}`;
}

function getOrCreateBuilder(
  state: BuildState,
  key: string,
  id: string,
  role: 'user' | 'assistant',
): TurnBuilder {
  const existing = state.builders.get(key);
  if (existing) return existing;
  const created = emptyTurn(id, role);
  state.builders.set(key, created);
  state.order.push(key);
  return created;
}

/** Assistant turns are keyed by turn_id and created lazily so they order after the user prompt. */
function assistantBuilder(state: BuildState, turnId: string): TurnBuilder {
  return getOrCreateBuilder(state, turnId, turnId, 'assistant');
}

const NOTICE_PREFIX = 'notice:';

function lastAssistantBuilder(state: BuildState): TurnBuilder | undefined {
  for (let i = state.order.length - 1; i >= 0; i -= 1) {
    const key = state.order[i]!;
    if (key.startsWith(NOTICE_PREFIX)) continue;
    const tb = state.builders.get(key);
    if (tb?.role === 'assistant') return tb;
  }
  return undefined;
}

function upsertUserPrompt(
  state: BuildState,
  messageId: string,
  text: string,
  mode: 'append' | 'replace',
) {
  const tb = getOrCreateBuilder(state, userKey(messageId), messageId, 'user');
  tb.messageIds.add(messageId);
  const prompt = tb.items.find((i) => i.kind === 'user_prompt');
  if (prompt?.kind === 'user_prompt') {
    prompt.text = mode === 'replace' ? text : prompt.text + text;
    return;
  }
  tb.items.push({
    kind: 'user_prompt',
    id: messageId,
    text,
    files: [],
    collapsedDefault: true,
  });
}

function upsertAssistantText(turn: TurnBuilder, messageId: string, text: string, streaming: boolean) {
  const existing = turn.items.find(
    (i) => i.kind === 'assistant_text' && i.id.startsWith(messageId),
  );
  if (existing?.kind === 'assistant_text') {
    existing.markdown = text;
    existing.streaming = streaming;
    return;
  }
  turn.items.push({
    kind: 'assistant_text',
    id: `${messageId}-text`,
    markdown: text,
    streaming,
  });
}

function upsertReasoning(
  turn: TurnBuilder,
  messageId: string,
  text: string,
  streaming: boolean,
  durationMs?: number,
) {
  const existing = turn.items.find((i) => i.kind === 'reasoning' && i.id.startsWith(messageId));
  if (existing?.kind === 'reasoning') {
    existing.text = text;
    existing.streaming = streaming;
    if (durationMs != null) existing.durationMs = durationMs;
    return;
  }
  turn.items.push({
    kind: 'reasoning',
    id: `${messageId}-reason`,
    text,
    streaming,
    durationMs,
  });
}

function pushError(tb: TurnBuilder, id: string, message: string) {
  if (tb.items.some((i) => i.kind === 'error' && i.message === message)) return;
  tb.items.push({ kind: 'error', id, message });
}

function finalizeStreaming(state: BuildState) {
  for (const tb of state.builders.values()) {
    for (const item of tb.items) {
      if (item.kind === 'assistant_text' || item.kind === 'reasoning') {
        item.streaming = false;
      }
    }
  }
}

function mapToolPhase(state?: string): 'pending' | 'running' | 'ok' | 'error' | undefined {
  if (!state) return 'running';
  const lower = state.toLowerCase();
  if (lower === 'pending' || lower === 'waiting') return 'pending';
  if (lower === 'running') return 'running';
  if (lower.includes('error') || lower.includes('fail')) return 'error';
  if (lower === 'completed' || lower === 'done' || lower === 'success') return 'ok';
  return 'running';
}

function applyNotice(state: BuildState, event: Extract<AgentEvent, { type: 'notice' }>): void {
  const key = `${NOTICE_PREFIX}${event.id}`;
  const row = state.builders.get(key);
  if (event.cleared) {
    state.stickyNotices.delete(event.id);
    if (row) row.items = [];
    return;
  }
  const notice: TranscriptNotice = {
    kind: 'notice',
    id: event.id,
    level: event.level,
    text: event.text,
    ...(event.action ? { action: event.action } : {}),
  };
  if (event.sticky === true) {
    if (row) row.items = [];
    state.stickyNotices.set(event.id, notice);
    return;
  }
  state.stickyNotices.delete(event.id);
  const tb = getOrCreateBuilder(state, key, key, 'assistant');
  tb.items = [notice];
}

function applyEvent(state: BuildState, event: AgentEvent, env?: AgentEventEnvelope): void {
  const liveTs = env && !env.replayed && env.ts_ms ? env.ts_ms : undefined;
  switch (event.type) {
    case 'turn_started':
      state.turnActive = true;
      break;
    case 'message_delta': {
      const kind = event.content_kind ?? 'text';
      const mode = event.text_mode ?? 'append';
      if (event.role === 'user') {
        upsertUserPrompt(state, event.message_id, event.text, mode);
        break;
      }
      const tb = assistantBuilder(state, event.turn_id);
      tb.messageIds.add(event.message_id);
      if (kind === 'reasoning') {
        const existing = tb.items.find(
          (i) => i.kind === 'reasoning' && i.id.startsWith(event.message_id),
        );
        const prev = existing?.kind === 'reasoning' ? existing.text : '';
        upsertReasoning(tb, event.message_id, mode === 'replace' ? event.text : prev + event.text, true);
      } else {
        const existing = tb.items.find(
          (i) => i.kind === 'assistant_text' && i.id.startsWith(event.message_id),
        );
        const prev = existing?.kind === 'assistant_text' ? existing.markdown : '';
        upsertAssistantText(
          tb,
          event.message_id,
          mode === 'replace' ? event.text : prev + event.text,
          true,
        );
      }
      break;
    }
    case 'message_completed': {
      const kind = event.content_kind ?? 'text';
      if (event.role === 'user') {
        upsertUserPrompt(state, event.message_id, event.text, 'replace');
        break;
      }
      const tb = assistantBuilder(state, event.turn_id);
      tb.messageIds.add(event.message_id);
      if (kind === 'reasoning') {
        upsertReasoning(tb, event.message_id, event.text, false, event.duration_ms);
      } else {
        upsertAssistantText(tb, event.message_id, event.text, false);
      }
      break;
    }
    case 'message_meta': {
      const tb = assistantBuilder(state, event.turn_id);
      tb.meta = {
        ...tb.meta,
        agent: event.agent ?? tb.meta.agent,
        model: event.model ?? tb.meta.model,
        provider: event.provider ?? tb.meta.provider,
        durationMs: event.duration_ms ?? tb.meta.durationMs,
      };
      break;
    }
    case 'tool_started': {
      const normalized = normalizeToolPayload(event.name, event.input_summary, undefined);
      const item: TranscriptItem = {
        kind: 'tool_call',
        id: event.tool_id,
        name: event.name,
        title: event.title,
        status: mapAgentToolStatus(mapToolPhase(event.tool_state)),
        input: normalized.input ?? event.input_summary,
        output: normalized.output,
        ...(liveTs != null ? { startedAtMs: liveTs } : {}),
      };
      const prior = state.tools.get(event.tool_id);
      const priorBuilder = prior ? state.builders.get(prior.builderKey) : undefined;
      const idx = priorBuilder?.items.findIndex((i) => i.kind === 'tool_call' && i.id === event.tool_id) ?? -1;
      if (prior && priorBuilder && idx >= 0) {
        priorBuilder.items[idx] = item;
        state.tools.set(event.tool_id, {
          builderKey: prior.builderKey,
          name: event.name,
          rawInput: event.input_summary,
        });
        break;
      }
      assistantBuilder(state, event.turn_id).items.push(item);
      state.tools.set(event.tool_id, {
        builderKey: event.turn_id,
        name: event.name,
        rawInput: event.input_summary,
      });
      break;
    }
    case 'tool_completed': {
      const record = state.tools.get(event.tool_id);
      const builderKey = record?.builderKey ?? event.turn_id;
      const tb = assistantBuilder(state, builderKey);
      const name = record?.name ?? event.title ?? 'tool';
      const rawInput = record?.rawInput ?? '';
      const normalized = normalizeToolPayload(name, rawInput, event.output_summary);
      const status = event.status === 'ok' ? 'completed' : 'error';
      const tool = tb.items.find((i) => i.kind === 'tool_call' && i.id === event.tool_id);
      if (tool?.kind === 'tool_call') {
        tool.status = status;
        tool.input = normalized.input ?? rawInput;
        tool.output = normalized.output ?? event.output_summary;
        tool.title = event.title ?? tool.title;
        if (liveTs != null) tool.endedAtMs = liveTs;
      } else {
        tb.items.push({
          kind: 'tool_call',
          id: event.tool_id,
          name,
          title: event.title,
          status,
          input: normalized.input ?? rawInput,
          output: normalized.output ?? event.output_summary,
        });
        state.tools.set(event.tool_id, { builderKey, name, rawInput });
      }
      break;
    }
    case 'files_changed':
      for (const p of event.paths) {
        if (!state.globalFilePaths.includes(p)) state.globalFilePaths.push(p);
      }
      break;
    case 'usage': {
      const tb = lastAssistantBuilder(state);
      if (!tb) break;
      const existing = tb.items.find((i) => i.kind === 'step_usage');
      const prior = existing?.kind === 'step_usage' ? existing : undefined;
      const inputTokens = event.input_tokens ?? prior?.inputTokens;
      const outputTokens = event.output_tokens ?? prior?.outputTokens;
      const costUsd = event.cost_usd ?? prior?.costUsd;
      tb.meta = { ...tb.meta, inputTokens, outputTokens, costUsd };
      if (prior) {
        prior.inputTokens = inputTokens;
        prior.outputTokens = outputTokens;
        prior.costUsd = costUsd;
        break;
      }
      const firstMessageId = tb.messageIds.values().next().value;
      tb.items.push({
        kind: 'step_usage',
        id: firstMessageId ? `${firstMessageId}-usage` : `usage-${tb.id}`,
        inputTokens,
        outputTokens,
        costUsd,
      });
      break;
    }
    case 'rate_limited':
      state.rateLimit = { message: event.message, retryAtMs: event.retry_at_ms };
      break;
    case 'turn_completed':
      state.turnActive = false;
      finalizeStreaming(state);
      if (event.status === 'error') {
        const message = event.error ?? 'Turn failed';
        state.lastError = message;
        pushError(assistantBuilder(state, event.turn_id), `error-${event.turn_id}`, message);
      }
      break;
    case 'error': {
      state.lastError = event.message;
      state.errorSeq += 1;
      const id = `error-${state.errorSeq}`;
      const tb = lastAssistantBuilder(state) ?? getOrCreateBuilder(state, id, id, 'assistant');
      pushError(tb, id, event.message);
      break;
    }
    case 'notice':
      applyNotice(state, event);
      break;
    case 'approval_requested':
    case 'approval_resolved':
    case 'plan_updated':
    case 'tool_output_delta':
      break;
    default: {
      const _never: never = event;
      return _never;
    }
  }
}

function buildersToTurns(state: BuildState): TranscriptTurn[] {
  const out: TranscriptTurn[] = [];
  for (const key of state.order) {
    const tb = state.builders.get(key);
    if (!tb || tb.items.length === 0) continue;
    if (tb.role === 'user') {
      out.push({ id: tb.id, role: 'user', items: tb.items });
      continue;
    }
    out.push({
      id: tb.id,
      role: 'assistant',
      items: tb.items,
      meta: { ...tb.meta },
    });
  }
  return out;
}

export function fromAgentEventEnvelopes(envelopes: AgentEventEnvelope[]): TranscriptViewModel {
  const sorted = [...envelopes].sort((a, b) => a.seq - b.seq);
  const state: BuildState = {
    builders: new Map(),
    order: [],
    tools: new Map(),
    globalFilePaths: [],
    turnActive: false,
    errorSeq: 0,
    stickyNotices: new Map(),
  };

  for (const env of sorted) {
    applyEvent(state, env.event, env);
  }

  // files_changed is session-wide: surface one patch item on the last assistant turn (as the legacy bridge does).
  if (state.globalFilePaths.length > 0) {
    const tb = lastAssistantBuilder(state);
    if (tb) {
      tb.items.push({ kind: 'patch', id: 'files-changed', paths: [...state.globalFilePaths] });
    }
  }

  const turns = buildersToTurns(state);

  return {
    turns,
    flatItems: flattenTranscriptTurns(turns),
    sessionBusy: state.turnActive,
    turnActive: state.turnActive,
    rateLimit: state.rateLimit,
    lastError: state.lastError,
    globalFilePaths: state.globalFilePaths,
    stickyNotices: [...state.stickyNotices.values()],
  };
}

/** Bridge legacy timeline state when live envelopes are unavailable (demo / polling). */
export function fromAgentTimeline(timeline: AgentTimelineViewModel): TranscriptViewModel {
  const turns: TranscriptTurn[] = [];
  for (const message of timeline.messages) {
    if (message.role === 'user') {
      turns.push({
        id: message.id,
        role: 'user',
        items: [
          {
            kind: 'user_prompt',
            id: message.id,
            text: message.text,
            files: [],
            collapsedDefault: true,
          },
        ],
      });
      continue;
    }
    const items: TranscriptItem[] = [];
    if (message.reasoning) {
      items.push({
        kind: 'reasoning',
        id: `${message.id}-reason`,
        text: message.reasoning,
        durationMs: message.reasoningDurationMs,
        streaming: message.reasoningStreaming,
      });
    }
    if (message.text) {
      items.push({
        kind: 'assistant_text',
        id: `${message.id}-text`,
        markdown: message.text,
        streaming: message.streaming,
      });
    }
    if (message.turnUsage) {
      items.push({
        kind: 'step_usage',
        id: `${message.id}-usage`,
        inputTokens: message.turnUsage.input_tokens,
        outputTokens: message.turnUsage.output_tokens,
        costUsd: message.turnUsage.cost_usd,
      });
    }
    turns.push({
      id: message.id,
      role: 'assistant',
      items,
      meta: {
        agent: message.agent,
        model: message.model,
        provider: message.provider,
        durationMs: message.durationMs,
        inputTokens: message.turnUsage?.input_tokens,
        outputTokens: message.turnUsage?.output_tokens,
        costUsd: message.turnUsage?.cost_usd,
      },
    });
  }

  for (const tool of timeline.tools) {
    const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant');
    if (!lastAssistant) continue;
    const normalized = normalizeToolPayload(tool.name, tool.inputSummary, tool.outputSummary);
    lastAssistant.items.push({
      kind: 'tool_call',
      id: tool.id,
      name: tool.name,
      title: tool.title,
      status: mapAgentToolStatus(tool.status),
      input: normalized.input ?? tool.inputSummary,
      output: normalized.output ?? tool.outputSummary,
    });
  }

  if (timeline.filePaths.length > 0) {
    const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant');
    if (lastAssistant) {
      lastAssistant.items.push({
        kind: 'patch',
        id: 'files-changed',
        paths: timeline.filePaths,
      });
    }
  }

  return {
    turns,
    flatItems: flattenTranscriptTurns(turns),
    sessionBusy: timeline.turnActive,
    turnActive: timeline.turnActive,
    rateLimit: timeline.rateLimit
      ? { message: timeline.rateLimit.message, retryAtMs: timeline.rateLimit.retry_at_ms }
      : undefined,
    lastError: timeline.lastError,
    globalFilePaths: timeline.filePaths,
  };
}

export function fromAgentEvents(
  timeline: AgentTimelineViewModel,
  envelopes?: AgentEventEnvelope[],
): TranscriptViewModel {
  if (envelopes && envelopes.length > 0) {
    return fromAgentEventEnvelopes(envelopes);
  }
  return fromAgentTimeline(timeline);
}
