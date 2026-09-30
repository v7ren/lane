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
