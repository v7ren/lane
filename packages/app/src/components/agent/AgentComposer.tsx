import { useCallback, useState } from 'react';

export function AgentComposer({
  disabled,
  disabledReason,
  busy,
  showCancel,
  onSend,
  onCancel,
}: {
  disabled: boolean;
  disabledReason?: string;
  busy: boolean;
  showCancel: boolean;
  onSend: (text: string) => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const [draft, setDraft] = useState('');

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || disabled || busy) return;
    setDraft('');
    await onSend(text);
  }, [busy, disabled, draft, onSend]);

  return (
    <div className="border-t border-lr-border bg-lr-panel/90 p-2 space-y-1">
      {disabled && disabledReason && (
        <p className="text-[11px] text-lr-muted px-1">{disabledReason}</p>
      )}
      <div className="flex gap-1.5">
        <textarea
          className="flex-1 text-xs px-2 py-1.5 rounded-md border border-lr-border bg-lr-bg resize-none min-h-[2.5rem] max-h-32 focus:outline-none focus:ring-1 focus:ring-lr-accent/40"
          rows={2}
          value={draft}
          disabled={disabled || busy}
          aria-label="Message to agent"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={disabled ? 'Composer unavailable' : 'Message agent…'}
        />
        <div className="flex flex-col gap-1 self-end">
          <button
            type="button"
            disabled={disabled || busy || !draft.trim()}
            className="px-3 py-1 text-xs rounded-md border border-lr-border bg-lr-raised hover:bg-lr-bg disabled:opacity-40"
            onClick={() => void send()}
          >
            Send
          </button>
          {showCancel && (
            <button
              type="button"
              disabled={busy}
              className="px-3 py-1 text-xs rounded-md border border-lr-err/40 text-lr-err hover:bg-lr-err/10 disabled:opacity-40"
              onClick={() => void onCancel()}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
      <p className="text-[10px] text-lr-muted px-1">
        Enter to send · Shift+Enter for newline ·{' '}
        <kbd className="px-1 rounded border border-lr-border">Ctrl+Shift+A</kbd> approve top
      </p>
    </div>
  );
}
