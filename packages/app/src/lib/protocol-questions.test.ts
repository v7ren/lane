import { describe, expect, it, vi } from 'vitest';
import type { TimelineApproval } from './agent-timeline-reducer';
import { answerDecision, autoResolutionMsFromApproval, questionsFromApproval } from './protocol-questions';

const DETAIL = JSON.stringify([
  {
    question: 'Which color do you pick?',
    header: 'Color',
    options: [
      { label: 'Red', description: 'Pick red' },
      { label: 'Blue', description: 'Pick blue' },
    ],
    multiSelect: false,
  },
]);

const approval = (kind: TimelineApproval['kind'], detail: string): TimelineApproval => ({
  id: 'q-1',
  title: 'Question',
  detail,
  kind,
  options: ['allow_once', 'deny'],
});

describe('protocol questions', () => {
  it('maps a Claude question approval onto the question dock shape', () => {
    const [question] = questionsFromApproval(approval('question', DETAIL));
    expect(question?.question).toBe('Which color do you pick?');
    expect(question?.options.map((o) => o.label)).toEqual(['Red', 'Blue']);
    expect(question?.multiple).toBe(false);
    expect(question?.custom).toBe(true);
  });

  it('ignores ordinary approvals and unreadable details', () => {
    expect(questionsFromApproval(approval('command', DETAIL))).toEqual([]);
    expect(questionsFromApproval(approval('question', 'not json'))).toEqual([]);
  });

  it('builds the answer decision keyed by question text, joining multi-select labels', () => {
    const questions = questionsFromApproval(approval('question', DETAIL));
    expect(answerDecision(questions, [['Red']])).toBe('answer:{"Which color do you pick?":"Red"}');
    expect(answerDecision(questions, [['Red', 'Blue']])).toBe(
      'answer:{"Which color do you pick?":"Red, Blue"}',
    );
  });

  it('reads payload.questions first, carrying secret and allow_other', () => {
    const withPayload: TimelineApproval = {
      ...approval('question', 'not json'),
      payload: {
        type: 'questions',
        questions: [
          {
            header: 'Key',
            question: 'API key?',
            options: [{ label: 'Paste' }],
            multi_select: true,
            allow_other: false,
            secret: true,
          },
        ],
      },
    };
    const [question] = questionsFromApproval(withPayload);
    expect(question?.question).toBe('API key?');
    expect(question?.options).toEqual([{ label: 'Paste', description: '' }]);
    expect(question?.multiple).toBe(true);
    expect(question?.custom).toBe(false);
    expect(question?.secret).toBe(true);
    expect(question?.allow_other).toBe(false);
  });

  it('keeps secret answers out of console output and reads the auto-resolution time', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
    const withPayload: TimelineApproval = {
      ...approval('question', '[]'),
      payload: {
        type: 'questions',
        auto_resolution_ms: 30000,
        questions: [
          { id: 'q1', header: 'Key', question: 'Token?', options: [], multi_select: false, allow_other: false, secret: true },
        ],
      },
    };
    const questions = questionsFromApproval(withPayload);
    expect(questions[0]?.secret).toBe(true);
    expect(autoResolutionMsFromApproval(withPayload)).toBe(30000);
    expect(autoResolutionMsFromApproval(approval('question', DETAIL))).toBeUndefined();
    expect(answerDecision(questions, [['s3cret']])).toBe('answer:{"Token?":"s3cret"}');
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});
