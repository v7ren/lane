import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, AgentEventEnvelope } from '../agent-events';
import { emptyTimelineViewModel, reduceAgentTimeline } from '../agent-timeline-reducer';
import { mergeEnvelopeLog } from '../agent-session';
import type { SessionTimeline } from '../../hooks/useAgentSession';
import type { TranscriptViewModel } from './types';
import { useTranscriptViewModel } from './use-transcript-view-model';

vi.mock('../is-tauri', () => ({ isTauriRuntime: () => true }));

const fakeStore = {
  subscribe: () => () => {},
  getState: () => null,
  ensureSessionMessages: vi.fn(),
};
vi.mock('../opencode/store.js', () => ({ getOpenCodeStore: () => fakeStore }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function env(seq: number, event: AgentEvent): AgentEventEnvelope {
  return { pane_id: 'p1', seq, event };
}

const PROTOCOL_EVENTS: AgentEventEnvelope[] = [
  env(1, { type: 'turn_started', turn_id: 't1' }),
  env(2, {
    type: 'message_completed',
    turn_id: 't1',
    message_id: 'u1',
    role: 'user',
    text: 'list files',
  }),
  env(3, {
    type: 'tool_started',
    turn_id: 't1',
    tool_id: 'tool1',
    name: 'Bash',
    input_summary: 'ls',
  }),
  env(4, {
    type: 'message_completed',
    turn_id: 't1',
    message_id: 'a1',
    role: 'assistant',
    text: 'done',
  }),
];

function timelineWith(envelopes: AgentEventEnvelope[] | undefined): SessionTimeline {
  const base = envelopes ? reduceAgentTimeline(envelopes, []) : emptyTimelineViewModel();
  return envelopes ? { ...base, envelopes } : base;
}

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLElement | null = null;

function renderHook(args: {
  openCodePane: boolean;
  source: 'protocol' | 'native_tui' | 'opencode_fallback';
  timeline: SessionTimeline;
}): TranscriptViewModel {
  let result: TranscriptViewModel | null = null;
  function Host() {
    result = useTranscriptViewModel('p1', true, args.openCodePane, args.source, args.timeline, null);
    return null;
  }
  host = document.createElement('div');
  root = createRoot(host);
  act(() => {
    root?.render(<Host />);
  });
  if (!result) throw new Error('hook did not render');
  return result;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host = null;
});

describe('useTranscriptViewModel protocol path', () => {
  it('renders user, assistant and tool turns through the envelope adapter', () => {
    const vm = renderHook({
      openCodePane: false,
      source: 'protocol',
      // Legacy timeline is deliberately empty: content can only come from the envelopes.
      timeline: { ...emptyTimelineViewModel(), envelopes: PROTOCOL_EVENTS },
    });
    const roles = vm.turns.map((t) => t.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
    const kinds = vm.flatItems.map((i) => i.kind);
    expect(kinds).toContain('user_prompt');
    expect(kinds).toContain('tool_call');
  });

  it('falls back to the legacy timeline when envelopes are empty', () => {
    const legacy = reduceAgentTimeline(PROTOCOL_EVENTS, []);
    const vm = renderHook({ openCodePane: false, source: 'protocol', timeline: legacy });
    expect(vm.turns.length).toBeGreaterThan(0);
    expect(vm.flatItems.length).toBeGreaterThan(0);
  });

  it('ignores envelopes for non-protocol sources', () => {
    const tl = timelineWith(PROTOCOL_EVENTS);
    const vm = renderHook({ openCodePane: false, source: 'native_tui', timeline: tl });
    expect(vm.turns.length).toBeGreaterThan(0);
  });

  it('leaves OpenCode panes on the store path', () => {
    const vm = renderHook({
      openCodePane: true,
      source: 'opencode_fallback',
      timeline: timelineWith(PROTOCOL_EVENTS),
    });
    expect(vm.turns).toEqual([]);
  });
});

describe('mergeEnvelopeLog', () => {
  it('dedupes by seq, orders, and bounds the log', () => {
    const a = mergeEnvelopeLog([], [PROTOCOL_EVENTS[2]!, PROTOCOL_EVENTS[0]!]);
    expect(a.map((e) => e.seq)).toEqual([1, 3]);
    const b = mergeEnvelopeLog(a, [PROTOCOL_EVENTS[0]!]);
    expect(b).toBe(a);
    const c = mergeEnvelopeLog(a, PROTOCOL_EVENTS, 2);
    expect(c.map((e) => e.seq)).toEqual([3, 4]);
  });
});
