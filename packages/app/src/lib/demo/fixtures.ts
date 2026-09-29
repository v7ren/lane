import type { AgentCatalog } from '@loomria/shared';
import type { Capabilities } from '../agent-events';
import type { AgentEventEnvelope } from '../agent-events';
import { opencodeCapabilities } from '../opencode-agent-adapter';
import { reduceAgentTimeline, type AgentTimelineViewModel } from '../agent-timeline-reducer';
import type { PaneData } from '../../hooks/usePaneRegistry';
import type { SessionRailState } from '../../hooks/useSessionRail';
import type { DemoVariant } from '../demo-mode';

export type DemoAgentSessionFixture = {
  capabilities: Capabilities;
  source: 'protocol';
  timeline: AgentTimelineViewModel;
};

export type DemoFixtures = {
  variant: DemoVariant;
  projectPath: string;
  agentCatalog: AgentCatalog;
  paneList: PaneData[];
  sessionStates: Map<string, SessionRailState>;
  agentSessions: Record<string, DemoAgentSessionFixture>;
  defaultAgentPaneId: string;
};

function agentSummary(
  id: string,
  label: string,
  command: string,
): AgentCatalog['agents'][number] {
  return {
    id,
    label,
    description: `${label} demo session`,
    icon: 'terminal',
    is_tui: true,
    command,
    base_args: [],
    show_in_new_pane_menu: true,
    default_worker: id === 'opencode_native',
    spawn_handler: null,
  };
}

function demoCatalog(): AgentCatalog {
  return {
    agents: [
      agentSummary('codex', 'Codex CLI', 'codex'),
      agentSummary('claude', 'Claude Code', 'claude'),
      agentSummary('opencode_native', 'OpenCode', 'opencode'),
      agentSummary('powershell', 'PowerShell', 'pwsh'),
    ],
    report: { errors: [] },
  };
}

function pane(
  id: string,
  agent_type: string,
  status: PaneData['status'],
  opts?: { pid?: number; cwd?: string },
): PaneData {
  const now = Date.now();
  return {
    info: {
      id,
      agent_type,
      pid: opts?.pid ?? 1000 + id.length,
      status,
      created_at: now - 60_000,
      last_output_at: now,
      cwd: opts?.cwd ?? 'C:\\Users\\demo\\loomria',
      cols: 120,
      rows: 32,
    },
    status,
  };
}

function opencodeTimelineEnvelopes(paneId: string): AgentEventEnvelope[] {
  return [
    {
      pane_id: paneId,
      seq: 1,
      event: { type: 'turn_started', turn_id: 'turn-1' },
    },
    {
      pane_id: paneId,
      seq: 2,
      event: {
        type: 'message_completed',
        turn_id: 'turn-1',
        message_id: 'u1',
        role: 'user',
        text: 'Add retry logic to the bridge SSE reconnect loop.',
      },
    },
    {
      pane_id: paneId,
      seq: 3,
      event: {
        type: 'message_delta',
        turn_id: 'turn-1',
        message_id: 'a1',
        role: 'assistant',
        text: "I'll update the bridge client to backoff with jitter",
      },
    },
    {
      pane_id: paneId,
      seq: 4,
      event: {
        type: 'tool_started',
        turn_id: 'turn-1',
        tool_id: 'tool-read',
        name: 'read_file',
        input_summary: 'packages/app/src/lib/bridge.ts',
      },
    },
    {
      pane_id: paneId,
      seq: 5,
      event: {
        type: 'tool_completed',
        turn_id: 'turn-1',
        tool_id: 'tool-read',
        status: 'ok',
        output_summary: 'Read 672 lines',
      },
    },
    {
      pane_id: paneId,
      seq: 6,
      event: {
        type: 'message_completed',
        turn_id: 'turn-1',
        message_id: 'a1',
        role: 'assistant',
        text: "I'll update the bridge client to backoff with jitter and register session_state on localhost EventSource.",
      },
    },
    {
      pane_id: paneId,
      seq: 7,
      event: { type: 'files_changed', paths: ['packages/app/src/lib/bridge.ts'] },
    },
    {
      pane_id: paneId,
      seq: 8,
      event: {
        type: 'approval_requested',
        approval_id: 'ap-demo-run-tests',
        title: 'Run command',
        detail: 'npm run test --workspace=@loomria/app',
        kind: 'command',
        options: ['allow_once', 'allow_always', 'deny'],
      },
    },
    {
      pane_id: paneId,
      seq: 9,
      event: {
        type: 'usage',
        input_tokens: 4200,
        output_tokens: 890,
        cost_usd: 0.018,
      },
    },
  ];
}

