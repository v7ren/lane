import type { QuestionInfo } from '../components/opencode/QuestionDock';
import type { TimelineApproval } from './agent-timeline-reducer';

/** Decision prefix the backend reads as "these are the user answers" (see ANSWER_PREFIX in Rust). */
const ANSWER_PREFIX = 'answer:';

type LegacyQuestion = {
  question?: unknown;
  header?: unknown;
  options?: unknown;
  multiSelect?: unknown;
};

/** `QuestionInfo` plus the extra flags carried by the structured payload. */
export type ProtocolQuestionInfo = QuestionInfo & { secret?: boolean; allow_other?: boolean };

/** Questions an agent asked through the approval channel (Claude AskUserQuestion). */
export function questionsFromApproval(approval: TimelineApproval): ProtocolQuestionInfo[] {
  if (approval.kind !== 'question') return [];
  if (approval.payload?.type === 'questions') {
    return approval.payload.questions.map((q) => ({
      question: q.question,
      header: q.header,
      options: q.options.map((o) => ({ label: o.label, description: o.description ?? '' })),
      multiple: q.multi_select === true,
      custom: q.allow_other !== false,
      secret: q.secret === true,
      allow_other: q.allow_other !== false,
    }));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(approval.detail);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((raw: LegacyQuestion) => {
    const options = Array.isArray(raw.options) ? raw.options : [];
    return {
      question: String(raw.question ?? ''),
      header: String(raw.header ?? ''),
      options: options.map((option: { label?: unknown; description?: unknown }) => ({
        label: String(option.label ?? ''),
        description: String(option.description ?? ''),
      })),
      multiple: raw.multiSelect === true,
      custom: true,
    };
  });
}

/** Server auto-resolution deadline (ms) of a structured question request, if any. */
export function autoResolutionMsFromApproval(approval: TimelineApproval): number | undefined {
  if (approval.kind !== 'question' || approval.payload?.type !== 'questions') return undefined;
  const ms = approval.payload.auto_resolution_ms;
  return typeof ms === 'number' && ms > 0 ? ms : undefined;
}

/** Decision string answering the questions: each answer is the chosen labels joined by commas. */
export function answerDecision(questions: readonly QuestionInfo[], answers: readonly string[][]): string {
  const byQuestion: Record<string, string> = {};
  questions.forEach((info, index) => {
    byQuestion[info.question] = (answers[index] ?? []).join(', ');
  });
  return `${ANSWER_PREFIX}${JSON.stringify(byQuestion)}`;
}
