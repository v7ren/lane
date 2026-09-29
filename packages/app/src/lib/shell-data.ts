import { getPreset } from '@loomria/shared';
import { useEffect, useMemo, useState } from 'react';
import { useAgentCatalog } from '../hooks/useAgentCatalog';
import { usePaneRegistry } from '../hooks/usePaneRegistry';
import { useProjectPath } from '../hooks/useProjectPath';
import { useSessionRail } from '../hooks/useSessionRail';
import { useDemoFixtures } from './demo/DemoContext';
import {
  buildDemoOpenCodeSessions,
  demoEnvironment,
  demoSessionSummary,
} from './demo/session-fixtures';
import type { DisplayStatus } from './display-status';
import { isUserShellPane } from './pane-surface';
import { selectSessionSummary } from './opencode/selectors.js';
import { getServerInfo } from './opencode/client.js';
import { opencodeSessionActions } from './sessions/opencode-session-actions';
import { filterSessions, sortShellSessions, type SessionSortMode } from './sessions/filter-sort';
import {
  buildOpenCodeShellSessions,
  buildPaneShellSessions,
  isOpenCodePane,
  mergeShellSessionLists,
} from './sessions/merge-sessions';
import { getSessionReadMap } from './sessions/session-read-state';
import { useOpenCodePaneStates, useEnsureOpenCodeStores } from './sessions/use-opencode-stores';
import { useShellSelection } from './shell-selection-context';
import { isTauriRuntime } from './is-tauri';

export type ShellSession = {
  id: string;
  paneId: string;
  sessionId?: string;
  parentSessionId?: string;
  title: string;
  agentLabel: string;
  status: DisplayStatus;
  updatedAt: number;
  unread: boolean;
  lastMessagePreview?: string;
  workspaceDirectory?: string;
  workspaceLabel?: string;
  shareUrl?: string;
  reverted?: boolean;
  depth?: number;
};

export type SessionSummary = {
  agent?: string;
  model?: string;
  provider?: string;
  tokens?: { input: number; output: number };
  costUsd?: number;
  todos?: { content: string; status: string }[];
};

export type EnvironmentInfo = {
  directory?: string;
  branch?: string;
  serverUrl?: string;
  serverStatus?: string;
  mcpSummary?: string;
  lspSummary?: string;
};

export function useSessionListFilter(): {
  query: string;
  setQuery: (q: string) => void;
  sortMode: SessionSortMode;
  setSortMode: (mode: SessionSortMode) => void;
} {
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SessionSortMode>('attention');
  return { query, setQuery, sortMode, setSortMode };
}

export function useSessionList(options?: { query?: string; sortMode?: SessionSortMode }): ShellSession[] {
  const demo = useDemoFixtures();
  const sessionStates = useSessionRail();
  const registry = usePaneRegistry();
  const agentCatalog = useAgentCatalog();
  const { selectedPaneId, selectedSessionId } = useShellSelection();
  const query = options?.query ?? '';
  const sortMode = options?.sortMode ?? 'attention';

  const panes = useMemo(
    () => registry.paneList.filter((p) => !p.info.id.startsWith('loomria-orchestrator-')),
    [registry.paneList],
  );

  const openCodePaneIds = useMemo(
    () => panes.filter(isOpenCodePane).map((p) => p.info.id),
    [panes],
  );

  const selectedByPane = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    if (selectedPaneId && selectedSessionId) {
      map[selectedPaneId] = selectedSessionId;
    }
    return map;
  }, [selectedPaneId, selectedSessionId]);

  useEnsureOpenCodeStores(demo ? [] : openCodePaneIds, selectedByPane);
  const ocStates = useOpenCodePaneStates(demo ? [] : openCodePaneIds);
  const readAtMs = useMemo(() => getSessionReadMap(), []);

  return useMemo(() => {
    if (demo) {
      const paneId = demo.defaultAgentPaneId;
      const demoOc = buildDemoOpenCodeSessions(paneId);
      const paneRows = buildPaneShellSessions({
        panes: demo.paneList.filter((p) => !isOpenCodePane(p)),
        sessionStates: demo.sessionStates,
        agentCatalog: demo.agentCatalog,
        selectedPaneId,
        selectedSessionId,
      });
      const merged = mergeShellSessionLists(demoOc, paneRows);
      return sortShellSessions(filterSessions(merged, query), sortMode);
    }

    const ocRows: ShellSession[] = [];
    for (const paneId of openCodePaneIds) {
      const state = ocStates.get(paneId);
      if (!state) continue;
      ocRows.push(
        ...buildOpenCodeShellSessions({
          paneId,
          state,
          agentCatalog,
          selectedPaneId,
          selectedSessionId,
          readAtMs,
        }),
      );
    }

    const paneRows = buildPaneShellSessions({
      panes,
      sessionStates,
      agentCatalog,
      selectedPaneId,
      selectedSessionId,
    });

    let rows = mergeShellSessionLists(ocRows, paneRows);
    if (rows.length === 0) {
      for (const [paneId, session] of sessionStates) {
        if (isUserShellPane(session.agent_type ?? '')) continue;
        rows.push({
          id: paneId,
          paneId,
          title: `Session ${paneId.slice(0, 8)}`,
          agentLabel: 'Agent',
          status: 'connecting',
          updatedAt: session.updated_at_ms,
          unread: false,
        });
      }
    }

    return sortShellSessions(filterSessions(rows, query), sortMode);
  }, [
    agentCatalog,
    demo,
    ocStates,
    openCodePaneIds,
    panes,
    query,
    readAtMs,
    selectedPaneId,
    selectedSessionId,
    sessionStates,
    sortMode,
  ]);
}

