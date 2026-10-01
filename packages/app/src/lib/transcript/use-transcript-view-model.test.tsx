import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, AgentEventEnvelope } from '../agent-events';
import { emptyTimelineViewModel, reduceAgentTimeline } from '../agent-timeline-reducer';
import { mergeEnvelopeLog } from '../agent-session';
import type { SessionTimeline } from '../../hooks/useAgentSession';
import type { TranscriptViewModel } from './types';
import { pushLocalNotice } from '../local-notices';
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
  paneId?: string;
  openCodePane: boolean;
  source: 'protocol' | 'native_tui' | 'opencode_fallback';
  timeline: SessionTimeline;
  openCodeSessionId?: string | null;
}): TranscriptViewModel {
  let result: TranscriptViewModel | null = null;
  function Host() {
    result = useTranscriptViewModel(
      args.paneId ?? 'p1',
      true,
      args.openCodePane,
      args.source,
      args.timeline,
      args.openCodeSessionId ?? null,
    );
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

  it('places a local notice directly after its referenced transcript turn', () => {
    const paneId = 'notice-after-turn';
    const noticeId = pushLocalNotice(paneId, {
      level: 'warning',
      text: 'Local command finished',
      afterTurnId: 't1',
    });

    const vm = renderHook({
      paneId,
      openCodePane: false,
      source: 'protocol',
      timeline: { ...emptyTimelineViewModel(), envelopes: PROTOCOL_EVENTS },
    });

    const turnIndex = vm.turns.findIndex((turn) => turn.id === 't1');
    const noticeTurnIndex = vm.turns.findIndex((turn) =>
      turn.items.some((item) => item.kind === 'notice' && item.id === noticeId),
    );
    expect(turnIndex).toBeGreaterThanOrEqual(0);
    expect(noticeTurnIndex).toBe(turnIndex + 1);
    expect(vm.flatItems).toContainEqual({
      kind: 'notice',
      id: noticeId,
      level: 'warning',
      text: 'Local command finished',
    });
  });

  it('renders local notices on an empty OpenCode store view', () => {
    const paneId = 'notice-opencode-empty';
    const noticeId = pushLocalNotice(paneId, { level: 'info', text: 'OpenCode notice' });

    const vm = renderHook({
      paneId,
      openCodePane: true,
      source: 'opencode_fallback',
      timeline: emptyTimelineViewModel(),
      openCodeSessionId: null,
    });

    expect(vm.turns).toHaveLength(1);
    expect(vm.flatItems).toEqual([
      { kind: 'notice', id: noticeId, level: 'info', text: 'OpenCode notice' },
    ]);
  });

  it('anchors a new local notice to the last transcript turn when no anchor is supplied', () => {
    const paneId = 'notice-current-turn-anchor';
    const rendered = { currentVm: null as TranscriptViewModel | null };
    function Host() {
      rendered.currentVm = useTranscriptViewModel(
        paneId,
        true,
        false,
        'protocol',
        { ...emptyTimelineViewModel(), envelopes: PROTOCOL_EVENTS },
        null,
      );
      return null;
    }

    host = document.createElement('div');
    root = createRoot(host);
    act(() => root?.render(<Host />));

    let noticeId = '';
    act(() => {
      noticeId = pushLocalNotice(paneId, { level: 'info', text: 'Current turn result' });
    });

    const currentVm = rendered.currentVm;
    if (!currentVm) throw new Error('hook did not render');

    const turnIndex = currentVm.turns.findIndex((turn) => turn.id === 't1');
    const noticeTurnIndex = currentVm.turns.findIndex((turn) =>
      turn.items.some((item) => item.kind === 'notice' && item.id === noticeId),
    );
    expect(currentVm.flatItems).toContainEqual({
      kind: 'notice',
      id: noticeId,
      level: 'info',
      text: 'Current turn result',
    });
    expect(noticeTurnIndex).toBe(turnIndex + 1);
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
