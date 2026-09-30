import type { Message, Session, Todo } from '@loomria/shared/opencode';

import { sortMessageIds } from './ordering.js';
import type { ConnectionStatus, OpenCodeStoreState, SessionStatus } from './store.js';

export type SessionSummary = {
  agent?: string;
  model?: string;
  provider?: string;
  tokens?: number;
  costUsd?: number;
  todos: Todo[];
};

export type EnvironmentView = {
  directory: string | null;
  branch: string | null;
  serverUrl: null;
  serverStatus: ConnectionStatus;
};

export function selectSessions(state: OpenCodeStoreState): Session[] {
  return state.sessionOrder.map((id) => state.sessions[id]).filter(Boolean);
}

export function selectSession(state: OpenCodeStoreState, sessionId: string): Session | undefined {
  return state.sessions[sessionId];
}

export function selectMessages(state: OpenCodeStoreState, sessionId: string): Message[] {
  const ids = sortMessageIds(state, sessionId, state.messagesBySession[sessionId] ?? []);
  return ids.map((id) => state.messages[id]).filter(Boolean);
}

/** Text part contents for a message after delta application. */
export function assembleMessageText(state: OpenCodeStoreState, messageId: string): string {
  const partIds = state.partsByMessage[messageId] ?? [];
  const chunks: string[] = [];
  for (const partId of partIds) {
    const part = state.parts[partId];
    if (part?.type === 'text' && typeof part.text === 'string' && part.text.length > 0) {
      chunks.push(part.text);
    }
  }
  return chunks.join('');
}

export function finalTextPartForMessage(
  state: OpenCodeStoreState,
  messageId: string,
): { partId: string; text: string } | undefined {
  const partIds = state.partsByMessage[messageId] ?? [];
  for (let i = partIds.length - 1; i >= 0; i -= 1) {
    const part = state.parts[partIds[i]!];
    if (part?.type === 'text') {
      return { partId: part.id, text: part.text ?? '' };
    }
  }
  return undefined;
}

export function selectSessionStatus(state: OpenCodeStoreState, sessionId: string): SessionStatus {
  const wire = state.sessionStatus[sessionId];
  if (wire === 'busy' || wire === 'retry' || wire === 'idle') return wire;
  if (state.optimisticBusy[sessionId]) return 'busy';
  return wire ?? 'unknown';
}

export function selectPermissions(state: OpenCodeStoreState) {
  return Object.values(state.permissions);
}

export function selectTodos(state: OpenCodeStoreState, sessionId: string): Todo[] {
  return state.todosBySession[sessionId] ?? [];
}

export function selectSessionSummary(state: OpenCodeStoreState, sessionId: string): SessionSummary {
  const session = state.sessions[sessionId];
  const todos = selectTodos(state, sessionId);
  const tokens = session?.tokens
    ? session.tokens.input + session.tokens.output + session.tokens.reasoning
    : undefined;
  return {
    agent: session?.agent,
    model: session?.model?.id,
    provider: session?.model?.providerID,
    tokens,
    costUsd: session?.cost,
    todos,
  };
}

export function selectEnvironment(state: OpenCodeStoreState): EnvironmentView {
  return {
    directory: state.directory,
    branch: state.vcsBranch,
    serverUrl: null,
    serverStatus: state.connectionStatus,
  };
}

export function selectServerMeta(state: OpenCodeStoreState) {
  return {
    version: state.serverVersion,
    healthy: state.healthy,
    directory: state.directory,
    serverId: state.serverId,
    connectionStatus: state.connectionStatus,
  };
}
