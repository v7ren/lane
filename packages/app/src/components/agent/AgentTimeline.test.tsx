import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentTimelineViewModel } from '../../lib/agent-timeline-reducer';
import { AgentTimeline } from './AgentTimeline';

const payload = "I'll & <b>x</b>";

const vm: AgentTimelineViewModel = {
  messages: [
    {
      id: 'm1',
      role: 'assistant',
      text: payload,
      streaming: false,
    },
  ],
  tools: [],
  approvals: [],
  pendingApprovals: [],
  filePaths: [],
  turnActive: false,
  maxSeq: 1,
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

describe('AgentTimeline', () => {
  it('renders agent message text literally without HTML entities or elements', () => {
    act(() => {
      root.render(
        <AgentTimeline vm={vm} nativeTuiOnly={false} busy={false} onRespondApproval={() => {}} />,
      );
    });

    expect(container.textContent).toContain(payload);
    expect(container.textContent).not.toContain('&#39;');
    expect(container.querySelector('b')).toBeNull();
  });
});
