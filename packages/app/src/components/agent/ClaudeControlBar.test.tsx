import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaudeInfo } from '../../lib/claude-info';
import { ClaudeControlBar } from './ClaudeControlBar';

const INFO: ClaudeInfo = {
  models: [
    { value: 'default', displayName: 'Default (recommended)', description: 'Sonnet 5.5' },
    { value: 'opus', displayName: 'Opus 5.5' },
  ],
  commands: [
    { name: 'design', description: 'Make a design', argumentHint: '[brief]' },
    { name: 'ecc:aside', description: 'Side question' },
  ],
  permissionMode: 'default',
  model: null,
  account: 'Claude Pro',
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function click(testId: string): void {
  const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`missing ${testId}`);
  act(() => el.click());
}

describe('ClaudeControlBar', () => {
  it('renders without looping and shows the current mode, model and account', () => {
    act(() =>
      root.render(<ClaudeControlBar info={INFO} onSetMode={vi.fn()} onSetModel={vi.fn()} onPickCommand={vi.fn()} />),
    );
    const text = host.textContent ?? '';
    expect(text).toContain('Ask');
    expect(text).toContain('Default (recommended)');
    expect(text).toContain('Claude Pro');
  });

  it('picks a model, a mode and a slash command', () => {
    const onSetMode = vi.fn();
    const onSetModel = vi.fn();
    const onPickCommand = vi.fn();
    act(() =>
      root.render(
        <ClaudeControlBar info={INFO} onSetMode={onSetMode} onSetModel={onSetModel} onPickCommand={onPickCommand} />,
      ),
    );

    click('claude-model');
    const opus = [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Opus 5.5'));
    act(() => opus?.click());
    expect(onSetModel).toHaveBeenCalledWith('opus');

    click('claude-mode');
    const plan = [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Plan'));
    act(() => plan?.click());
    expect(onSetMode).toHaveBeenCalledWith('plan');

    click('claude-commands');
    const design = [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith('/design'));
    act(() => design?.click());
    expect(onPickCommand).toHaveBeenCalledWith('design');
  });

  it('shows a loading hint while Claude has not reported its info', () => {
    act(() =>
      root.render(<ClaudeControlBar info={null} onSetMode={vi.fn()} onSetModel={vi.fn()} onPickCommand={vi.fn()} />),
    );
    click('claude-commands');
    expect(document.body.textContent).toContain('Commands load when Claude has started');
  });
});
