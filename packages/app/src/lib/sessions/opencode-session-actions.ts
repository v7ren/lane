import { invoke } from '@tauri-apps/api/core';
import type { Message, Session } from '@loomria/shared/opencode';
import { getOpenCodeTransport } from '../opencode/transport.js';

export type OpenCodeRequestArgs = {
  pane_id: string;
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
};

async function request<T = unknown>(args: OpenCodeRequestArgs): Promise<T> {
  const custom = getOpenCodeTransport();
  if (custom) return (await custom(args)) as T;
  return invoke<T>('opencode_request', { args });
}

export type CreateSessionBody = {
  title?: string;
  agent?: string;
  parentID?: string;
  model?: { id: string; providerID: string; variant?: string };
};

export type SummarizeSessionBody = {
  providerID: string;
  modelID: string;
  auto?: boolean;
};

export type RevertSessionBody = {
  messageID: string;
  partID?: string;
};

export type ForkSessionBody = {
  messageID?: string;
};

export const opencodeSessionActions = {
  createSession: (paneId: string, body: CreateSessionBody = {}) =>
    request<Session>({ pane_id: paneId, method: 'POST', path: '/session', body }),

  patchSessionTitle: (paneId: string, sessionId: string, title: string) =>
    request<Session>({
      pane_id: paneId,
      method: 'PATCH',
      path: `/session/${sessionId}`,
      body: { title },
    }),

  deleteSession: (paneId: string, sessionId: string) =>
    request<null>({ pane_id: paneId, method: 'DELETE', path: `/session/${sessionId}` }),

  forkSession: (paneId: string, sessionId: string, body: ForkSessionBody = {}) =>
    request<Session>({
      pane_id: paneId,
      method: 'POST',
      path: `/session/${sessionId}/fork`,
      body,
    }),

  revertSession: (paneId: string, sessionId: string, body: RevertSessionBody) =>
    request<Session>({
      pane_id: paneId,
      method: 'POST',
      path: `/session/${sessionId}/revert`,
      body,
    }),

  unrevertSession: (paneId: string, sessionId: string) =>
    request<Session>({
      pane_id: paneId,
      method: 'POST',
      path: `/session/${sessionId}/unrevert`,
    }),

  summarizeSession: (paneId: string, sessionId: string, body: SummarizeSessionBody) =>
    request<boolean>({
      pane_id: paneId,
      method: 'POST',
      path: `/session/${sessionId}/summarize`,
      body,
    }),

  shareSession: (paneId: string, sessionId: string) =>
    request<Session>({ pane_id: paneId, method: 'POST', path: `/session/${sessionId}/share` }),

  unshareSession: (paneId: string, sessionId: string) =>
    request<Session>({ pane_id: paneId, method: 'DELETE', path: `/session/${sessionId}/share` }),

  listSessionChildren: (paneId: string, sessionId: string) =>
    request<Session[]>({
      pane_id: paneId,
      method: 'GET',
      path: `/session/${sessionId}/children`,
    }),

  listMessages: (paneId: string, sessionId: string) =>
    request<Message[]>({ pane_id: paneId, method: 'GET', path: `/session/${sessionId}/message` }),

  promptAsync: (
    paneId: string,
    sessionId: string,
    body: {
      parts: { type: 'text'; text: string }[];
      agent?: string;
      model?: { providerID: string; modelID: string };
    },
  ) =>
    request<null>({
      pane_id: paneId,
      method: 'POST',
      path: `/session/${sessionId}/prompt_async`,
      body,
    }),

  getSession: (paneId: string, sessionId: string) =>
    request<Session>({ pane_id: paneId, method: 'GET', path: `/session/${sessionId}` }),

  listSessions: (paneId: string) =>
    request<Session[]>({ pane_id: paneId, method: 'GET', path: '/session' }),

  getSessionStatus: (paneId: string) =>
    request<Record<string, string>>({ pane_id: paneId, method: 'GET', path: '/session/status' }),

  getVcsBranch: (paneId: string) =>
    request<{ branch?: string }>({ pane_id: paneId, method: 'GET', path: '/vcs' }),

  listMcp: (paneId: string) =>
    request<unknown>({ pane_id: paneId, method: 'GET', path: '/mcp' }),

  listLsp: (paneId: string) =>
    request<unknown>({ pane_id: paneId, method: 'GET', path: '/lsp' }),
};

/** Phase 3 transcript: fork the current session at a message. */
export async function forkAt(
  paneId: string,
  sourceSessionId: string,
  messageId: string,
): Promise<Session> {
  return opencodeSessionActions.forkSession(paneId, sourceSessionId, { messageID: messageId });
}
