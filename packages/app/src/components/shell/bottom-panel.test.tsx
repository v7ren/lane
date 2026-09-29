import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BottomPanel } from './BottomPanel';

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

describe('BottomPanel', () => {
  it('keeps AGENT | TERMINAL tab bar visible on both tabs', () => {
    act(() => {
      root.render(
        <BottomPanel
          tab="agent"
          onTabChange={() => {}}
          agentContent={<div data-testid="agent-view">agent</div>}
          terminalContent={<div data-testid="terminal-view">terminal</div>}
        />,
      );
    });
    expect(container.querySelector('[data-testid="bottom-panel-tabs"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="bottom-tab-agent"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="bottom-tab-terminal"]')).not.toBeNull();

    act(() => {
      root.render(
        <BottomPanel
          tab="terminal"
          onTabChange={() => {}}
          agentContent={<div>agent</div>}
          terminalContent={<div>terminal</div>}
        />,
      );
    });
    expect(container.querySelector('[data-testid="bottom-panel-tabs"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="bottom-tab-terminal"]')).not.toBeNull();
  });
});
