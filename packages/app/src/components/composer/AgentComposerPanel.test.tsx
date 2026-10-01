import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLAUDE_CAPABILITIES,
  CODEX_CAPABILITIES,
  OPENCODE_CAPABILITIES,
  type AgentCapabilities,
} from '../../lib/agent-capabilities';
import type { Capabilities } from '../../lib/agent-events';
import { AgentComposerPanel } from './AgentComposerPanel';
import { EMPTY_AGENT_CONTROLS, type AgentControls } from '../../hooks/useAgentControls';
import { clearDraft, getDraft } from '../../lib/composer-drafts';

vi.mock('../../lib/shell-selection-context', () => ({
  useShellSelection: () => ({ setBottomTab: vi.fn() }),
}));

const protocolCaps: Capabilities = {
  chat: true,
  send_prompt: true,
  approvals: true,
  cancel: true,
  file_changes: false,
  attach_tui: true,
};

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
});

function renderComposer(opts: { openCode: boolean; agentCapabilities: AgentCapabilities }) {
  root = createRoot(container);
  act(() => {
    root!.render(
      <AgentComposerPanel
        paneId="pane-1"
        sessionId={opts.openCode ? 'ses-1' : null}
        openCode={opts.openCode}
        capabilities={protocolCaps}
        agentCapabilities={opts.agentCapabilities}
        disabled={false}
        busy={false}
        showStop={false}
        onSendProtocol={async () => {}}
        onCancelProtocol={async () => {}}
        onError={() => {}}
      />,
    );
  });
}

function textarea(): HTMLTextAreaElement {
  const el = container.querySelector('textarea');
  if (!el) throw new Error('no textarea');
  return el;
}

