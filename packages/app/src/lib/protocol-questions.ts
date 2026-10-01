import type { QuestionInfo } from '../components/opencode/QuestionDock';
import type { TimelineApproval } from './agent-timeline-reducer';

/** Decision prefix the backend reads as "these are the user answers" (see ANSWER_PREFIX in Rust). */
const ANSWER_PREFIX = 'answer:';

type ProtocolQuestion = {
  question?: unknown;
  header?: unknown;
  options?: unknown;
  multiSelect?: unknown;
};

/** Questions an agent asked through the approval channel (Claude AskUserQuestion). */
export function questionsFromApproval(approval: TimelineApproval): QuestionInfo[] {
  if (approval.kind !== 'question') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(approval.detail);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((raw: ProtocolQuestion) => {
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

/** Decision string answering the questions: each answer is the chosen labels joined by commas. */
export function answerDecision(questions: readonly QuestionInfo[], answers: readonly string[][]): string {
  const byQuestion: Record<string, string> = {};
  questions.forEach((info, index) => {
    byQuestion[info.question] = (answers[index] ?? []).join(', ');
  });
  return `${ANSWER_PREFIX}${JSON.stringify(byQuestion)}`;
}
