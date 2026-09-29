export type QuestionOption = {
  label: string;
  description?: string | null;
};

export type PendingQuestion = {
  request_id?: string | null;
  message_id?: string | null;
  question: string;
  options: QuestionOption[];
  status?: string | null;
};

export type MessagePartView =
  | { type: 'text'; text: string }
  | {
      type: 'question';
      question: string;
      options: QuestionOption[];
      status?: string | null;
    }
  | { type: 'tool'; tool: string; status?: string | null };

export type MessageView = {
  id?: string | null;
  role: string;
  model?: { provider?: string; id?: string } | null;
  finish?: string | null;
  error?: string | null;
  parts: MessagePartView[];
};

export type SessionMessagesView = {
  pane_id: string;
  session_id: string;
  messages: MessageView[];
  pending_question?: PendingQuestion | null;
  last_assistant_text?: string | null;
};

export type OpenCodePermission = {
  id: string;
  session_id?: string | null;
  sessionID?: string | null;
};

export function messageFingerprint(view: SessionMessagesView): string {
  const tail = view.messages
    .slice(-6)
    .map((m) => `${m.id ?? ''}:${m.role}:${m.parts.length}:${m.error ?? ''}`)
    .join('|');
  const pq = view.pending_question?.request_id ?? view.pending_question?.question ?? '';
  return `${view.messages.length}:${tail}:${pq}:${view.last_assistant_text ?? ''}`;
}

export function flattenMessageText(message: MessageView): string {
  const chunks: string[] = [];
  for (const part of message.parts) {
    if (part.type === 'text') chunks.push(part.text);
    else if (part.type === 'question') chunks.push(part.question);
    else if (part.type === 'tool') {
      const label = part.status ? `${part.tool} (${part.status})` : part.tool;
      chunks.push(`[tool] ${label}`);
    }
  }
  if (message.error) chunks.push(message.error);
  return chunks.join('\n').trim();
}
