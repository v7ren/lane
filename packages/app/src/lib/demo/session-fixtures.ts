import type { ShellSession } from '../shell-data';

/** Demo OpenCode sessions for ?demo sidebar screenshots. */
export function buildDemoOpenCodeSessions(paneId: string): ShellSession[] {
  const now = Date.now();
  const parentId = 'demo-sess-parent';
  return [
    {
      id: parentId,
      paneId,
      sessionId: parentId,
      title: 'Bridge reconnect review',
      agentLabel: 'Build',
      status: 'working',
      updatedAt: now - 120_000,
      unread: false,
      reverted: true,
      lastMessagePreview: 'Checking opencode_request allowlist coverage…',
      workspaceDirectory: 'C:\\Users\\demo\\loomria',
      workspaceLabel: 'loomria',
      depth: 0,
    },
    {
      id: 'demo-sess-child',
      paneId,
      sessionId: 'demo-sess-child',
      parentSessionId: parentId,
      title: 'Child: MCP status pass',
      agentLabel: 'Build',
      status: 'idle',
      updatedAt: now - 360_000,
      unread: true,
      lastMessagePreview: 'Summarized tool output for /mcp',
      workspaceDirectory: 'C:\\Users\\demo\\loomria',
      workspaceLabel: 'loomria',
      depth: 1,
    },
    {
      id: 'demo-sess-approval',
      paneId,
      sessionId: 'demo-sess-approval',
      title: 'npm test workspace',
      agentLabel: 'Build',
      status: 'needs_approval',
      updatedAt: now - 30_000,
      unread: true,
      reverted: true,
      lastMessagePreview: 'Run npm run test --workspace=@loomria/app?',
      workspaceDirectory: 'C:\\Users\\demo\\loomria',
      workspaceLabel: 'loomria',
    },
    {
      id: 'demo-sess-share',
      paneId,
      sessionId: 'demo-sess-share',
      title: 'Shared design notes',
      agentLabel: 'Plan',
      status: 'idle',
      updatedAt: now - 86_400_000,
      unread: false,
      shareUrl: 'https://share.opencode.ai/demo-link',
      workspaceDirectory: 'C:\\Users\\demo\\loomria',
      workspaceLabel: 'loomria',
    },
  ];
}

export function demoEnvironment() {
  return {
    directory: 'C:\\Users\\demo\\loomria',
    branch: 'rebuild/p4-sessions',
    serverUrl: 'http://127.0.0.1:4096',
    serverStatus: 'connected' as const,
    mcpSummary: '2 servers · 14 tools',
    lspSummary: 'typescript · rust-analyzer',
  };
}

export function demoSessionSummary(session: ShellSession | null) {
  if (!session) return {};
  return {
    agent: session.agentLabel,
    model: 'deepseek-v3.1-flash',
    provider: 'opencode-go',
    tokens: { input: 18240, output: 4200 },
    costUsd: 0.0421,
    todos: [
      { content: 'Wire session list to OpenCode store', status: 'in_progress' },
      { content: 'Capture demo screenshots', status: 'pending' },
    ],
  };
}
