import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClaudeInfo } from '../../lib/claude-info';
import { ClaudeControlBar } from './ClaudeControlBar';

const INFO: ClaudeInfo = {
  models: [],
  commands: [],
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

describe('ClaudeControlBar', () => {
  it('shows only the account; model, mode and commands moved out', () => {
    act(() => root.render(<ClaudeControlBar info={INFO} />));
    expect(host.textContent).toContain('Claude Pro');
    expect(host.querySelector('[data-testid="claude-mode"]')).toBeNull();
    expect(host.querySelector('[data-testid="claude-model"]')).toBeNull();
    expect(host.querySelector('[data-testid="claude-commands"]')).toBeNull();
  });

  it('renders nothing without an account', () => {
    act(() => root.render(<ClaudeControlBar info={null} />));
    expect(host.querySelector('[data-testid="claude-control-bar"]')).toBeNull();
  });
});
