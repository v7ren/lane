import type { AgentEvent, AgentEventEnvelope } from '../agent-events.js';
import type { AgentTimelineViewModel } from '../agent-timeline-reducer.js';
import { mapAgentToolStatus, normalizeToolPayload } from './tool-mapping.js';
import {
  flattenTranscriptTurns,
  type AssistantMessageMeta,
  type TranscriptItem,
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

function emptyTurn(id: string, role: 'user' | 'assistant'): TurnBuilder {
  return {
    id,
    role,
    items: [],
    meta: {},
    messageIds: new Set(),
  };
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

function applyEnvelope(
  turns: TranscriptTurn[],
  turnBuilders: Map<string, TurnBuilder>,
  turnOrder: string[],
  globalFilePaths: string[],
  vmFlags: { turnActive: boolean; lastError?: string; rateLimit?: TranscriptViewModel['rateLimit'] },
  event: AgentEvent,
) {
  switch (event.type) {
    case 'turn_started':
      vmFlags.turnActive = true;
      if (!turnBuilders.has(event.turn_id)) {
        const tb = emptyTurn(event.turn_id, 'assistant');
        turnBuilders.set(event.turn_id, tb);
        turnOrder.push(event.turn_id);
      }
      break;
    case 'message_delta': {
      const kind = event.content_kind ?? 'text';
      const tb =
        turnBuilders.get(event.turn_id) ??
        (() => {
          const created = emptyTurn(event.turn_id, event.role === 'user' ? 'user' : 'assistant');
          turnBuilders.set(event.turn_id, created);
          turnOrder.push(event.turn_id);
          return created;
        })();
      tb.role = event.role;
      tb.messageIds.add(event.message_id);
      if (event.role === 'user') {
        const prompt = tb.items.find((i) => i.kind === 'user_prompt');
        if (prompt?.kind === 'user_prompt') {
          prompt.text =
            event.text_mode === 'replace' ? event.text : prompt.text + event.text;
        } else {
          tb.items.push({
            kind: 'user_prompt',
            id: event.message_id,
            text: event.text,
            files: [],
          });
        }
      } else if (kind === 'reasoning') {
        const existing = tb.items.find((i) => i.kind === 'reasoning' && i.id.startsWith(event.message_id));
        const prev = existing?.kind === 'reasoning' ? existing.text : '';
        const text = event.text_mode === 'replace' ? event.text : prev + event.text;
        upsertReasoning(tb, event.message_id, text, true);
      } else {
        const existing = tb.items.find(
          (i) => i.kind === 'assistant_text' && i.id.startsWith(event.message_id),
        );
        const prev = existing?.kind === 'assistant_text' ? existing.markdown : '';
        const text = event.text_mode === 'replace' ? event.text : prev + event.text;
        upsertAssistantText(tb, event.message_id, text, true);
      }
      break;
    }
    case 'message_completed': {
      const kind = event.content_kind ?? 'text';
      const tb =
        turnBuilders.get(event.turn_id) ??
        (() => {
          const created = emptyTurn(event.turn_id, event.role === 'user' ? 'user' : 'assistant');
          turnBuilders.set(event.turn_id, created);
          turnOrder.push(event.turn_id);
          return created;
        })();
      tb.role = event.role;
      if (event.role === 'user') {
        const prompt = tb.items.find((i) => i.kind === 'user_prompt');
        if (prompt?.kind === 'user_prompt') {
          prompt.text = event.text;
        } else {
          tb.items.push({
            kind: 'user_prompt',
            id: event.message_id,
            text: event.text,
            files: [],
            collapsedDefault: true,
          });
        }
        tb.id = event.message_id;
      } else if (kind === 'reasoning') {
        upsertReasoning(tb, event.message_id, event.text, false, event.duration_ms);
      } else {
        upsertAssistantText(tb, event.message_id, event.text, false);
      }
      break;
    }
    case 'message_meta': {
      const tb = turnBuilders.get(event.turn_id);
      if (!tb) break;
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
      const tb = turnBuilders.get(event.turn_id);
      if (!tb) break;
      const normalized = normalizeToolPayload(event.name, event.input_summary, undefined);
      tb.items.push({
        kind: 'tool_call',
        id: event.tool_id,
        name: event.name,
        title: event.title,
        status: mapAgentToolStatus(mapToolPhase(event.tool_state)),
        input: normalized.input ?? event.input_summary,
        output: normalized.output,
      });
      break;
    }
    case 'tool_completed': {
      const tb = turnBuilders.get(event.turn_id);
      if (!tb) break;
      const idx = tb.items.findIndex((i) => i.kind === 'tool_call' && i.id === event.tool_id);
      const normalized = normalizeToolPayload(
        event.title ?? 'tool',
        idx >= 0 && tb.items[idx]?.kind === 'tool_call' ? tb.items[idx].input : '',
        event.output_summary,
      );
      if (idx >= 0 && tb.items[idx]?.kind === 'tool_call') {
        const tool = tb.items[idx];
        tool.status = event.status === 'ok' ? 'completed' : 'error';
        tool.output = normalized.output ?? event.output_summary;
        tool.title = event.title ?? tool.title;
      } else {
        tb.items.push({
          kind: 'tool_call',
          id: event.tool_id,
          name: event.title ?? 'tool',
          title: event.title,
          status: event.status === 'ok' ? 'completed' : 'error',
          input: normalized.input,
          output: normalized.output ?? event.output_summary,
        });
      }
      break;
    }
    case 'files_changed':
      for (const p of event.paths) {
        if (!globalFilePaths.includes(p)) globalFilePaths.push(p);
      }
      break;
    case 'usage': {
      const tb = [...turnBuilders.values()].reverse().find((t) => t.role === 'assistant');
      if (!tb) break;
      tb.meta = {
        ...tb.meta,
        inputTokens: event.input_tokens,
        outputTokens: event.output_tokens,
        costUsd: event.cost_usd,
      };
      tb.items.push({
        kind: 'step_usage',
        id: `usage-${tb.id}`,
        inputTokens: event.input_tokens,
        outputTokens: event.output_tokens,
        costUsd: event.cost_usd,
      });
      break;
    }
    case 'rate_limited':
      vmFlags.rateLimit = { message: event.message, retryAtMs: event.retry_at_ms };
      break;
    case 'turn_completed':
      vmFlags.turnActive = event.status !== 'ok' ? vmFlags.turnActive : false;
      if (event.status === 'error') {
        vmFlags.lastError = event.error ?? 'Turn failed';
      }
      break;
    case 'error':
      vmFlags.lastError = event.message;
      break;
    case 'approval_requested':
    case 'approval_resolved':
      break;
    default: {
      const _never: never = event;
      return _never;
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

function buildersToTurns(turnOrder: string[], turnBuilders: Map<string, TurnBuilder>): TranscriptTurn[] {
  const out: TranscriptTurn[] = [];
  for (const turnId of turnOrder) {
    const tb = turnBuilders.get(turnId);
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
  const turnBuilders = new Map<string, TurnBuilder>();
  const turnOrder: string[] = [];
  const globalFilePaths: string[] = [];
  const vmFlags = { turnActive: false, lastError: undefined as string | undefined, rateLimit: undefined as TranscriptViewModel['rateLimit'] };

  for (const env of sorted) {
    applyEnvelope([], turnBuilders, turnOrder, globalFilePaths, vmFlags, env.event);
  }

  const turns = buildersToTurns(turnOrder, turnBuilders);

  return {
    turns,
    flatItems: flattenTranscriptTurns(turns),
    sessionBusy: vmFlags.turnActive,
    turnActive: vmFlags.turnActive,
    rateLimit: vmFlags.rateLimit,
    lastError: vmFlags.lastError,
    globalFilePaths,
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
