import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TranscriptItem, TranscriptToolCall, TranscriptTurn } from '../../lib/transcript';
import { PartFallback } from './PartFallback';
import { TranscriptItemView } from './TranscriptItemView';
import { AssistantTurnBlock, UserTurnRow } from './TurnRows';

const projectRoot = '/workspace/repo';

const bashTool: TranscriptToolCall = {
  kind: 'tool_call',
  id: 'tool-bash',
  name: 'bash',
  status: 'completed',
  durationMs: 1500,
  input: { command: 'echo hello' },
  output: 'hello\n',
};

const readTool: TranscriptToolCall = {
  kind: 'tool_call',
  id: 'tool-read',
  name: 'read',
  status: 'completed',
  input: { path: 'hello.txt' },
  output: 'hello',
};

const writeTool: TranscriptToolCall = {
  kind: 'tool_call',
  id: 'tool-write',
  name: 'write',
  status: 'completed',
  input: { path: 'out.txt', contents: 'file body' },
  output: undefined,
};

const editTool: TranscriptToolCall = {
  kind: 'tool_call',
  id: 'tool-edit',
  name: 'edit',
  status: 'completed',
  input: { path: 'app.ts', oldString: 'foo', newString: 'bar' },
  output: undefined,
};

const grepTool: TranscriptToolCall = {
  kind: 'tool_call',
  id: 'tool-grep',
  name: 'grep',
  status: 'completed',
  input: { pattern: 'hello' },
  output: undefined,
};

const globTool: TranscriptToolCall = {
  kind: 'tool_call',
  id: 'tool-glob',
  name: 'glob',
  status: 'completed',
  input: { pattern: '*.ts' },
  output: { matches: ['a.ts', 'b.ts'], count: 2 },
};

const webfetchTool: TranscriptToolCall = {
  kind: 'tool_call',
  id: 'tool-webfetch',
  name: 'webfetch',
  status: 'completed',
  input: { url: 'https://example.com' },
  output: { status: 200 },
};

const todowriteTool: TranscriptToolCall = {
  kind: 'tool_call',
  id: 'tool-todowrite',
  name: 'todowrite',
  status: 'completed',
  input: {
    todos: [
      { content: 'Write tests', status: 'pending' },
      { content: 'Ship', status: 'completed' },
    ],
  },
  output: undefined,
};

const todoAliasTool: TranscriptToolCall = {
  kind: 'tool_call',
  id: 'tool-todo',
  name: 'todo',
  status: 'completed',
  input: { todos: [{ content: 'Task one', status: 'pending' }] },
  output: undefined,
};

const taskTool: TranscriptToolCall = {
  kind: 'tool_call',
  id: 'tool-task',
  name: 'task',
  status: 'completed',
  input: {
    description: 'Ping task',
    prompt: 'Reply with only the word ping and nothing else.',
    subagent_type: 'general',
  },
  output: `<task id="ses_child" state="completed">
<task_result>
ping
</task_result>
</task>`,
  metadata: { sessionId: 'ses_child', parentSessionId: 'ses_parent' },
};

const mysteryTool: TranscriptToolCall = {
  kind: 'tool_call',
  id: 'tool-mystery',
  name: 'mystery_tool',
  status: 'completed',
  input: { foo: 'bar' },
  output: undefined,
};

type RenderCase = {
  label: string;
  render: (root: Root) => void;
};

function itemCase(label: string, item: TranscriptItem, withProjectRoot = false): RenderCase {
  return {
    label,
    render: (root) => {
      root.render(
        <TranscriptItemView
          item={item}
          projectRoot={withProjectRoot ? projectRoot : undefined}
        />,
      );
    },
  };
}

const renderCases: RenderCase[] = [
  itemCase('assistant_text', {
    kind: 'assistant_text',
    id: 'at-1',
    markdown: 'Hello **world**',
  }),
  itemCase('reasoning', {
    kind: 'reasoning',
    id: 'rs-1',
    text: 'Considering options…',
    durationMs: 1200,
  }),
  itemCase('tool bash', bashTool),
  itemCase('tool read', readTool, true),
  itemCase('tool write', writeTool),
  itemCase('tool edit', editTool),
  itemCase('tool grep', grepTool),
  itemCase('tool glob', globTool),
  itemCase('tool webfetch', webfetchTool),
  itemCase('tool todowrite', todowriteTool),
  itemCase('tool todo', todoAliasTool),
  itemCase('tool task', taskTool),
  itemCase('tool generic unknown', mysteryTool),
  itemCase('patch', {
    kind: 'patch',
    id: 'patch-1',
    paths: ['src/a.ts', 'src/b.ts'],
  }),
  itemCase('todo_update', {
    kind: 'todo_update',
    id: 'tu-1',
    items: [
      { id: 't1', content: 'First item', status: 'pending' },
      { id: 't2', content: 'Second item', status: 'completed' },
    ],
  }),
  itemCase('subtask', {
    kind: 'subtask',
    id: 'st-1',
    title: 'Research',
    prompt: 'Look up API docs',
  }),
  itemCase('retry', {
    kind: 'retry',
    id: 'rt-1',
    attempt: 2,
    message: 'upstream timeout',
  }),
  itemCase('error', {
    kind: 'error',
    id: 'err-1',
    message: 'Something failed',
  }),
  itemCase('file', {
    kind: 'file',
    id: 'file-1',
    filename: 'notes.md',
    mime: 'text/markdown',
    url: 'https://example.test/notes.md',
  }),
  itemCase('compaction', {
    kind: 'compaction',
    id: 'cmp-1',
    auto: true,
  }),
  {
    label: 'user_prompt via UserTurnRow',
    render: (root) => {
      const turn: TranscriptTurn = {
        id: 'turn-user',
        role: 'user',
        items: [
          {
            kind: 'user_prompt',
            id: 'up-1',
            text: 'Run the test suite',
            files: [{ id: 'f-chip', filename: 'spec.ts' }],
          },
        ],
      };
      root.render(<UserTurnRow turn={turn} />);
    },
  },
  {
    label: 'step_usage on AssistantTurnBlock footer',
    render: (root) => {
      const turn: TranscriptTurn = {
        id: 'turn-asst',
        role: 'assistant',
        items: [
          {
            kind: 'assistant_text',
            id: 'at-footer',
            markdown: 'done',
          },
          {
            kind: 'step_usage',
            id: 'su-1',
            inputTokens: 100,
            outputTokens: 50,
            costUsd: 0.0123,
          },
        ],
        meta: {
          inputTokens: 100,
          outputTokens: 50,
          costUsd: 0.0123,
        },
      };
      root.render(<AssistantTurnBlock turn={turn} projectRoot={projectRoot} />);
    },
  },
  {
    label: 'PartFallback collapsed',
    render: (root) => {
      root.render(
        <PartFallback title="Unknown part: snapshot" value={{ type: 'snapshot' }} />,
      );
    },
  },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('transcript default view has no raw JSON dump', () => {
  it.each(renderCases)('$label', ({ render }) => {
    act(() => {
      render(root);
    });
    expect(container.textContent).not.toContain('{"');
  });
});
