import type {
  Message,
  OpenCodeWireEvent,
  Part,
  PermissionAsked,
  QuestionRequest,
  Session,
  Todo,
} from '@loomria/shared/opencode';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { getServerInfo, opencodeClient } from './client.js';
import { sortMessageIds, sortPartIdsForMessage } from './ordering.js';
import {
  applyParsedSessionStatus,
  applySessionStatusSnapshot,
  clearOptimisticBusy,
  markOptimisticBusy,
  parseWireSessionStatus,
} from './session-status.js';

export type SessionStatus = 'idle' | 'busy' | 'retry' | 'unknown';
export type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';

export type SessionIssue = {
  message: string;
  retryAtMs?: number;
  kind: 'error' | 'rate_limit' | 'retry';
  updatedAt: number;
};

export type OpenCodeEventEnvelope = {
  pane_id: string;
  server_id: string;
  event: OpenCodeWireEvent;
};

export type OpenCodeStoreState = {
  paneId: string;
  serverId: string | null;
  directory: string | null;
  serverVersion: string | null;
  healthy: boolean;
  connectionStatus: ConnectionStatus;
  sessions: Record<string, Session>;
  sessionOrder: string[];
  messagesBySession: Record<string, string[]>;
  messages: Record<string, Message>;
  partsByMessage: Record<string, string[]>;
  /** Stable part order within a message (event / hydrate sequence). */
  partOrder: Record<string, number>;
  partOrderSeq: number;
  parts: Record<string, Part>;
  sessionStatus: Record<string, SessionStatus>;
  /** Prompt sent locally; cleared when server reports idle. */
  optimisticBusy: Record<string, true>;
  sessionIssues: Record<string, SessionIssue>;
  permissions: Record<string, PermissionAsked>;
  questions: Record<string, QuestionRequest>;
  todosBySession: Record<string, Todo[]>;
  lastFileEdits: string[];
  vcsBranch: string | null;
  seenEventIds: Set<string>;
};

export function createEmptyOpenCodeStore(paneId: string): OpenCodeStoreState {
  return {
    paneId,
    serverId: null,
    directory: null,
    serverVersion: null,
    healthy: false,
    connectionStatus: 'unknown',
    sessions: {},
    sessionOrder: [],
    messagesBySession: {},
    messages: {},
    partsByMessage: {},
    partOrder: {},
    partOrderSeq: 0,
    parts: {},
    sessionStatus: {},
    optimisticBusy: {},
    sessionIssues: {},
    permissions: {},
    questions: {},
    todosBySession: {},
    lastFileEdits: [],
    vcsBranch: null,
    seenEventIds: new Set(),
  };
}

function upsertSession(state: OpenCodeStoreState, session: Session): OpenCodeStoreState {
  const sessions = { ...state.sessions, [session.id]: session };
  const sessionOrder = state.sessionOrder.includes(session.id)
    ? state.sessionOrder
    : [session.id, ...state.sessionOrder];
  return { ...state, sessions, sessionOrder };
}

function upsertMessage(state: OpenCodeStoreState, message: Message): OpenCodeStoreState {
  const messages = { ...state.messages, [message.id]: message };
  const list = state.messagesBySession[message.sessionID] ?? [];
  const merged = list.includes(message.id) ? list : [...list, message.id];
  const messagesBySession = {
    ...state.messagesBySession,
    [message.sessionID]: sortMessageIds({ ...state, messages }, message.sessionID, merged),
  };
  return { ...state, messages, messagesBySession };
}

function assignPartOrder(
  state: OpenCodeStoreState,
  partId: string,
  explicitOrder?: number,
): { partOrder: Record<string, number>; partOrderSeq: number } {
  if (state.partOrder[partId] != null && explicitOrder == null) {
    return { partOrder: state.partOrder, partOrderSeq: state.partOrderSeq };
  }
  const seq = explicitOrder ?? state.partOrderSeq;
  const partOrder = { ...state.partOrder, [partId]: seq };
  const partOrderSeq = explicitOrder == null ? state.partOrderSeq + 1 : state.partOrderSeq;
  return { partOrder, partOrderSeq };
}

function replacePartFromUpdate(existing: Part, incoming: Part): Part {
  const merged = { ...existing, ...incoming } as Part;
  const incomingRecord = incoming as Record<string, unknown>;
  if (incoming.type === 'text' || incoming.type === 'reasoning') {
    if ('text' in incomingRecord) {
      return {
        ...merged,
        text: typeof incomingRecord.text === 'string' ? incomingRecord.text : '',
      } as Part;
    }
  }
  return merged;
}

