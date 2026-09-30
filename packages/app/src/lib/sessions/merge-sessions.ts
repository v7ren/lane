import { getPreset, type AgentCatalog } from '@loomria/shared';
import type { Session } from '@loomria/shared/opencode';
import type { PaneData } from '../../hooks/usePaneRegistry';
import type { SessionRailState } from '../../hooks/useSessionRail';
import {
  mergePaneAndSessionStatus,
  type DisplayStatus,
} from '../display-status';
import type { OpenCodeStoreState, SessionStatus } from '../opencode/store.js';
import { assembleMessageText, getPendingForSession, selectSessionStatus } from '../opencode/selectors.js';
import {
  deriveOpenCodeDisplayStatus,
  formatOpenCodeSessionDisplayLabel,
} from '../opencode/session-status.js';
import type { ShellSession } from '../shell-data';
import { isUserShellPane } from '../pane-surface';
import { buildPaneDisplayNames } from '../pane-display-name';
import { displayOpenCodeSessionTitle } from './session-display-title';

export function isOpenCodePane(pane: PaneData): boolean {
  return pane.info.agent_type === 'opencode_native';
}

export function mapOpenCodeDisplayStatus(
  ocStatus: SessionStatus,
  pending: ReturnType<typeof getPendingForSession>,
): DisplayStatus {
  return deriveOpenCodeDisplayStatus(ocStatus, pending);
}

export function openCodeSessionDisplayStatus(
  state: OpenCodeStoreState,
  sessionId: string,
): { status: DisplayStatus; label: string } {
  const pending = getPendingForSession(state, sessionId);
  const ocStatus = selectSessionStatus(state, sessionId);
  const issue = state.sessionIssues[sessionId];
  const status = deriveOpenCodeDisplayStatus(ocStatus, pending);
  return {
    status,
    label: formatOpenCodeSessionDisplayLabel(status, ocStatus, issue),
  };
}

function lastMessagePreview(state: OpenCodeStoreState, sessionId: string): string | undefined {
  const ids = state.messagesBySession[sessionId] ?? [];
  if (ids.length === 0) return undefined;
  const lastId = ids[ids.length - 1]!;
  const text = assembleMessageText(state, lastId).trim();
  if (!text) return undefined;
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

export function buildOpenCodeShellSessions(args: {
  paneId: string;
  state: OpenCodeStoreState;
  agentCatalog: AgentCatalog;
  selectedPaneId: string | null;
  selectedSessionId: string | null;
  readAtMs: Record<string, number>;
}): ShellSession[] {
  const { paneId, state, agentCatalog, selectedPaneId, selectedSessionId, readAtMs } = args;
  const agentLabel =
    getPreset(agentCatalog, 'opencode_native' as never)?.label ?? 'OpenCode';
  const workspaceDirectory = state.directory ?? undefined;
  const workspaceLabel = workspaceDirectory
    ? (workspaceDirectory.split(/[/\\]/).filter(Boolean).pop() ?? workspaceDirectory)
    : undefined;

  const rows: ShellSession[] = [];
  for (const sessionId of state.sessionOrder) {
    const session = state.sessions[sessionId];
    if (!session) continue;
    const pending = getPendingForSession(state, sessionId);
    const ocStatus = selectSessionStatus(state, sessionId);
    const issue = state.sessionIssues[sessionId];
    const status = deriveOpenCodeDisplayStatus(ocStatus, pending);
    const statusLabel = formatOpenCodeSessionDisplayLabel(status, ocStatus, issue);
    const updatedAt = session.time?.updated ?? session.time?.created ?? 0;
    const selected = selectedPaneId === paneId && selectedSessionId === sessionId;
    const lastRead = readAtMs[`${paneId}:${sessionId}`] ?? 0;
    const unread =
      !selected &&
      (status === 'needs_approval' ||
        status === 'waiting' ||
        (status === 'working' && updatedAt > lastRead) ||
        updatedAt > lastRead + 60_000);

    rows.push({
      id: sessionId,
      paneId,
      sessionId,
      parentSessionId: session.parentID,
      title: displayOpenCodeSessionTitle(state, sessionId, session.title),
      agentLabel: session.agent ?? agentLabel,
      status,
      statusLabel,
      updatedAt,
      unread,
      lastMessagePreview: lastMessagePreview(state, sessionId),
      workspaceDirectory,
      workspaceLabel,
      shareUrl: session.share?.url,
      reverted: Boolean(session.revert?.messageID),
    });
  }
  return rows;
}

export function buildPaneShellSessions(args: {
  panes: PaneData[];
  sessionStates: Map<string, SessionRailState>;
  agentCatalog: AgentCatalog;
  selectedPaneId: string | null;
  selectedSessionId: string | null;
}): ShellSession[] {
  const { panes, sessionStates, agentCatalog, selectedPaneId, selectedSessionId } = args;
  const paneTitles = buildPaneDisplayNames(panes, agentCatalog);
  const rows: ShellSession[] = [];

  for (const pane of panes) {
    if (isUserShellPane(pane.info.agent_type)) continue;
    if (isOpenCodePane(pane)) continue;
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
      workspaceDirectory: pane.info.cwd,
    });
  }
  return rows;
}

export function nestChildSessions(flat: ShellSession[]): ShellSession[] {
  const byId = new Map(flat.map((s) => [s.id, s]));
  const roots: ShellSession[] = [];
  const childrenByParent = new Map<string, ShellSession[]>();

  for (const row of flat) {
    const parentId = row.parentSessionId;
    if (parentId && byId.has(parentId)) {
      const list = childrenByParent.get(parentId) ?? [];
      list.push(row);
      childrenByParent.set(parentId, list);
    } else {
      roots.push(row);
    }
  }

  const out: ShellSession[] = [];
  for (const root of roots) {
    out.push(root);
    const kids = childrenByParent.get(root.id) ?? [];
    for (const child of kids) {
      out.push({ ...child, depth: (root.depth ?? 0) + 1 });
    }
  }
  return out;
}

export function mergeShellSessionLists(
  opencodeRows: ShellSession[],
  paneRows: ShellSession[],
): ShellSession[] {
  return nestChildSessions([...opencodeRows, ...paneRows]);
}
