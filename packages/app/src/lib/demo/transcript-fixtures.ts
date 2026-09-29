import type { DemoVariant } from '../demo-mode';
import type { TranscriptViewModel } from '../transcript';
import { flattenTranscriptTurns } from '../transcript/types';

const opencodeDemo: TranscriptViewModel = {
  turns: [
    {
      id: 'u-demo',
      role: 'user',
      items: [
        {
          kind: 'user_prompt',
          id: 'u-demo',
          text: 'hi',
          files: [],
          collapsedDefault: false,
        },
      ],
    },
    {
      id: 'a-demo',
      role: 'assistant',
      items: [
        {
          kind: 'reasoning',
          id: 'r1',
          text: 'User greeted; respond briefly and continue with the bridge task.',
          durationMs: 2200,
        },
        {
          kind: 'assistant_text',
          id: 't1',
          markdown: 'Hi! I will read the project file and summarize the first word for you.',
        },
        {
          kind: 'tool_call',
          id: 'tool-bash',
          name: 'bash',
          title: 'bash',
          status: 'completed',
          durationMs: 1400,
          input: 'npm run test --workspace=@loomria/app',
          output: 'Tests: 42 passed\n',
        },
        {
          kind: 'tool_call',
          id: 'tool-read',
          name: 'read',
          title: 'read',
          status: 'completed',
          durationMs: 400,
          input: { path: 'packages/app/src/lib/bridge.ts', start: 1, end: 40 },
          output: 'export function connect() {',
        },
        {
          kind: 'tool_call',
          id: 'tool-edit',
          name: 'edit',
          title: 'edit',
          status: 'completed',
          durationMs: 800,
          input: { path: 'packages/app/src/lib/bridge.ts' },
          output: 'Patched reconnect loop',
          diff: '@@ -10,3 +10,6 @@\n-  retryMs = 1000;\n+  retryMs = Math.min(max, retryMs * 2 + jitter);',
        },
        {
          kind: 'step_usage',
          id: 'usage',
          inputTokens: 7200,
          outputTokens: 910,
          costUsd: 0.001,
        },
      ],
      meta: {
        agent: 'build',
        model: 'deepseek-v3.1-flash',
        provider: 'opencode-go',
        durationMs: 6100,
        inputTokens: 7200,
        outputTokens: 910,
        costUsd: 0.001,
      },
    },
  ],
  flatItems: [],
  sessionBusy: false,
  turnActive: false,
  globalFilePaths: ['packages/app/src/lib/bridge.ts'],
};

opencodeDemo.flatItems = flattenTranscriptTurns(opencodeDemo.turns);

const codexDemo: TranscriptViewModel = {
  turns: [
    {
      id: 'u-codex',
      role: 'user',
      items: [
        {
          kind: 'user_prompt',
          id: 'u-codex',
          text: 'Refactor auth middleware.',
          files: [],
        },
      ],
    },
    {
      id: 'a-codex',
      role: 'assistant',
      items: [
        {
          kind: 'assistant_text',
          id: 'a-text',
          markdown: 'Starting auth refactor…',
        },
      ],
      meta: { agent: 'Codex', model: 'gpt-5.4', durationMs: 4200 },
    },
  ],
  flatItems: [],
  sessionBusy: false,
  turnActive: false,
  globalFilePaths: [],
};

codexDemo.flatItems = flattenTranscriptTurns(codexDemo.turns);

export function demoTranscriptForPane(variant: DemoVariant, paneId: string): TranscriptViewModel | null {
  if (variant === 'empty') return null;
  if (paneId.includes('codex') && !paneId.includes('Rate')) return codexDemo;
  if (paneId.includes('opencode')) return opencodeDemo;
  return null;
}

export function demoTranscriptDefault(): TranscriptViewModel {
  return opencodeDemo;
}