export function buildDemoFixtures(variant: DemoVariant): DemoFixtures {
  const catalog = demoCatalog();
  if (variant === 'empty') {
    return {
      variant,
      projectPath: 'C:\\Users\\demo\\loomria',
      agentCatalog: catalog,
      paneList: [],
      sessionStates: new Map(),
      agentSessions: {},
      defaultAgentPaneId: 'demo-opencode-1',
    };
  }

  const paneIds = {
    codex: 'demo-codex-1',
    claude: 'demo-claude-1',
    opencode: 'demo-opencode-1',
    shell: 'demo-powershell-1',
    codexRate: 'demo-codex-2',
  };

  const paneList: PaneData[] = [
    pane(paneIds.codex, 'codex', 'running', {
      pid: 1011,
      cwd: 'C:\\Users\\demo\\loomria\\packages\\api',
    }),
    pane(paneIds.claude, 'claude', 'idle', { pid: 1020 }),
    pane(paneIds.opencode, 'opencode_native', 'waiting_input', { pid: 1030 }),
    pane(paneIds.shell, 'powershell', 'idle', { pid: 1040 }),
    pane(paneIds.codexRate, 'codex', 'running', {
      pid: 1013,
      cwd: 'C:\\Users\\demo\\loomria\\packages\\web',
    }),
  ];

  const now = Date.now();
  const sessionStates = new Map<string, SessionRailState>([
    [
      paneIds.opencode,
      {
        pane_id: paneIds.opencode,
        agent_type: 'opencode_native',
        state: 'needs_approval',
        updated_at_ms: now,
        detail: 'npm run test --workspace=@loomria/app',
      },
    ],
    [
      paneIds.codex,
      {
        pane_id: paneIds.codex,
        agent_type: 'codex',
        state: 'working',
        updated_at_ms: now - 5000,
        detail: 'Editing auth module',
      },
    ],
    [
      paneIds.claude,
      {
        pane_id: paneIds.claude,
        agent_type: 'claude',
        state: 'idle',
        updated_at_ms: now - 120_000,
      },
    ],
    [
      paneIds.shell,
      {
        pane_id: paneIds.shell,
        agent_type: 'powershell',
        state: 'done',
        updated_at_ms: now - 300_000,
        detail: 'Build finished',
      },
    ],
    [
      paneIds.codexRate,
      {
        pane_id: paneIds.codexRate,
        agent_type: 'codex',
        state: 'rate_limited',
        updated_at_ms: now - 2000,
        detail: 'Retry in 45s',
      },
    ],
  ]);

  const opencodeTimeline = reduceAgentTimeline([], opencodeTimelineEnvelopes(paneIds.opencode));

  return {
    variant,
    projectPath: 'C:\\Users\\demo\\loomria',
    agentCatalog: catalog,
    paneList,
    sessionStates,
    defaultAgentPaneId: paneIds.opencode,
    agentSessions: {
      [paneIds.opencode]: {
        capabilities: { ...opencodeCapabilities(), cancel: true },
        source: 'protocol',
        timeline: { ...opencodeTimeline, turnActive: true },
      },
    },
  };
}
