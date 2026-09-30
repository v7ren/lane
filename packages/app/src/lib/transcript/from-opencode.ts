import type { Message, Part } from '@loomria/shared/opencode';

import { sortPartIdsForMessage } from '../opencode/ordering.js';
import { assembleMessageText, selectMessages, selectSessionStatus, selectTodos } from '../opencode/selectors.js';
import type { OpenCodeStoreState } from '../opencode/store.js';
import { formatDuration } from './format-meta.js';
import { mapOpenCodeToolStatus, normalizeToolPayload } from './tool-mapping.js';
import {
  flattenTranscriptTurns,
  type AssistantMessageMeta,
  type TranscriptItem,
  type TranscriptTurn,
  type TranscriptViewModel,
} from './types.js';

function messageDurationMs(message: Message): number | undefined {
  const time = message.time as { created?: number; completed?: number } | undefined;
  const created = time?.created;
  const completed = time?.completed;
  if (created != null && completed != null && completed >= created) {
    return completed - created;
  }
  return undefined;
}

function partIdsForMessage(state: OpenCodeStoreState, messageId: string): string[] {
  const ids = state.partsByMessage[messageId] ?? [];
  return sortPartIdsForMessage(state, messageId, ids);
}

function buildUserTurn(state: OpenCodeStoreState, message: Message): TranscriptTurn {
  const partIds = partIdsForMessage(state, message.id);
  const textChunks: string[] = [];
  const fileChips: {
    id: string;
    path?: string;
    filename?: string;
    mime?: string;
    url?: string;
  }[] = [];

  for (const partId of partIds) {
    const part = state.parts[partId];
    if (!part) continue;
    if (part.type === 'text' && part.text) {
      textChunks.push(part.text);
    }
    if (part.type === 'file') {
      fileChips.push({
        id: part.id,
        filename: part.filename,
        mime: part.mime,
        url: part.url,
      });
    }
  }

  const text =
    textChunks.join('') ||
    assembleMessageText(state, message.id) ||
    (typeof (message as Message & { text?: string }).text === 'string'
      ? (message as Message & { text?: string }).text
      : '');

  const item: TranscriptItem = {
    kind: 'user_prompt',
    id: message.id,
    text: text || '',
    files: fileChips,
    collapsedDefault: true,
  };

  return { id: message.id, role: 'user', items: [item] };
}

function mapPartToItem(
  part: Part,
  message: Message,
  projectRoot: string | null,
): TranscriptItem | null {
  switch (part.type) {
    case 'text':
      if (!part.text) return null;
      return {
        kind: 'assistant_text',
        id: part.id,
        markdown: part.text,
        streaming: false,
      };
    case 'reasoning': {
      const durationMs =
        part.time?.end != null && part.time.start != null
          ? part.time.end - part.time.start
          : undefined;
      return {
        kind: 'reasoning',
        id: part.id,
        text: part.text ?? '',
        durationMs,
        streaming: false,
      };
    }
    case 'tool': {
      const status = mapOpenCodeToolStatus(part.state?.status);
      const input =
        part.state && 'input' in part.state ? (part.state as { input?: unknown }).input : undefined;
      const output =
        part.state && 'output' in part.state ? (part.state as { output?: unknown }).output : undefined;
      const normalized = normalizeToolPayload(part.tool, input, output, {
        projectRoot,
      });
      const durationMs =
        part.state && 'time' in part.state && part.state.time
          ? (() => {
              const t = part.state.time as { start?: number; end?: number };
              if (t.start != null && t.end != null) return t.end - t.start;
              return undefined;
            })()
          : undefined;
      return {
        kind: 'tool_call',
        id: part.id,
        name: part.tool,
        title: part.state && 'title' in part.state ? String((part.state as { title?: string }).title) : undefined,
        status,
        durationMs,
        input: normalized.input,
        output: normalized.output,
        diff: normalized.diff,
      };
    }
    case 'patch': {
      const patchFiles = (part as { files?: string[] }).files ?? [];
      return {
        kind: 'patch',
        id: part.id,
        paths: patchFiles,
        summary: (part as { title?: string }).title,
      };
    }
    case 'subtask':
      return {
        kind: 'subtask',
        id: part.id,
        prompt: part.prompt ?? '',
        title: (part as { description?: string }).description,
      };
    case 'retry': {
      const retryPart = part as {
        message?: string;
        retryAt?: number;
        retry_at?: number;
        retry_at_ms?: number;
      };
      const retryAtMs =
        retryPart.retryAt ?? retryPart.retry_at ?? retryPart.retry_at_ms ?? undefined;
      return {
        kind: 'retry',
        id: part.id,
        attempt: part.attempt ?? 1,
        message: retryPart.message,
        retryAtMs,
      };
    }
    case 'step-finish':
      return {
        kind: 'step_usage',
        id: part.id,
        inputTokens: part.tokens?.input,
        outputTokens: part.tokens?.output,
        reasoningTokens: part.tokens?.reasoning,
        costUsd: part.cost,
      };
    case 'agent':
    case 'compaction':
    case 'snapshot':
    case 'step-start':
    case 'file':
      return null;
    default:
      return null;
  }
}

