import { describe, expect, it } from 'vitest';
import type { AgentEventEnvelope } from '../../lib/agent-events';
import { reduceAgentTimeline } from '../../lib/agent-timeline-reducer';
import { questionsFromApproval } from '../../lib/protocol-questions';
import { buildProtocolQuestionDockItems } from './question-dock-items';

describe('buildProtocolQuestionDockItems', () => {
  it('passes Codex auto-resolution and receive time through to the question dock', () => {
    const receivedAt = 1_800_000_000_000;
    const envelope: AgentEventEnvelope = {
      pane_id: 'pane-1',
      seq: 4,
      epoch: 2,
      ts_ms: receivedAt,
      event: {
        type: 'approval_requested',
        approval_id: 'question-1',
        title: 'Question',
        detail: '[]',
        kind: 'question',
        options: ['allow_once', 'deny'],
        payload: {
          type: 'questions',
          auto_resolution_ms: 30_000,
          questions: [
            {
              header: 'Color',
              question: 'Pick a color',
              options: [{ label: 'Blue' }],
              multi_select: false,
              allow_other: true,
              secret: false,
            },
          ],
        },
      },
    };
    const approval = reduceAgentTimeline([], [envelope]).pendingApprovals[0];
    if (!approval) throw new Error('Expected the Codex question approval to be pending');

    const staleEpoch = { ...envelope, epoch: 1, seq: 1, ts_ms: receivedAt - 60_000 };
    const laterDuplicate = { ...envelope, seq: 5, ts_ms: receivedAt + 10_000 };
    const [item] = buildProtocolQuestionDockItems(
      [{ approval, questions: questionsFromApproval(approval) }],
      [staleEpoch, envelope, laterDuplicate],
    );

    expect(item).toMatchObject({
      id: 'question-1',
      autoResolutionMs: 30_000,
      receivedAt,
    });
    expect(item?.questions[0]?.question).toBe('Pick a color');
  });
});
