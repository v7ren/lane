import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { TranscriptTurn } from '../../lib/transcript';
import { formatAssistantMetaLine } from '../../lib/transcript';
import { TranscriptItemView } from './TranscriptItemView';

export function UserTurnRow({ turn }: { turn: TranscriptTurn }) {
  const prompt = turn.items.find((i) => i.kind === 'user_prompt');
  const [open, setOpen] = useState(!(prompt?.kind === 'user_prompt' && prompt.collapsedDefault));
  if (!prompt || prompt.kind !== 'user_prompt') return null;
  return (
    <div
      className="rounded-md border border-border-subtle bg-elevated shadow-sm"
      data-testid="user-turn"
    >
      <button
        type="button"
        className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-hover rounded-md"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="text-text-3 mt-0.5">{open ? '▾' : '▸'}</span>
        <span className="text-text-3 font-mono">&gt;</span>
        <span className="flex-1 text-body text-text whitespace-pre-wrap break-words">
          {open ? prompt.text : prompt.text.split('\n')[0]}
        </span>
        {!open && <ChevronRight className="w-4 h-4 text-text-3 shrink-0" />}
        {open && <ChevronDown className="w-4 h-4 text-text-3 shrink-0" />}
      </button>
      {open && prompt.files.length > 0 && (
        <div className="px-3 pb-2 flex flex-wrap gap-1">
          {prompt.files.map((f) => (
            <span
              key={f.id}
              className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-surface border border-border-subtle text-text-2"
            >
              {f.filename ?? f.path ?? 'file'}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function AssistantTurnBlock({ turn }: { turn: TranscriptTurn }) {
  const metaLine = turn.meta ? formatAssistantMetaLine(turn.meta) : undefined;
  return (
    <div className="space-y-2 py-2" data-testid="assistant-turn">
      {turn.items.map((item) => (
        <TranscriptItemView key={item.id} item={item} />
      ))}
      {metaLine && (
        <p className="text-meta text-text-3 pt-1 border-t border-border-subtle/50" data-testid="meta-footer">
          {metaLine}
        </p>
      )}
    </div>
  );
}