function upsertPart(
  state: OpenCodeStoreState,
  messageId: string,
  part: Part,
  orderHint?: number,
): OpenCodeStoreState {
  const existing = state.parts[part.id];
  const nextPart = existing ? replacePartFromUpdate(existing, part) : part;
  const parts = { ...state.parts, [part.id]: nextPart };
  const { partOrder, partOrderSeq } = assignPartOrder(state, part.id, orderHint);
  const list = state.partsByMessage[messageId] ?? [];
  const merged = list.includes(part.id) ? list : [...list, part.id];
  const nextState = { ...state, parts, partOrder, partOrderSeq };
  const partsByMessage = {
    ...nextState.partsByMessage,
    [messageId]: sortPartIdsForMessage(nextState, messageId, merged),
  };
  return { ...nextState, partsByMessage };
}

function applyPartDelta(
  state: OpenCodeStoreState,
  partId: string,
  field: string,
  delta: string,
): OpenCodeStoreState {
  const existing = state.parts[partId];
  if (!existing) {
    return state;
  }
  const record = { ...(existing as Record<string, unknown>) };
  const current = record[field];
  if (typeof current === 'string') {
    record[field] = current + delta;
  } else {
    record[field] = delta;
  }
  const parts = { ...state.parts, [partId]: record as Part };
  return { ...state, parts };
}

function propsOf(event: OpenCodeWireEvent): Record<string, unknown> {
  return event.properties ?? {};
}

function parseSessionIssuePayload(
  props: Record<string, unknown>,
  kind: SessionIssue['kind'],
): SessionIssue | null {
  const err = props.error;
  let message: string | null = null;
  let retryAtMs: number | undefined;

  if (typeof err === 'string' && err.trim()) {
    message = err.trim();
  } else if (err && typeof err === 'object') {
    const record = err as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim()) {
      message = record.message.trim();
    } else if (typeof record.error === 'string' && record.error.trim()) {
      message = record.error.trim();
    }
    const retry =
      record.retryAt ?? record.retry_at ?? record.retry_at_ms ?? record.retryAtMs;
    if (typeof retry === 'number' && Number.isFinite(retry)) {
      retryAtMs = retry;
    }
  }
  if (!message && typeof props.message === 'string' && props.message.trim()) {
    message = props.message.trim();
  }
  if (!message) return null;
  const retryProp = props.retryAt ?? props.retry_at ?? props.retry_at_ms ?? props.retryAtMs;
  if (retryAtMs == null && typeof retryProp === 'number' && Number.isFinite(retryProp)) {
    retryAtMs = retryProp;
  }
  return {
    message,
    retryAtMs,
    kind,
    updatedAt: Date.now(),
  };
}

function upsertSessionIssue(
  state: OpenCodeStoreState,
  sessionID: string,
  issue: SessionIssue,
): OpenCodeStoreState {
  return {
    ...state,
    sessionIssues: { ...state.sessionIssues, [sessionID]: issue },
  };
}

function clearSessionIssue(state: OpenCodeStoreState, sessionID: string): OpenCodeStoreState {
  if (!state.sessionIssues[sessionID]) return state;
  const { [sessionID]: _removed, ...sessionIssues } = state.sessionIssues;
  return { ...state, sessionIssues };
}