function pressKey(key: string) {
  act(() => {
    textarea().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

function hasOpenPopover(testId: string): boolean {
  return document.querySelector(`[data-testid="${testId}"]`) !== null;
}

describe('AgentComposerPanel capability gating', () => {
  it('OpenCode keeps all controls and pickers', () => {
    renderComposer({ openCode: true, agentCapabilities: OPENCODE_CAPABILITIES });
    expect(container.querySelector('[data-testid="picker-agent"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="picker-permission"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="picker-model"]')).not.toBeNull();
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
    pressKey('@');
    expect(hasOpenPopover('mention-popover')).toBe(true);
    act(() => textarea().focus());
    act(() => {
      textarea().dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    expect(container.textContent).toContain('! for shell · / for commands · @ for files');
    expect(container.textContent).toContain('Shell mode off');
  });

  it.each([
    ['Codex', CODEX_CAPABILITIES],
    ['Claude', CLAUDE_CAPABILITIES],
  ])('%s hides OpenCode-only controls', (_name, caps) => {
    renderComposer({ openCode: false, agentCapabilities: caps });
    expect(container.querySelector('[data-testid="picker-permission"]')).toBeNull();
    expect(container.querySelector('[data-testid="picker-model"]')).toBeNull();
    expect(container.querySelector('[data-testid="picker-agent"]')).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    pressKey('@');
    expect(hasOpenPopover('mention-popover')).toBe(false);
    pressKey('/');
    expect(container.querySelector('[aria-label="Send"]')).not.toBeNull();
  });

  it('does not open the mention picker when typing @ for a capability-less agent', () => {
    renderComposer({ openCode: false, agentCapabilities: CODEX_CAPABILITIES });
    const el = textarea();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(el, 'see @src');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(hasOpenPopover('mention-popover')).toBe(false);
  });
});

describe('AgentComposerPanel draft persistence', () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearDraft('pane-a');
    clearDraft('pane-b');
  });

  afterEach(() => {
    sessionStorage.clear();
    clearDraft('pane-a');
    clearDraft('pane-b');
  });

  it('composer remount keeps the text via getDraft', () => {
    // First render: type text
    root = createRoot(container);
    act(() => {
      root!.render(
        <AgentComposerPanel
          paneId="pane-a"
          sessionId="ses-1"
          openCode
          capabilities={protocolCaps}
          agentCapabilities={OPENCODE_CAPABILITIES}
          disabled={false}
          busy={false}
          showStop={false}
          onSendProtocol={async () => {}}
          onCancelProtocol={async () => {}}
          onError={() => {}}
        />,
      );
    });

    const ta = textarea();
    act(() => {
      // Simulate React onChange by setting value and firing input event
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(ta, 'hello world');
      ta.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(getDraft('pane-a')).toBe('hello world');

    // Unmount
    act(() => root?.unmount());

    // Remount with same paneId
    root = createRoot(container);
    act(() => {
      root!.render(
        <AgentComposerPanel
          paneId="pane-a"
          sessionId="ses-1"
          openCode
          capabilities={protocolCaps}
          agentCapabilities={OPENCODE_CAPABILITIES}
          disabled={false}
          busy={false}
          showStop={false}
          onSendProtocol={async () => {}}
          onCancelProtocol={async () => {}}
          onError={() => {}}
        />,
      );
    });

    // Verify draft is restored
    expect(textarea().value).toBe('hello world');
  });

  it('switching panes and back preserves text', () => {
    // Render pane-a with text
    root = createRoot(container);
    act(() => {
      root!.render(
        <AgentComposerPanel
          paneId="pane-a"
          sessionId="ses-1"
          openCode
          capabilities={protocolCaps}
          agentCapabilities={OPENCODE_CAPABILITIES}
          disabled={false}
          busy={false}
          showStop={false}
          onSendProtocol={async () => {}}
          onCancelProtocol={async () => {}}
          onError={() => {}}
        />,
      );
    });

    const ta = textarea();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(ta, 'text from pane A');
      ta.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(getDraft('pane-a')).toBe('text from pane A');

    // Switch to pane-b by changing paneId prop
    act(() => {
      root!.render(
        <AgentComposerPanel
          paneId="pane-b"
          sessionId="ses-2"
          openCode
          capabilities={protocolCaps}
          agentCapabilities={OPENCODE_CAPABILITIES}
          disabled={false}
          busy={false}
          showStop={false}
          onSendProtocol={async () => {}}
          onCancelProtocol={async () => {}}
          onError={() => {}}
        />,
      );
    });

    expect(textarea().value).toBe(''); // pane-b has no draft yet
    expect(getDraft('pane-a')).toBe('text from pane A'); // pane-a's draft is still there

    // Type in pane-b
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea(), 'text from pane B');
      textarea().dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Switch back to pane-a
    act(() => {
      root!.render(
        <AgentComposerPanel
          paneId="pane-a"
          sessionId="ses-1"
          openCode
          capabilities={protocolCaps}
          agentCapabilities={OPENCODE_CAPABILITIES}
          disabled={false}
          busy={false}
          showStop={false}
          onSendProtocol={async () => {}}
          onCancelProtocol={async () => {}}
          onError={() => {}}
        />,
      );
    });

    // Verify pane-a's text is restored
    expect(textarea().value).toBe('text from pane A');
    expect(getDraft('pane-b')).toBe('text from pane B'); // pane-b's draft is still there
  });
});

const CLAUDE_CONTROLS: AgentControls = {
  ...EMPTY_AGENT_CONTROLS,
  models: [
    { id: 'default', label: 'Default (recommended)' },
    { id: 'opus', label: 'Opus 5.5' },
  ],
  currentModel: 'opus',
  modes: [
    { id: 'default', label: 'Ask' },
    { id: 'plan', label: 'Plan' },
  ],
  currentMode: 'plan',
};

function renderWith(props: {
  agentType: string;
  agentCapabilities: AgentCapabilities;
  controls?: AgentControls;
  usage?: { cost_usd?: number; context_tokens?: number; context_window?: number };
  showStop?: boolean;
  busy?: boolean;
}) {
  root = createRoot(container);
  act(() => {
    root!.render(
      <AgentComposerPanel
        paneId="pane-t"
        sessionId={null}
        openCode={false}
        capabilities={protocolCaps}
        agentCapabilities={props.agentCapabilities}
        agentType={props.agentType}
        controls={props.controls}
        usage={props.usage}
        disabled={false}
        busy={props.busy ?? false}
        showStop={props.showStop ?? false}
        onSendProtocol={async () => {}}
        onCancelProtocol={async () => {}}
        onError={() => {}}
      />,
    );
  });
}

describe('AgentComposerPanel toolbar controls', () => {
  it('Claude shows model and mode pills from the controls', () => {
    renderWith({ agentType: 'claude', agentCapabilities: CLAUDE_CAPABILITIES, controls: CLAUDE_CONTROLS });
    expect(container.querySelector('[data-testid="pill-model"]')?.textContent).toBe('Opus 5.5');
    expect(container.querySelector('[data-testid="pill-mode"]')?.textContent).toBe('Plan');
  });

  it('Codex (empty controls) shows no generic pills', () => {
    renderWith({ agentType: 'codex', agentCapabilities: CODEX_CAPABILITIES, controls: EMPTY_AGENT_CONTROLS });
    expect(container.querySelector('[data-testid="pill-model"]')).toBeNull();
    expect(container.querySelector('[data-testid="pill-mode"]')).toBeNull();
  });

  it('OpenCode keeps its own pickers and no generic pills', () => {
    root = createRoot(container);
    act(() => {
      root!.render(
        <AgentComposerPanel
          paneId="pane-t"
          sessionId="ses-1"
          openCode
          capabilities={protocolCaps}
          agentCapabilities={OPENCODE_CAPABILITIES}
          agentType="opencode_native"
          controls={EMPTY_AGENT_CONTROLS}
          disabled={false}
          busy={false}
          showStop={false}
          onSendProtocol={async () => {}}
          onCancelProtocol={async () => {}}
          onError={() => {}}
        />,
      );
    });
    expect(container.querySelector('[data-testid="pill-model"]')).toBeNull();
    expect(container.querySelector('[data-testid="picker-model"]')).not.toBeNull();
  });

  it('picking a model calls setModel', () => {
    const setModel = vi.fn(async () => {});
    renderWith({
      agentType: 'claude',
      agentCapabilities: CLAUDE_CAPABILITIES,
      controls: { ...CLAUDE_CONTROLS, setModel },
    });
    act(() => container.querySelector<HTMLElement>('[data-testid="pill-model"]')!.click());
    const item = [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Default'));
    act(() => item?.click());
    expect(setModel).toHaveBeenCalledWith('default');
  });

  it('shows the context bar only when the capability is on, plus the session cost', () => {
    const usage = { cost_usd: 0.118, context_tokens: 100_000 };
    renderWith({ agentType: 'claude', agentCapabilities: CLAUDE_CAPABILITIES, controls: CLAUDE_CONTROLS, usage });
    expect(container.querySelector('[data-testid="context-bar"]')).toBeNull();
    expect(container.querySelector('[data-testid="session-cost"]')?.textContent).toBe('$0.12');
    act(() => root?.unmount());
    renderWith({
      agentType: 'claude',
      agentCapabilities: { ...CLAUDE_CAPABILITIES, contextBar: true },
      controls: CLAUDE_CONTROLS,
      usage,
    });
    expect(container.querySelector('[data-testid="context-bar"]')?.textContent).toBe('50%');
  });

  it('keeps the textarea enabled while a turn runs (showStop), disabled only while busy', () => {
    renderWith({ agentType: 'claude', agentCapabilities: CLAUDE_CAPABILITIES, showStop: true });
    expect(textarea().disabled).toBe(false);
    expect(container.querySelector('[aria-label="Stop"]')).not.toBeNull();
    act(() => root?.unmount());
    renderWith({ agentType: 'claude', agentCapabilities: CLAUDE_CAPABILITIES, busy: true });
    expect(textarea().disabled).toBe(true);
  });
});