export function useSelectedSession(): ShellSession | null {
  const list = useSessionList();
  const { selectedPaneId, selectedSessionId } = useShellSelection();
  if (!selectedPaneId) return list[0] ?? null;
  const match = list.find(
    (s) =>
      s.paneId === selectedPaneId &&
      (selectedSessionId
        ? s.sessionId === selectedSessionId || s.id === selectedSessionId
        : !s.sessionId || s.sessionId === s.id),
  );
  return match ?? list.find((s) => s.paneId === selectedPaneId) ?? list[0] ?? null;
}

export function useSessionSummary(session: ShellSession | null): SessionSummary {
  const demo = useDemoFixtures();
  const agentCatalog = useAgentCatalog();
  const sessionStates = useSessionRail();
  const ocStates = useOpenCodePaneStates(
    session?.sessionId && session.paneId ? [session.paneId] : [],
  );

  return useMemo(() => {
    if (!session) return {};
    if (demo) return demoSessionSummary(session);

    if (session.sessionId) {
      const state = ocStates.get(session.paneId);
      if (state) {
        const summary = selectSessionSummary(state, session.sessionId);
        const tokens = state.sessions[session.sessionId]?.tokens;
        return {
          agent: summary.agent ?? session.agentLabel,
          model: summary.model,
          provider: summary.provider,
          tokens: tokens
            ? { input: tokens.input, output: tokens.output + tokens.reasoning }
            : undefined,
          costUsd: summary.costUsd,
          todos: summary.todos.map((t) => ({ content: t.content, status: t.status })),
        };
      }
    }

    const rail = sessionStates.get(session.paneId);
    const agentType = rail?.agent_type;
    const agent =
      (agentType ? getPreset(agentCatalog, agentType as never)?.label : undefined) ?? agentType;
    return { agent: agent ?? undefined };
  }, [agentCatalog, demo, ocStates, session, sessionStates]);
}

export function useEnvironment(): EnvironmentInfo {
  const { projectPath } = useProjectPath();
  const demo = useDemoFixtures();
  const selected = useSelectedSession();
  const paneId = selected?.paneId ?? null;
  const ocStates = useOpenCodePaneStates(paneId ? [paneId] : []);
  const [serverMeta, setServerMeta] = useState<{ url?: string; status?: string }>({});
  const [infra, setInfra] = useState<{ mcp?: string; lsp?: string; branch?: string }>({});

  useEffect(() => {
    if (demo || !paneId || !isTauriRuntime()) return;
    let cancelled = false;
    void getServerInfo(paneId)
      .then((info) => {
        if (!cancelled) {
          setServerMeta({
            url: info.healthy ? 'OpenCode (local)' : undefined,
            status: info.healthy ? 'connected' : 'disconnected',
          });
        }
      })
      .catch(() => {
        if (!cancelled) setServerMeta({ status: 'disconnected' });
      });
    return () => {
      cancelled = true;
    };
  }, [demo, paneId]);

  useEffect(() => {
    if (demo || !paneId || !selected?.sessionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [mcp, lsp, vcs] = await Promise.all([
          opencodeSessionActions.listMcp(paneId).catch(() => null),
          opencodeSessionActions.listLsp(paneId).catch(() => null),
          opencodeSessionActions.getVcsBranch(paneId).catch(() => null),
        ]);
        if (cancelled) return;
        setInfra({
          mcp: summarizeMcp(mcp),
          lsp: summarizeLsp(lsp),
          branch: vcs?.branch ?? undefined,
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [demo, paneId, selected?.sessionId]);

  return useMemo(() => {
    if (demo) return demoEnvironment();
    const state = paneId ? ocStates.get(paneId) : undefined;
    return {
      directory: state?.directory ?? projectPath ?? selected?.workspaceDirectory ?? undefined,
      branch: state?.vcsBranch ?? infra.branch ?? undefined,
      serverUrl: serverMeta.url,
      serverStatus: state?.connectionStatus ?? serverMeta.status ?? 'unknown',
      mcpSummary: infra.mcp,
      lspSummary: infra.lsp,
    };
  }, [demo, infra, ocStates, paneId, projectPath, selected?.workspaceDirectory, serverMeta]);
}

function summarizeMcp(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const servers = (raw as { servers?: unknown[] }).servers;
  if (Array.isArray(servers)) return `${servers.length} server${servers.length === 1 ? '' : 's'}`;
  return 'OK';
}

function summarizeLsp(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const entries = Object.keys(raw as Record<string, unknown>);
  return entries.length ? entries.slice(0, 3).join(' · ') : 'None';
}

export function isSessionReverted(session: ShellSession | null): boolean {
  return Boolean(session?.reverted);
}
