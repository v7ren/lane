import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { TranscriptViewModel } from '../../lib/transcript';
import { AssistantTurnBlock, UserTurnRow } from './TurnRows';

const VIRTUAL_THRESHOLD = 200;

export function TranscriptView({
  vm,
  nativeTuiOnly,
  onForkFromMessage,
}: {
  vm: TranscriptViewModel;
  nativeTuiOnly: boolean;
  onForkFromMessage?: (messageId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stuckBottom, setStuckBottom] = useState(true);

  const rows = useMemo(
    () =>
      vm.turns.map((turn) => ({
        id: turn.id,
        turn,
      })),
    [vm.turns],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 8,
    enabled: rows.length > VIRTUAL_THRESHOLD,
  });

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setStuckBottom(distance < 48);
  }, []);

  useEffect(() => {
    if (!stuckBottom || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [vm.flatItems.length, stuckBottom]);

  if (nativeTuiOnly) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div className="max-w-sm space-y-2">
          <p className="text-body font-medium text-text">This agent runs in native TUI mode</p>
          <p className="text-meta text-text-3">
            Use the terminal surface for this session. When a protocol adapter is connected, chat
            appears here automatically.
          </p>
        </div>
      </div>
    );
  }

  const jumpLatest = () => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    setStuckBottom(true);
  };

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto px-3 py-2 space-y-3 min-h-0"
        onScroll={onScroll}
        data-testid="transcript-scroll"
      >
        {vm.rateLimit && (
          <p className="text-meta text-status-rate border border-border-subtle rounded-md p-2">
            {vm.rateLimit.message}
          </p>
        )}
        {vm.lastError && (
          <p className="text-meta text-status-error border border-border-subtle rounded-md p-2">
            {vm.lastError}
          </p>
        )}
        {rows.length > VIRTUAL_THRESHOLD ? (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vRow) => {
              const row = rows[vRow.index]!;
              return (
                <div
                  key={row.id}
                  data-index={vRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vRow.start}px)`,
                  }}
                >
                  {row.turn.role === 'user' ? (
                    <UserTurnRow turn={row.turn} onForkFromHere={onForkFromMessage} />
                  ) : (
                    <AssistantTurnBlock turn={row.turn} />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          rows.map((row) =>
            row.turn.role === 'user' ? (
              <UserTurnRow key={row.id} turn={row.turn} onForkFromHere={onForkFromMessage} />
            ) : (
              <AssistantTurnBlock key={row.id} turn={row.turn} />
            ),
          )
        )}
      </div>
      {!stuckBottom && (
        <button
          type="button"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-elevated px-3 py-1 text-meta text-text shadow-lg hover:bg-hover"
          onClick={jumpLatest}
        >
          Jump to latest
        </button>
      )}
    </div>
  );
}