function buildAssistantMeta(message: Message, items: TranscriptItem[]): AssistantMessageMeta {
  const step = items.find((i) => i.kind === 'step_usage');
  const durationMs = messageDurationMs(message);
  const assistant = message as Message & {
    tokens?: { input?: number; output?: number; reasoning?: number };
    model?: { id?: string; providerID?: string };
    modelID?: string;
    providerID?: string;
    cost?: number;
    agent?: string;
  };
  return {
    agent: assistant.agent,
    model: assistant.model?.id ?? assistant.modelID,
    provider: assistant.model?.providerID ?? assistant.providerID,
    durationMs,
    inputTokens: step?.kind === 'step_usage' ? step.inputTokens : assistant.tokens?.input,
    outputTokens: step?.kind === 'step_usage' ? step.outputTokens : assistant.tokens?.output,
    reasoningTokens: step?.kind === 'step_usage' ? step.reasoningTokens : assistant.tokens?.reasoning,
    costUsd: step?.kind === 'step_usage' ? step.costUsd : assistant.cost,
  };
}

function messageErrorText(message: Message): string | null {
  const record = message as Message & {
    error?: unknown;
    info?: { error?: unknown };
  };
  const err = record.error ?? record.info?.error;
  if (typeof err === 'string' && err.trim()) return err.trim();
  if (err && typeof err === 'object') {
    const nested = err as { message?: string; error?: string };
    if (typeof nested.message === 'string' && nested.message.trim()) return nested.message.trim();
    if (typeof nested.error === 'string' && nested.error.trim()) return nested.error.trim();
  }
  return null;
}

function buildAssistantTurn(state: OpenCodeStoreState, message: Message): TranscriptTurn {
  const partIds = partIdsForMessage(state, message.id);
  const items: TranscriptItem[] = [];
  for (const partId of partIds) {
    const part = state.parts[partId];
    if (!part) continue;
    const item = mapPartToItem(part, message, state.directory);
    if (item) items.push(item);
  }

  const errText = messageErrorText(message);
  if (errText && !items.some((i) => i.kind === 'error')) {
    items.push({ kind: 'error', id: `${message.id}-error`, message: errText });
  }

  if (items.length === 0) {
    const text = assembleMessageText(state, message.id);
    if (text) {
      items.push({
        kind: 'assistant_text',
        id: `${message.id}-text`,
        markdown: text,
        streaming: false,
      });
    }
  }

  return {
    id: message.id,
    role: 'assistant',
    items,
    meta: buildAssistantMeta(message, items),
  };
}

export function fromOpenCode(state: OpenCodeStoreState, sessionId: string): TranscriptViewModel {
  const messages = selectMessages(state, sessionId);
  const turns: TranscriptTurn[] = messages.map((message) =>
    message.role === 'user'
      ? buildUserTurn(state, message)
      : buildAssistantTurn(state, message),
  );

  const todos = selectTodos(state, sessionId);
  if (todos.length > 0) {
    const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant');
    if (lastAssistant) {
      lastAssistant.items.push({
        kind: 'todo_update',
        id: `todo-${sessionId}`,
        items: todos.map((t, index) => ({
          id: (t as { id?: string }).id ?? `todo-${index}`,
          content: t.content,
          status: t.status,
          priority: t.priority,
        })),
      });
    }
  }

  const status = selectSessionStatus(state, sessionId);
  const issue = state.sessionIssues[sessionId];
  const lastUserIdx = turns.reduce<number | null>((acc, turn, index) => {
    return turn.role === 'user' ? index : acc;
  }, null);
  const hasAssistantAfterLastUser =
    lastUserIdx != null && turns.slice(lastUserIdx + 1).some((t) => t.role === 'assistant');
  if (issue && lastUserIdx != null && !hasAssistantAfterLastUser) {
    const item: TranscriptItem =
      issue.kind === 'retry' || issue.retryAtMs != null
        ? {
            kind: 'retry',
            id: `session-retry-${sessionId}`,
            attempt: 1,
            message: issue.message,
            retryAtMs: issue.retryAtMs,
          }
        : {
            kind: 'error',
            id: `session-error-${sessionId}`,
            message: issue.message,
          };
    turns.push({
      id: item.id,
      role: 'assistant',
      items: [item],
    });
  }

  const flatItems = flattenTranscriptTurns(turns);
  const rateLimit =
    issue?.kind === 'rate_limit' || (issue?.retryAtMs != null && status === 'retry')
      ? { message: issue.message, retryAtMs: issue.retryAtMs }
      : undefined;
  const lastError =
    issue && issue.kind === 'error' && status !== 'busy' ? issue.message : undefined;

  return {
    turns,
    flatItems,
    sessionBusy: status === 'busy',
    turnActive: status === 'busy',
    rateLimit,
    lastError,
    globalFilePaths: state.lastFileEdits,
  };
}

/** Format reasoning label helper for tests */
export function reasoningLabel(durationMs?: number): string {
  if (durationMs != null) return `Thought · ${formatDuration(durationMs)}`;
  return 'Thought';
}