export function applyOpenCodeWireEvent(
  state: OpenCodeStoreState,
  wire: OpenCodeWireEvent,
): OpenCodeStoreState {
  if (state.seenEventIds.has(wire.id)) {
    return state;
  }
  const seenEventIds = new Set(state.seenEventIds);
  seenEventIds.add(wire.id);

  let next: OpenCodeStoreState = { ...state, seenEventIds };
  const type = wire.type;
  const props = propsOf(wire);

  if (type === 'loomria.opencode.connected') {
    return { ...next, connectionStatus: 'connected' };
  }
  if (type === 'loomria.opencode.disconnected') {
    return { ...next, connectionStatus: 'disconnected' };
  }

  if (type.startsWith('session.next.')) {
    return next;
  }

  switch (type) {
    case 'session.created':
    case 'session.updated': {
      const session = (props.session ?? props.info) as Session | undefined;
      if (session?.id) {
        next = upsertSession(next, session);
      }
      break;
    }
    case 'session.deleted': {
      const sessionID = props.sessionID as string | undefined;
      if (sessionID) {
        const { [sessionID]: _removed, ...sessions } = next.sessions;
        next = {
          ...next,
          sessions,
          sessionOrder: next.sessionOrder.filter((id) => id !== sessionID),
        };
      }
      break;
    }
    case 'session.status': {
      const sessionID = props.sessionID as string | undefined;
      const parsed = sessionID ? parseWireSessionStatus(props.status) : null;
      if (sessionID && parsed) {
        next = applyParsedSessionStatus(next, sessionID, parsed, props);
      }
      break;
    }
    case 'session.idle': {
      const sessionID = props.sessionID as string | undefined;
      if (sessionID) {
        next = applyParsedSessionStatus(next, sessionID, { type: 'idle' }, props);
      }
      break;
    }
    case 'session.error': {
      const sessionID = props.sessionID as string | undefined;
      if (sessionID) {
        next = { ...next, sessionStatus: { ...next.sessionStatus, [sessionID]: 'retry' } };
        const lower = JSON.stringify(props).toLowerCase();
        const kind: SessionIssue['kind'] =
          lower.includes('rate') || lower.includes('quota') || lower.includes('limit')
            ? 'rate_limit'
            : 'error';
        const issue = parseSessionIssuePayload(props, kind);
        if (issue) {
          next = upsertSessionIssue(next, sessionID, issue);
        }
      }
      break;
    }
    case 'message.updated': {
      const info = props.info as Message | undefined;
      if (info) {
        next = upsertMessage(next, info);
      }
      break;
    }
    case 'message.removed': {
      const messageID = props.messageID as string | undefined;
      if (messageID) {
        const { [messageID]: _msg, ...messages } = next.messages;
        next = { ...next, messages };
      }
      break;
    }
    case 'message.part.updated': {
      let part = props.part as Part | undefined;
      const messageID = (props.messageID as string | undefined) ?? part?.messageID;
      const wirePartId = props.partID as string | undefined;
      if (part && wirePartId && part.id !== wirePartId) {
        part = { ...part, id: wirePartId };
      }
      if (part && messageID) {
        if (!next.messages[messageID]) {
          const sessionID =
            (props.sessionID as string | undefined) ??
            (part as Part & { sessionID?: string }).sessionID ??
            '';
          const stub = {
            id: messageID,
            sessionID,
            role: 'assistant',
          } as Message;
          next = upsertMessage(next, stub);
        }
        next = upsertPart(next, messageID, part);
      }
      break;
    }
    case 'message.part.removed': {
      const partID = props.partID as string | undefined;
      if (partID) {
        const { [partID]: _part, ...parts } = next.parts;
        next = { ...next, parts };
      }
      break;
    }
    case 'message.part.delta': {
      const partID = props.partID as string | undefined;
      const messageID = props.messageID as string | undefined;
      const field = props.field as string | undefined;
      const delta = props.delta as string | undefined;
      if (partID && field && typeof delta === 'string') {
        if (!next.parts[partID] && messageID) {
          const stub = {
            id: partID,
            messageID,
            type: field === 'text' ? 'text' : 'reasoning',
            text: '',
          } as Part;
          next = upsertPart(next, messageID, stub);
        }
        next = applyPartDelta(next, partID, field, delta);
      }
      break;
    }
    case 'permission.asked':
    case 'permission.v2.asked': {
      const permission = props.permission as PermissionAsked | undefined;
      if (permission?.id) {
        next = { ...next, permissions: { ...next.permissions, [permission.id]: permission } };
      }
      break;
    }
    case 'permission.replied':
    case 'permission.v2.replied': {
      const requestID = props.requestID as string | undefined;
      if (requestID) {
        const { [requestID]: _p, ...permissions } = next.permissions;
        next = { ...next, permissions };
      }
      break;
    }
    case 'question.asked':
    case 'question.v2.asked': {
      const question = props.question as QuestionRequest | undefined;
      if (question?.id) {
        next = { ...next, questions: { ...next.questions, [question.id]: question } };
      }
      break;
    }
    case 'question.replied':
    case 'question.rejected':
    case 'question.v2.replied':
    case 'question.v2.rejected': {
      const requestID = props.requestID as string | undefined;
      if (requestID) {
        const { [requestID]: _q, ...questions } = next.questions;
        next = { ...next, questions };
      }
      break;
    }
    case 'todo.updated': {
      const sessionID = props.sessionID as string | undefined;
      const todos = props.todos as Todo[] | undefined;
      if (sessionID && todos) {
        next = { ...next, todosBySession: { ...next.todosBySession, [sessionID]: todos } };
      }
      break;
    }
    case 'file.edited': {
      const files = props.files as string[] | undefined;
      if (files?.length) {
        next = { ...next, lastFileEdits: [...files, ...next.lastFileEdits].slice(0, 50) };
      }
      break;
    }
    case 'vcs.branch.updated': {
      const branch = props.branch as string | undefined;
      if (branch) {
        next = { ...next, vcsBranch: branch };
      }
      break;
    }
    default:
      break;
  }

  return next;
}

