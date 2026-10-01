import type { AgentEventEnvelope } from '../../lib/agent-events';
import type { TimelineApproval } from '../../lib/agent-timeline-reducer';
import {
  autoResolutionMsFromApproval,
  type ProtocolQuestionInfo,
} from '../../lib/protocol-questions';
import type { QuestionDockItem } from '../opencode/QuestionDock';

export type ProtocolQuestionDockEntry = {
  approval: TimelineApproval;
  questions: ProtocolQuestionInfo[];
};

function receiveTimeForApproval(
  approvalId: string,
  envelopes: readonly AgentEventEnvelope[],
): number | undefined {
  const currentEpoch = envelopes.reduce(
    (latest, envelope) => Math.max(latest, envelope.epoch ?? 0),
    0,
  );
  let earliestMatch: AgentEventEnvelope | undefined;

  for (const envelope of envelopes) {
    if (
      (envelope.epoch ?? 0) !== currentEpoch ||
      envelope.event.type !== 'approval_requested' ||
      envelope.event.approval_id !== approvalId ||
      typeof envelope.ts_ms !== 'number'
    ) {
      continue;
    }
    if (!earliestMatch || envelope.seq < earliestMatch.seq) earliestMatch = envelope;
  }

  return earliestMatch?.ts_ms;
}

export function buildProtocolQuestionDockItems(
  entries: readonly ProtocolQuestionDockEntry[],
  envelopes: readonly AgentEventEnvelope[],
): QuestionDockItem[] {
  return entries.map(({ approval, questions }) => {
    const autoResolutionMs = autoResolutionMsFromApproval(approval);
    const receivedAt = receiveTimeForApproval(approval.id, envelopes);

    return {
      id: approval.id,
      questions,
      ...(autoResolutionMs !== undefined ? { autoResolutionMs } : {}),
      ...(receivedAt !== undefined ? { receivedAt } : {}),
    };
  });
}
