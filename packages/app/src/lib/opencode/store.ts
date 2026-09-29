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

export type SessionStatus = 'idle' | 'busy' | 'retry' | 'unknown';
export type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';

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
  parts: Record<string, Part>;
  sessionStatus: Record<string, SessionStatus>;
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
    parts: {},
    sessionStatus: {},
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
  const messagesBySession = {
    ...state.messagesBySession,
    [message.sessionID]: list.includes(message.id) ? list : [...list, message.id],
  };
  return { ...state, messages, messagesBySession };
}

function upsertPart(state: OpenCodeStoreState, messageId: string, part: Part): OpenCodeStoreState {
  const parts = { ...state.parts, [part.id]: part };
  const list = state.partsByMessage[messageId] ?? [];
  const partsByMessage = {
    ...state.partsByMessage,
    [messageId]: list.includes(part.id) ? list : [...list, part.id],
  };
  return { ...state, parts, partsByMessage };
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
      const status = props.status as string | undefined;
      if (sessionID && status) {
        const mapped: SessionStatus =
          status === 'busy' ? 'busy' : status === 'retry' ? 'retry' : status === 'idle' ? 'idle' : 'unknown';
        next = { ...next, sessionStatus: { ...next.sessionStatus, [sessionID]: mapped } };
      }
      break;
    }
    case 'session.idle': {
      const sessionID = props.sessionID as string | undefined;
      if (sessionID) {
        next = { ...next, sessionStatus: { ...next.sessionStatus, [sessionID]: 'idle' } };
      }
      break;
    }
    case 'session.error': {
      const sessionID = props.sessionID as string | undefined;
      if (sessionID) {
        next = { ...next, sessionStatus: { ...next.sessionStatus, [sessionID]: 'retry' } };
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
      const part = props.part as Part | undefined;
      const messageID = (props.messageID as string | undefined) ?? part?.messageID;
      if (part && messageID) {
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
      const field = props.field as string | undefined;
      const delta = props.delta as string | undefined;
      if (partID && field && typeof delta === 'string') {
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
  loadInitial: (selectedSessionId?: string) => Promise<void>;
  dispose: () => void;
};

export function createOpenCodeStore(paneId: string): OpenCodeStore {
  let state = createEmptyOpenCodeStore(paneId);
  const listeners = new Set<() => void>();
  let unlisten: UnlistenFn | null = null;

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const setState = (updater: (prev: OpenCodeStoreState) => OpenCodeStoreState) => {
    state = updater(state);
    notify();
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    loadInitial: async (selectedSessionId) => {
      const info = await getServerInfo(paneId);
      const sessions = await opencodeClient.listSessions(paneId);
      setState((prev) => {
        let next: OpenCodeStoreState = {
          ...prev,
          directory: info.directory,
          serverVersion: info.version ?? null,
          healthy: info.healthy,
        };
        for (const session of sessions) {
          next = upsertSession(next, session);
        }
        return next;
      });
      if (selectedSessionId) {
        const messages = await opencodeClient.listMessages(paneId, selectedSessionId);
        setState((prev) => {
          let next = prev;
          for (const message of messages) {
            next = upsertMessage(next, message);
            const parts = (message as Message & { parts?: Part[] }).parts;
            if (parts) {
              for (const part of parts) {
                next = upsertPart(next, message.id, part);
              }
            }
          }
          return next;
        });
      }
      if (!unlisten) {
        unlisten = await listen<OpenCodeEventEnvelope>('opencode://event', (ev) => {
          setState((prev) => applyOpenCodeEnvelope(prev, ev.payload));
        });
      }
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
