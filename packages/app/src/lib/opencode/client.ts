import { invoke } from '@tauri-apps/api/core';
import type { components } from '@loomria/shared/opencode';

import { getOpenCodeTransport } from './transport.js';

type Session = components['schemas']['Session'];
type Message = components['schemas']['Message'];
type Part = components['schemas']['Part'];
type Todo = components['schemas']['Todo'];
type Agent = components['schemas']['Agent'];
type Command = components['schemas']['Command'];
type FileNode = components['schemas']['FileNode'];
type PermissionAsked = components['schemas']['PermissionAsked'];
type QuestionRequest = components['schemas']['QuestionRequest'];

export type OpenCodeRequestArgs = {
  pane_id: string;
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
};

export type OpenCodeServerInfo = {
  version?: string;
  url_hidden: boolean;
  healthy: boolean;
  directory: string;
  attached_session_id?: string | null;
};

async function tauriRequest<T = unknown>(args: OpenCodeRequestArgs): Promise<T> {
  return invoke<T>('opencode_request', { args });
}

export { setOpenCodeTransport, getOpenCodeTransport } from './transport.js';

export async function openCodeRequest<T = unknown>(args: OpenCodeRequestArgs): Promise<T> {
  const openCodeTransport = getOpenCodeTransport();
  if (openCodeTransport) {
    return openCodeTransport(args) as Promise<T>;
  }
  return tauriRequest<T>(args);
}

export async function getServerInfo(paneId: string): Promise<OpenCodeServerInfo> {
  return invoke<OpenCodeServerInfo>('opencode_server_info', { paneId });
}

export async function selectTuiSession(paneId: string, sessionId: string): Promise<void> {
  await invoke('opencode_select_tui_session', { paneId, sessionId });
}

/** OpenCode 1.18+ returns `{ all, default, connected }` from `/provider`. */
export async function fetchProviderCatalog(paneId: string): Promise<unknown> {
  try {
    return await openCodeRequest<unknown>({ pane_id: paneId, method: 'GET', path: '/provider' });
  } catch {
    return openCodeRequest<unknown>({ pane_id: paneId, method: 'GET', path: '/config/providers' });
  }
}

export const opencodeClient = {
  listSessions: (paneId: string) => openCodeRequest<Session[]>({ pane_id: paneId, method: 'GET', path: '/session' }),
  getSession: (paneId: string, sessionId: string) =>
    openCodeRequest<Session>({ pane_id: paneId, method: 'GET', path: `/session/${sessionId}` }),
  createSession: (paneId: string, body: { title?: string }) =>
    openCodeRequest<Session>({ pane_id: paneId, method: 'POST', path: '/session', body }),
  patchSession: (paneId: string, sessionId: string, body: Record<string, unknown>) =>
    openCodeRequest<Session>({ pane_id: paneId, method: 'PATCH', path: `/session/${sessionId}`, body }),
  deleteSession: (paneId: string, sessionId: string) =>
    openCodeRequest<null>({ pane_id: paneId, method: 'DELETE', path: `/session/${sessionId}` }),
  listMessages: (paneId: string, sessionId: string) =>
    openCodeRequest<Message[]>({ pane_id: paneId, method: 'GET', path: `/session/${sessionId}/message` }),
  getMessage: (paneId: string, sessionId: string, messageId: string) =>
    openCodeRequest<Message>({
      pane_id: paneId,
      method: 'GET',
      path: `/session/${sessionId}/message/${messageId}`,
    }),
  promptAsync: (paneId: string, sessionId: string, body: Record<string, unknown>) =>
    openCodeRequest<null>({ pane_id: paneId, method: 'POST', path: `/session/${sessionId}/prompt_async`, body }),
  sessionCommand: (paneId: string, sessionId: string, body: Record<string, unknown>) =>
    openCodeRequest<unknown>({ pane_id: paneId, method: 'POST', path: `/session/${sessionId}/command`, body }),
  sessionShell: (paneId: string, sessionId: string, body: Record<string, unknown>) =>
    openCodeRequest<unknown>({ pane_id: paneId, method: 'POST', path: `/session/${sessionId}/shell`, body }),
  abortSession: (paneId: string, sessionId: string) =>
    openCodeRequest<null>({ pane_id: paneId, method: 'POST', path: `/session/${sessionId}/abort` }),
  listPermissions: (paneId: string) => openCodeRequest<PermissionAsked[]>({ pane_id: paneId, method: 'GET', path: '/permission' }),
  replyPermission: (paneId: string, requestId: string, body: Record<string, unknown>) =>
    openCodeRequest<null>({ pane_id: paneId, method: 'POST', path: `/permission/${requestId}/reply`, body }),
  listQuestions: (paneId: string) =>
    openCodeRequest<QuestionRequest[]>({ pane_id: paneId, method: 'GET', path: '/question' }),
  replyQuestion: (paneId: string, requestId: string, body: Record<string, unknown>) =>
    openCodeRequest<null>({ pane_id: paneId, method: 'POST', path: `/question/${requestId}/reply`, body }),
  rejectQuestion: (paneId: string, requestId: string, body?: Record<string, unknown>) =>
    openCodeRequest<null>({ pane_id: paneId, method: 'POST', path: `/question/${requestId}/reject`, body }),
  listAgents: (paneId: string) => openCodeRequest<Agent[]>({ pane_id: paneId, method: 'GET', path: '/agent' }),
  listCommands: (paneId: string) => openCodeRequest<Command[]>({ pane_id: paneId, method: 'GET', path: '/command' }),
  listProviders: (paneId: string) => openCodeRequest<unknown>({ pane_id: paneId, method: 'GET', path: '/provider' }),
  listConfigProviders: (paneId: string) =>
    openCodeRequest<unknown>({ pane_id: paneId, method: 'GET', path: '/config/providers' }),
  getConfig: (paneId: string) => openCodeRequest<Record<string, unknown>>({ pane_id: paneId, method: 'GET', path: '/config' }),
  patchConfig: (paneId: string, body: Record<string, unknown>) =>
    openCodeRequest<Record<string, unknown>>({ pane_id: paneId, method: 'PATCH', path: '/config', body }),
  listFiles: (paneId: string, query?: Record<string, string>) =>
    openCodeRequest<FileNode[]>({ pane_id: paneId, method: 'GET', path: '/file', query }),
  findFiles: async (paneId: string, query: Record<string, string>) => {
    const raw = await openCodeRequest<unknown>({
      pane_id: paneId,
      method: 'GET',
      path: '/find/file',
      query,
    });
    if (!Array.isArray(raw)) return [];
    return raw.map((entry) =>
      typeof entry === 'string' ? { path: entry } : (entry as { path: string; name?: string }),
    );
  },
  getProjectCurrent: (paneId: string) =>
    openCodeRequest<Record<string, unknown>>({ pane_id: paneId, method: 'GET', path: '/project/current' }),
  getVcsStatus: (paneId: string) =>
    openCodeRequest<Record<string, unknown>>({ pane_id: paneId, method: 'GET', path: '/vcs/status' }),
  getSessionTodos: (paneId: string, sessionId: string) =>
    openCodeRequest<Todo[]>({ pane_id: paneId, method: 'GET', path: `/session/${sessionId}/todo` }),
  getSessionStatus: (paneId: string) =>
    openCodeRequest<Record<string, unknown>>({ pane_id: paneId, method: 'GET', path: '/session/status' }),
  getSessionParts: (paneId: string, sessionId: string, messageId: string) =>
    openCodeRequest<Part[]>({
      pane_id: paneId,
      method: 'GET',
      path: `/session/${sessionId}/message/${messageId}`,
    }),
};
