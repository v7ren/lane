import { getPreset } from '@loomria/shared';
import { useMemo } from 'react';
import { useAgentCatalog } from '../hooks/useAgentCatalog';
import { usePaneRegistry } from '../hooks/usePaneRegistry';
import { useProjectPath } from '../hooks/useProjectPath';
import { useSessionRail } from '../hooks/useSessionRail';
import { useDemoFixtures } from './demo/DemoContext';
import {
  DISPLAY_STATUS_ORDER,
  mergePaneAndSessionStatus,
  type DisplayStatus,
} from './display-status';
import { buildPaneDisplayNames } from './pane-display-name';
import { useShellSelection } from './shell-selection-context';
import { isUserShellPane } from './pane-surface';

export type ShellSession = {
  id: string;
  paneId: string;
  title: string;
  agentLabel: string;
  status: DisplayStatus;
  updatedAt: number;
  unread: boolean;
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
};

function sortSessions(rows: ShellSession[]): ShellSession[] {
  return [...rows].sort((a, b) => {
    const sa = DISPLAY_STATUS_ORDER[a.status] ?? 99;
    const sb = DISPLAY_STATUS_ORDER[b.status] ?? 99;
    if (sa !== sb) return sa - sb;
    return b.updatedAt - a.updatedAt;
  });
}

export function useSessionList(): ShellSession[] {
  const demo = useDemoFixtures();
  const sessionStates = useSessionRail();
  const registry = usePaneRegistry();
  const agentCatalog = useAgentCatalog();
  const { selectedPaneId } = useShellSelection();

  const paneTitles = useMemo(
    () => buildPaneDisplayNames(registry.paneList, agentCatalog),
    [agentCatalog, registry.paneList],
  );

  return useMemo(() => {
    const panes = registry.paneList.filter((p) => !p.info.id.startsWith('loomria-orchestrator-'));
    const rows: ShellSession[] = [];

    for (const pane of panes) {
      if (isUserShellPane(pane.info.agent_type)) continue;
      const session = sessionStates.get(pane.info.id);
      const status = mergePaneAndSessionStatus(pane.status, session?.state);
      const title =
        paneTitles.get(pane.info.id) ??
        (session?.agent_type
          ? getPreset(agentCatalog, session.agent_type as never)?.label
          : undefined) ??
        `Session ${pane.info.id.slice(0, 8)}`;
      const agentLabel =
        (session?.agent_type
          ? getPreset(agentCatalog, session.agent_type as never)?.label
          : undefined) ??
        getPreset(agentCatalog, pane.info.agent_type as never)?.label ??
        pane.info.agent_type;

      rows.push({
        id: pane.info.id,
        paneId: pane.info.id,
        title,
        agentLabel,
        status,
        updatedAt: session?.updated_at_ms ?? pane.info.last_output_at ?? 0,
        unread: selectedPaneId !== pane.info.id && status === 'needs_approval',
      });
    }

    if (rows.length === 0 && demo) {
      for (const [paneId, session] of sessionStates) {
        if (isUserShellPane(session.agent_type ?? '')) continue;
        const status = mergePaneAndSessionStatus(null, session.state);
        rows.push({
          id: paneId,
          paneId,
          title: paneTitles.get(paneId) ?? `Session ${paneId.slice(0, 8)}`,
          agentLabel:
            getPreset(agentCatalog, (session.agent_type as never) ?? 'opencode_native')?.label ??
            'Agent',
          status,
          updatedAt: session.updated_at_ms,
          unread: selectedPaneId !== paneId && status === 'needs_approval',
        });
      }
    }

    return sortSessions(rows);
  }, [
    agentCatalog,
    demo,
    paneTitles,
    registry.paneList,
    selectedPaneId,
    sessionStates,
  ]);
}

export function useSelectedSession(): ShellSession | null {
  const list = useSessionList();
  const { selectedPaneId } = useShellSelection();
  if (!selectedPaneId) return list[0] ?? null;
  return list.find((s) => s.paneId === selectedPaneId) ?? list[0] ?? null;
}

export function useSessionSummary(id: string | null): SessionSummary {
  const demo = useDemoFixtures();
  const agentCatalog = useAgentCatalog();
  const sessionStates = useSessionRail();

  return useMemo(() => {
    if (!id) return {};
    const session = sessionStates.get(id);
    const agentType = session?.agent_type;
    const agent =
      (agentType ? getPreset(agentCatalog, agentType as never)?.label : undefined) ?? agentType;

    const timeline = demo?.agentSessions[id]?.timeline;
    const usage = timeline?.usage;

    return {
      agent: agent ?? undefined,
      model: agentType === 'opencode_native' ? 'deepseek-v3.1-flash' : undefined,
      provider: agentType === 'opencode_native' ? 'opencode-go' : undefined,
      tokens: usage
        ? {
            input: usage.input_tokens ?? 0,
            output: usage.output_tokens ?? 0,
          }
        : undefined,
      costUsd: usage?.cost_usd,
      todos: demo && id
        ? [
            { content: 'Review bridge reconnect changes', status: 'in_progress' },
            { content: 'Run app test suite', status: 'pending' },
          ]
        : undefined,
    };
  }, [agentCatalog, demo, id, sessionStates]);
}

export function useEnvironment(): EnvironmentInfo {
  const { projectPath } = useProjectPath();
  const demo = useDemoFixtures();

  return useMemo(
    () => ({
      directory: projectPath ?? demo?.projectPath,
      branch: demo ? 'rebuild/shell' : undefined,
      serverUrl: demo ? 'http://127.0.0.1:4096' : undefined,
      serverStatus: demo ? 'connected' : undefined,
    }),
    [demo, projectPath],
  );
}
