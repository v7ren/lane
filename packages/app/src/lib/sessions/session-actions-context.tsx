import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import type { Session } from '@loomria/shared/opencode';
import { loadSettings } from '../settings';
import {
  forkAt,
  forkAtLatestAssistant,
  NoAssistantMessageError,
  opencodeSessionActions,
  type CreateSessionBody,
  type SummarizeSessionBody,
} from './opencode-session-actions';
import { exportSessionTranscript } from './export-transcript';
import { useShellToast } from './shell-toast';
import type { ShellSession } from '../shell-data';
import { isTauriRuntime } from '../is-tauri';

export type SessionActionsApi = {
  createSession: (paneId: string, body?: CreateSessionBody) => Promise<Session | null>;
  renameSession: (paneId: string, sessionId: string, title: string) => Promise<void>;
  deleteSession: (paneId: string, sessionId: string) => Promise<void>;
  forkAt: (paneId: string, sessionId: string, messageId: string) => Promise<Session | null>;
  forkFromHere: (session: ShellSession) => Promise<void>;
  revertSession: (paneId: string, sessionId: string, messageId: string) => Promise<void>;
  unrevertSession: (paneId: string, sessionId: string) => Promise<void>;
  summarizeSession: (paneId: string, sessionId: string) => Promise<void>;
  shareSession: (paneId: string, sessionId: string) => Promise<string | null>;
  unshareSession: (paneId: string, sessionId: string) => Promise<void>;
  exportTranscript: (
    session: ShellSession,
    format: 'markdown' | 'json',
  ) => Promise<void>;
};

const SessionActionsContext = createContext<SessionActionsApi | null>(null);

export function SessionActionsProvider({
  children,
  onSelectSession,
}: {
  children: ReactNode;
  onSelectSession: (paneId: string, sessionId?: string) => void;
}) {
  const { pushToast } = useShellToast();

  const createSession = useCallback(
    async (paneId: string, body: CreateSessionBody = {}) => {
      try {
        const settings = await loadSettings();
        const withDefaults: CreateSessionBody = {
          ...body,
          agent: body.agent,
          model:
            body.model ??
            (settings.opencode_model_id && settings.opencode_model_provider
              ? {
                  id: settings.opencode_model_id,
                  providerID: settings.opencode_model_provider,
                }
              : undefined),
        };
        const session = await opencodeSessionActions.createSession(paneId, withDefaults);
        onSelectSession(paneId, session.id);
        return session;
      } catch (err) {
        pushToast(String(err));
        return null;
      }
    },
    [onSelectSession, pushToast],
  );

  const renameSession = useCallback(
    async (paneId: string, sessionId: string, title: string) => {
      try {
        await opencodeSessionActions.patchSessionTitle(paneId, sessionId, title);
      } catch (err) {
        pushToast(String(err));
      }
    },
    [pushToast],
  );

  const deleteSession = useCallback(
    async (paneId: string, sessionId: string) => {
      try {
        await opencodeSessionActions.deleteSession(paneId, sessionId);
      } catch (err) {
        pushToast(String(err));
      }
    },
    [pushToast],
  );

  const forkAtAction = useCallback(
    async (paneId: string, sessionId: string, messageId: string) => {
      try {
        const session = await forkAt(paneId, sessionId, messageId);
        onSelectSession(paneId, session.id);
        return session;
      } catch (err) {
        pushToast(String(err));
        return null;
      }
    },
    [onSelectSession, pushToast],
  );

  const forkFromHere = useCallback(
    async (session: ShellSession) => {
      if (!session.sessionId) return;
      try {
        const forked = await forkAtLatestAssistant(session.paneId, session.sessionId);
        onSelectSession(session.paneId, forked.id);
      } catch (err) {
        pushToast(
          err instanceof NoAssistantMessageError ? err.message : `Fork failed: ${String(err)}`,
        );
      }
    },
    [onSelectSession, pushToast],
  );

  const revertSession = useCallback(
    async (paneId: string, sessionId: string, messageId: string) => {
      try {
        await opencodeSessionActions.revertSession(paneId, sessionId, { messageID: messageId });
      } catch (err) {
        pushToast(String(err));
      }
    },
    [pushToast],
  );

  const unrevertSession = useCallback(
    async (paneId: string, sessionId: string) => {
      try {
        await opencodeSessionActions.unrevertSession(paneId, sessionId);
      } catch (err) {
        pushToast(String(err));
      }
    },
    [pushToast],
  );

  const summarizeSession = useCallback(
    async (paneId: string, sessionId: string) => {
      try {
        const settings = await loadSettings();
        const providerID = settings.opencode_model_provider ?? 'opencode-go';
        const modelID = settings.opencode_model_id ?? 'deepseek-v3.1-flash';
        const body: SummarizeSessionBody = { providerID, modelID };
        await opencodeSessionActions.summarizeSession(paneId, sessionId, body);
        pushToast('Summarize requested');
      } catch (err) {
        pushToast(String(err));
      }
    },
    [pushToast],
  );

  const shareSession = useCallback(
    async (paneId: string, sessionId: string) => {
      try {
        const session = await opencodeSessionActions.shareSession(paneId, sessionId);
        const url = session.share?.url ?? null;
        if (url && typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(url);
          pushToast('OpenCode share link copied');
        }
        return url;
      } catch (err) {
        pushToast(String(err));
        return null;
      }
    },
    [pushToast],
  );

  const unshareSession = useCallback(
    async (paneId: string, sessionId: string) => {
      try {
        await opencodeSessionActions.unshareSession(paneId, sessionId);
      } catch (err) {
        pushToast(String(err));
      }
    },
    [pushToast],
  );

  const exportTranscript = useCallback(
    async (session: ShellSession, format: 'markdown' | 'json') => {
      if (!session.sessionId) return;
      try {
        const { contents, defaultName } = await exportSessionTranscript({
          paneId: session.paneId,
          sessionId: session.sessionId,
          title: session.title,
          format,
        });
        if (!isTauriRuntime()) {
          pushToast('Export requires the desktop app');
          return;
        }
        const path = await save({
          defaultPath: defaultName,
          filters: [
            format === 'json'
              ? { name: 'JSON', extensions: ['json'] }
              : { name: 'Markdown', extensions: ['md'] },
          ],
        });
        if (!path) return;
        await invoke('plugin:fs|write_text_file', { path, contents });
        pushToast('Transcript exported');
      } catch (err) {
        pushToast(String(err));
      }
    },
    [pushToast],
  );

  const value = useMemo<SessionActionsApi>(
    () => ({
      createSession,
      renameSession,
      deleteSession,
      forkAt: forkAtAction,
      forkFromHere,
      revertSession,
      unrevertSession,
      summarizeSession,
      shareSession,
      unshareSession,
      exportTranscript,
    }),
    [
      createSession,
      deleteSession,
      exportTranscript,
      forkAtAction,
      forkFromHere,
      renameSession,
      revertSession,
      shareSession,
      summarizeSession,
      unshareSession,
      unrevertSession,
    ],
  );

  return (
    <SessionActionsContext.Provider value={value}>{children}</SessionActionsContext.Provider>
  );
}

export function useSessionActions(): SessionActionsApi {
  const ctx = useContext(SessionActionsContext);
  if (!ctx) {
    throw new Error('useSessionActions must be used within SessionActionsProvider');
  }
  return ctx;
}

export { forkAt };
