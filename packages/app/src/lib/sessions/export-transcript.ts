import type { Message } from '@loomria/shared/opencode';
import { opencodeSessionActions } from './opencode-session-actions';

export function messagesToMarkdown(messages: Message[], title: string): string {
  const lines = [`# ${title}`, ''];
  for (const msg of messages) {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    lines.push(`## ${role}`, '');
    const text = extractPlainText(msg);
    lines.push(text || '_(empty)_', '');
  }
  return lines.join('\n');
}

function extractPlainText(message: Message): string {
  const withParts = message as Message & { parts?: { type?: string; text?: string }[] };
  if (withParts.parts?.length) {
    return withParts.parts
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text!)
      .join('\n');
  }
  return '';
}

export async function exportSessionTranscript(args: {
  paneId: string;
  sessionId: string;
  title: string;
  format: 'markdown' | 'json';
}): Promise<{ contents: string; defaultName: string }> {
  const messages = await opencodeSessionActions.listMessages(args.paneId, args.sessionId);
  const safeTitle = args.title.replace(/[^\w.-]+/g, '_').slice(0, 48) || 'session';
  if (args.format === 'json') {
    return {
      contents: JSON.stringify({ sessionId: args.sessionId, messages }, null, 2),
      defaultName: `${safeTitle}.json`,
    };
  }
  return {
    contents: messagesToMarkdown(messages, args.title),
    defaultName: `${safeTitle}.md`,
  };
}
