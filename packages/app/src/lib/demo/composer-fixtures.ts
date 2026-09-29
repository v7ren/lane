export const demoComposerAgents = [{ name: 'build' }, { name: 'plan' }];

export const demoComposerModels = [
  { providerID: 'opencode-go', modelID: 'deepseek-v3.1-flash', label: 'opencode-go/deepseek-v3.1-flash' },
  { providerID: 'opencode-go', modelID: 'mimo-v2.5', label: 'opencode-go/mimo-v2.5' },
];

export const demoComposerCommands = [
  { name: 'help', description: 'Show help' },
  { name: 'compact', description: 'Compact context' },
];

export const demoMentionFiles = [
  { path: 'packages/app/src/lib/bridge.ts' },
  { path: 'packages/app/src/lib/opencode/client.ts' },
  { path: 'packages/app/src/components/agent/AgentView.tsx' },
  { path: 'README.md' },
];