export function applyOpenCodeEnvelope(
  state: OpenCodeStoreState,
  envelope: OpenCodeEventEnvelope,
): OpenCodeStoreState {
  if (envelope.pane_id !== state.paneId) {
    return state;
  }
  let next = applyOpenCodeWireEvent(state, envelope.event);
  if (!next.serverId) {
    next = { ...next, serverId: envelope.server_id };
  }
  return next;
}

export type OpenCodeStore = {
  getState: () => OpenCodeStoreState;
  subscribe: (listener: () => void) => () => void;
  loadInitial: () => Promise<void>;
  refreshSessionStatus: () => Promise<void>;
  markSessionOptimisticBusy: (sessionId: string) => void;
  ensureSessionMessages: (sessionId: string) => Promise<void>;
  dispose: () => void;
};

export function createOpenCodeStore(paneId: string): OpenCodeStore {
  let state = createEmptyOpenCodeStore(paneId);
  const listeners = new Set<() => void>();
  let unlisten: UnlistenFn | null = null;
  let initialLoaded = false;
  const loadedMessageSessions = new Set<string>();

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const setState = (updater: (prev: OpenCodeStoreState) => OpenCodeStoreState) => {
    state = updater(state);
    notify();
  };

  const bootstrap = async () => {
    if (initialLoaded) return;
    initialLoaded = true;
    const info = await getServerInfo(paneId);
    const sessions = await opencodeClient.listSessions(paneId);
    let attachedSession = info.attached_session_id ?? null;
    if (attachedSession && !sessions.some((s) => s.id === attachedSession)) {
      try {
        const session = await opencodeClient.getSession(paneId, attachedSession);
        sessions.unshift(session);
      } catch {
        attachedSession = null;
      }
    }
    let statusSnapshot: Record<string, unknown> = {};
    try {
      statusSnapshot = await opencodeClient.getSessionStatus(paneId);
    } catch {
      statusSnapshot = {};
    }
    setState((prev) => {
      let next: OpenCodeStoreState = {
        ...prev,
        directory: info.directory,
        serverVersion: info.version ?? null,
        healthy: info.healthy,
        connectionStatus: info.healthy ? 'connected' : 'disconnected',
      };
      for (const session of sessions) {
        next = upsertSession(next, session);
      }
      if (attachedSession && next.sessions[attachedSession]) {
        next = {
          ...next,
          sessionOrder: [
            attachedSession,
            ...next.sessionOrder.filter((id) => id !== attachedSession),
          ],
        };
      }
      next = applySessionStatusSnapshot(next, statusSnapshot);
      return next;
    });
    if (!unlisten) {
      unlisten = await listen<OpenCodeEventEnvelope>('opencode://event', (ev) => {
        setState((prev) => applyOpenCodeEnvelope(prev, ev.payload));
      });
    }
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    loadInitial: bootstrap,
    refreshSessionStatus: async () => {
      await bootstrap();
      try {
        const snapshot = await opencodeClient.getSessionStatus(paneId);
        setState((prev) => applySessionStatusSnapshot(prev, snapshot));
      } catch {
        /* ignore */
      }
    },
    markSessionOptimisticBusy: (sessionId) => {
      if (!sessionId) return;
      setState((prev) => markOptimisticBusy(prev, sessionId));
    },
    ensureSessionMessages: async (sessionId) => {
      if (!sessionId || loadedMessageSessions.has(sessionId)) return;
      await bootstrap();
      const messages = await opencodeClient.listMessages(paneId, sessionId);
      setState((prev) => {
        let next = prev;
        for (const message of messages) {
          next = upsertMessage(next, message);
          const parts = (message as Message & { parts?: Part[] }).parts;
          if (parts) {
            const base = next.partOrderSeq;
            for (let index = 0; index < parts.length; index += 1) {
              next = upsertPart(next, message.id, parts[index]!, base + index);
            }
            next = { ...next, partOrderSeq: base + parts.length };
          }
        }
        return next;
      });
      loadedMessageSessions.add(sessionId);
    },
    dispose: () => {
      unlisten?.();
      unlisten = null;
      listeners.clear();
    },
  };
}

const stores = new Map<string, OpenCodeStore>();

export function getOpenCodeStore(paneId: string): OpenCodeStore {
  let store = stores.get(paneId);
  if (!store) {
    store = createOpenCodeStore(paneId);
    stores.set(paneId, store);
  }
  return store;
}
