import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TranscriptToolCall } from '../../lib/transcript';
import { ToolCard } from './ToolCard';

const bashCompleted: TranscriptToolCall = {
  kind: 'tool_call',
  id: 'bash-1',
  name: 'bash',
  status: 'completed',
  durationMs: 1500,
  input: 'echo hello',
  output: 'hello\n',
};

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

function headerToggle(): HTMLButtonElement {
  const btn = container.querySelector('[data-testid="tool-bash-1"] > button[aria-expanded]');
  if (!btn) throw new Error('tool header toggle not found');
  return btn as HTMLButtonElement;
}

describe('ToolCard', () => {
  it('renders title, status chip, and duration for completed bash tool', () => {
    act(() => {
      root.render(<ToolCard tool={bashCompleted} />);
    });
    expect(container.textContent).toContain('Bash');
    expect(container.querySelector('[data-testid="tool-status-chip"]')?.textContent).toContain(
      'Completed',
    );
    expect(container.textContent).toContain('1.5s');
  });

  it('collapses and expands the tool body', () => {
    act(() => {
      root.render(<ToolCard tool={bashCompleted} />);
    });
    expect(container.querySelector('[data-testid="tool-card-body"]')).not.toBeNull();
    expect(container.textContent).toContain('echo hello');

    act(() => headerToggle().click());
    expect(container.querySelector('[data-testid="tool-card-body"]')).toBeNull();
    expect(container.textContent).not.toContain('echo hello');

    act(() => headerToggle().click());
    expect(container.querySelector('[data-testid="tool-card-body"]')).not.toBeNull();
    expect(container.textContent).toContain('echo hello');
  });

  it('renders bash command and output from object input', () => {
    const tool: TranscriptToolCall = {
      ...bashCompleted,
      id: 'bash-object',
      input: { command: 'echo hi' },
      output: 'hi\n',
    };
    act(() => {
      root.render(<ToolCard tool={tool} />);
    });
    const command = container.querySelector('[data-testid="tool-bash-command"]');
    const output = container.querySelector('[data-testid="tool-bash-output"]');
    expect(command?.textContent).toBe('echo hi');
    expect(output?.textContent).toContain('hi');
    expect(container.textContent).not.toContain('[object Object]');
  });

  it('collapses long bash output to ~40 lines with Show more', () => {
    const longOutput = `${Array.from({ length: 50 }, (_, i) => `line-${i + 1}`).join('\n')}\n`;
    const tool: TranscriptToolCall = {
      ...bashCompleted,
      id: 'bash-long',
      input: { command: 'seq 50' },
      output: longOutput,
    };
    act(() => {
      root.render(<ToolCard tool={tool} />);
    });
    const outputEl = container.querySelector('[data-testid="tool-bash-output"]');
    expect(outputEl?.textContent).toContain('line-1');
    expect(outputEl?.textContent).toContain('line-40');
    expect(outputEl?.textContent).not.toContain('line-50');
    const showMore = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Show more',
    );
    expect(showMore).not.toBeUndefined();
    act(() => showMore!.click());
    expect(outputEl?.textContent).toContain('line-50');
  });

  it('read tool shows path in header and collapsible file content from output', () => {
    const tool: TranscriptToolCall = {
      kind: 'tool_call',
      id: 'read-1',
      name: 'read',
      status: 'completed',
      input: { path: 'hello.txt' },
      output: 'hello',
    };
    act(() => {
      root.render(<ToolCard tool={tool} />);
    });
    expect(container.querySelector('[data-testid="tool-read-path"]')?.textContent).toBe('hello.txt');
    expect(container.textContent).toContain('Read');
    expect(container.querySelector('[data-testid="tool-read-content"]')).toBeNull();
    const showMore = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Show more',
    );
    expect(showMore).not.toBeUndefined();
    act(() => showMore!.click());
    expect(container.querySelector('[data-testid="tool-read-content"]')?.textContent).toBe('hello');
  });

  it('write tool shows path in header and collapsible contents from input', () => {
    const tool: TranscriptToolCall = {
      kind: 'tool_call',
      id: 'write-1',
      name: 'write',
      status: 'completed',
      input: { path: 'out.txt', contents: 'file body' },
      output: undefined,
    };
    act(() => {
      root.render(<ToolCard tool={tool} />);
    });
    expect(container.querySelector('[data-testid="tool-write-path"]')?.textContent).toBe('out.txt');
    expect(container.textContent).toContain('Write');
    expect(container.querySelector('[data-testid="tool-write-content"]')).toBeNull();
    const showMore = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Show more',
    );
    act(() => showMore!.click());
    expect(container.querySelector('[data-testid="tool-write-content"]')?.textContent).toBe(
      'file body',
    );
  });

  it('write tool with object input does not render [object Object]', () => {
    const tool: TranscriptToolCall = {
      kind: 'tool_call',
      id: 'write-obj',
      name: 'write',
      status: 'completed',
      input: { path: 'a.txt', content: 'ok' },
      output: undefined,
    };
    act(() => {
      root.render(<ToolCard tool={tool} />);
    });
    expect(container.textContent).not.toContain('[object Object]');
    const showMore = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Show more',
    );
    act(() => showMore!.click());
    expect(container.querySelector('[data-testid="tool-write-content"]')?.textContent).toBe('ok');
  });

  it('edit tool shows path in header and inline diff from old/new strings', () => {
    const tool: TranscriptToolCall = {
      kind: 'tool_call',
      id: 'edit-1',
      name: 'edit',
      status: 'completed',
      input: { path: 'app.ts', oldString: 'foo', newString: 'bar' },
      output: undefined,
    };
    act(() => {
      root.render(<ToolCard tool={tool} />);
    });
    expect(container.querySelector('[data-testid="tool-edit-path"]')?.textContent).toBe('app.ts');
    expect(container.textContent).toContain('Edit');
    const diffEl = container.querySelector('[data-testid="tool-edit-diff"]');
    expect(diffEl?.textContent).toContain('foo');
    expect(diffEl?.textContent).toContain('bar');
    expect(container.textContent).not.toContain('[object Object]');
  });

  it('edit tool accepts old_string and new_string spellings', () => {
    const tool: TranscriptToolCall = {
      kind: 'tool_call',
      id: 'edit-snake',
      name: 'edit',
      status: 'completed',
      input: { path: 'app.ts', old_string: 'alpha', new_string: 'beta' },
      output: undefined,
    };
    act(() => {
      root.render(<ToolCard tool={tool} />);
    });
    const diffEl = container.querySelector('[data-testid="tool-edit-diff"]');
    expect(diffEl?.textContent).toContain('alpha');
    expect(diffEl?.textContent).toContain('beta');
  });

  it('apply_patch tool shows path in header', () => {
    const tool: TranscriptToolCall = {
      kind: 'tool_call',
      id: 'patch-1',
      name: 'apply_patch',
      status: 'completed',
      input: { path: 'patch.ts', oldString: 'x', newString: 'y' },
      output: undefined,
    };
    act(() => {
      root.render(<ToolCard tool={tool} />);
    });
    expect(container.querySelector('[data-testid="tool-edit-path"]')?.textContent).toBe('patch.ts');
    expect(container.textContent).toContain('Edit');
  });

  it('glob tool shows pattern, count, and hit paths without [object Object]', () => {
    const tool: TranscriptToolCall = {
      kind: 'tool_call',
      id: 'glob-1',
      name: 'glob',
      status: 'completed',
      input: { pattern: '*.ts' },
      output: { matches: ['a.ts', 'b.ts'], count: 2 },
    };
    act(() => {
      root.render(<ToolCard tool={tool} />);
    });
    expect(container.textContent).not.toContain('[object Object]');
    expect(container.querySelector('[data-testid="tool-glob-pattern"]')?.textContent).toBe('*.ts');
    expect(container.querySelector('[data-testid="tool-glob-count"]')?.textContent).toBe('2 files');
    const hits = container.querySelector('[data-testid="tool-glob-hits"]');
    expect(hits?.textContent).toContain('a.ts');
    expect(hits?.textContent).toContain('b.ts');
  });

  it('grep tool with object input does not render [object Object]', () => {
    const tool: TranscriptToolCall = {
      kind: 'tool_call',
      id: 'grep-1',
      name: 'grep',
      status: 'completed',
      input: { pattern: 'hello' },
      output: undefined,
    };
    act(() => {
      root.render(<ToolCard tool={tool} />);
    });
    expect(container.textContent).not.toContain('[object Object]');
    expect(container.querySelector('[data-testid="tool-grep-pattern"]')?.textContent).toBe('hello');
    expect(container.querySelector('[data-testid="tool-grep-count"]')?.textContent).toBe(
      '0 matches',
    );
  });

  it('glob tool renders at most 10 hit paths', () => {
    const matches = Array.from({ length: 15 }, (_, i) => `file-${i + 1}.ts`);
    const tool: TranscriptToolCall = {
      kind: 'tool_call',
      id: 'glob-many',
      name: 'glob',
      status: 'completed',
      input: { pattern: '*.ts' },
      output: { matches, count: 15 },
    };
    act(() => {
      root.render(<ToolCard tool={tool} />);
    });
    const hitChips = container.querySelectorAll(
      '[data-testid="tool-glob-hits"] span.font-mono',
    );
    expect(hitChips.length).toBe(10);
    expect(container.querySelector('[data-testid="tool-glob-count"]')?.textContent).toBe(
      '15 files',
    );
  });

  it('webfetch tool shows url and HTTP status without [object Object]', () => {
    const tool: TranscriptToolCall = {
      kind: 'tool_call',
      id: 'webfetch-1',
      name: 'webfetch',
      status: 'completed',
      input: { url: 'https://example.com' },
      output: { status: 200 },
    };
    act(() => {
      root.render(<ToolCard tool={tool} />);
    });
    expect(container.textContent).not.toContain('[object Object]');
    expect(container.querySelector('[data-testid="tool-webfetch-url"]')?.textContent).toBe(
      'https://example.com',
    );
    expect(container.querySelector('[data-testid="tool-webfetch-status"]')?.textContent).toBe('200');
  });

  it('webfetch tool renders string input URL', () => {
    const tool: TranscriptToolCall = {
      kind: 'tool_call',
      id: 'webfetch-str',
      name: 'webfetch',
      status: 'completed',
      input: 'https://example.org/page',
      output: undefined,
    };
    act(() => {
      root.render(<ToolCard tool={tool} />);
    });
    expect(container.querySelector('[data-testid="tool-webfetch-url"]')?.textContent).toBe(
      'https://example.org/page',
    );
  });

  it('todowrite tool shows checklist from input.todos with visible statuses', () => {
    const tool: TranscriptToolCall = {
      kind: 'tool_call',
      id: 'todo-1',
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
    act(() => {
      root.render(<ToolCard tool={tool} />);
    });
    expect(container.querySelector('[data-testid="tool-todo-list"]')).not.toBeNull();
    expect(container.textContent).toContain('Write tests');
    expect(container.textContent).toContain('Ship');
    expect(container.textContent).toContain('pending');
    expect(container.textContent).toContain('completed');
    expect(container.textContent).not.toContain('[object Object]');
    expect(container.textContent).not.toMatch(/\{"todos"/);
    const items = container.querySelectorAll('[data-testid="tool-todo-item"]');
    expect(items.length).toBe(2);
  });

  it('todowrite tool accepts todo list from array output', () => {
    const tool: TranscriptToolCall = {
      kind: 'tool_call',
      id: 'todo-out',
      name: 'todowrite',
      status: 'completed',
      input: {},
      output: [{ content: 'From output', status: 'in_progress' }],
    };
    act(() => {
      root.render(<ToolCard tool={tool} />);
    });
    expect(container.querySelector('[data-testid="tool-todo-list"]')).not.toBeNull();
    expect(container.textContent).toContain('From output');
    expect(container.textContent).toContain('in_progress');
  });

  it('todo tool name is known and does not show unknown tool fallback', () => {
    const tool: TranscriptToolCall = {
      kind: 'tool_call',
      id: 'todo-alias',
      name: 'todo',
      status: 'completed',
      input: { todos: [{ content: 'Task one', status: 'pending' }] },
      output: undefined,
    };
    act(() => {
      root.render(<ToolCard tool={tool} />);
    });
    expect(container.textContent).not.toContain('Unknown tool');
    expect(container.textContent).not.toMatch(/\{"todos"/);
    expect(container.textContent).toContain('Task one');
    expect(container.textContent).toContain('Todo');
  });

  it('todowrite tool with empty list shows 0 items not JSON', () => {
    const tool: TranscriptToolCall = {
      kind: 'tool_call',
      id: 'todo-empty',
      name: 'todowrite',
      status: 'completed',
      input: { todos: [] },
      output: undefined,
    };
    act(() => {
      root.render(<ToolCard tool={tool} />);
    });
    expect(container.querySelector('[data-testid="tool-todo-list"]')).not.toBeNull();
    expect(container.textContent).toContain('0 items');
    expect(container.textContent).not.toMatch(/\{"todos"/);
  });

  it('task tool shows description and child session id', () => {
    const tool: TranscriptToolCall = {
      kind: 'tool_call',
      id: 'task-1',
      name: 'task',
      status: 'completed',
      input: { description: 'Research foo', sessionID: 'ses_abc' },
      output: undefined,
    };
    act(() => {
      root.render(<ToolCard tool={tool} />);
    });
    expect(container.querySelector('[data-testid="tool-task-description"]')?.textContent).toBe(
      'Research foo',
    );
    expect(container.querySelector('[data-testid="tool-task-session"]')?.textContent).toBe(
      'ses_abc',
    );
    expect(container.textContent).not.toContain('[object Object]');
    expect(container.textContent).not.toContain('Unknown tool');
    expect(container.textContent).toContain('Task');
  });

  it('task tool resolves child session from metadata and task output', () => {
    const tool: TranscriptToolCall = {
      kind: 'tool_call',
      id: 'task-live',
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
    act(() => {
      root.render(<ToolCard tool={tool} />);
    });
    expect(container.querySelector('[data-testid="tool-task-description"]')?.textContent).toBe(
      'Ping task',
    );
    expect(container.querySelector('[data-testid="tool-task-session"]')?.textContent).toBe(
      'ses_child',
    );
    expect(container.textContent).not.toContain('[object Object]');
    expect(container.textContent).not.toMatch(/\{"description"/);
  });

  it('task tool without session id omits session line', () => {
    const tool: TranscriptToolCall = {
      kind: 'tool_call',
      id: 'task-2',
      name: 'task',
      status: 'completed',
      input: { description: 'Research foo' },
      output: undefined,
    };
    act(() => {
      root.render(<ToolCard tool={tool} />);
    });
    expect(container.querySelector('[data-testid="tool-task-description"]')?.textContent).toBe(
      'Research foo',
    );
    expect(container.querySelector('[data-testid="tool-task-session"]')).toBeNull();
  });

  it('shows different status chip labels for pending vs error', () => {
    const pending: TranscriptToolCall = {
      ...bashCompleted,
      id: 'bash-pending',
      status: 'pending',
      durationMs: undefined,
    };
    const errored: TranscriptToolCall = {
      ...bashCompleted,
      id: 'bash-error',
      status: 'error',
    };

    act(() => {
      root.render(<ToolCard tool={pending} />);
    });
    expect(container.querySelector('[data-testid="tool-status-chip"]')?.textContent).toContain(
      'Pending',
    );

    act(() => {
      root.render(<ToolCard tool={errored} />);
    });
    expect(container.querySelector('[data-testid="tool-status-chip"]')?.textContent).toContain(
      'Error',
    );
    expect(container.querySelector('[data-testid="tool-status-chip"]')?.textContent).not.toContain(
      'Pending',
    );
  });
});
