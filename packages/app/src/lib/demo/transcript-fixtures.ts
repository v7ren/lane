import type { DemoVariant } from '../demo-mode';
import type { TranscriptViewModel } from '../transcript';

const opencodeDemo: TranscriptViewModel = {
  turns: [
    {
      id: 'u-demo',
      role: 'user',
      items: [
        {
          kind: 'user_prompt',
          id: 'u-demo',
          text: 'Add retry logic to the bridge SSE reconnect loop.',
          files: [],
          collapsedDefault: true,
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
          text: 'Need to inspect bridge.ts and add exponential backoff with jitter.',
          durationMs: 2200,
        },
        {
          kind: 'assistant_text',
          id: 't1',
          markdown:
            "I'll update the bridge client to backoff with jitter and register session_state on localhost EventSource.",
        },
        {
          kind: 'tool_call',
          id: 'tool-bash',
          name: 'bash',
          title: 'bash',
          status: 'completed',
          durationMs: 1400,
          input: 'npm run test --workspace=@loomria/app',
          output: 'Tests: 42 passed',
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
        model: 'MiMo V2.5',
        provider: 'opencode-go',
        durationMs: 6100,
        inputTokens: 7200,
        outputTokens: 910,
        costUsd: 0.001,
      },
    },
  ],
  flatItems: [],
  sessionBusy: true,
  turnActive: true,
  globalFilePaths: ['packages/app/src/lib/bridge.ts'],
};

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

export function demoTranscriptForPane(variant: DemoVariant, paneId: string): TranscriptViewModel | null {
  if (variant === 'empty') return null;
  if (paneId.includes('codex')) return codexDemo;
  if (paneId.includes('opencode')) return opencodeDemo;
  return null;
}

export function demoTranscriptDefault(): TranscriptViewModel {
  return opencodeDemo;
}
