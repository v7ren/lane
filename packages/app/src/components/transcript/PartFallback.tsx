import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatJsonFallback } from './tool-render';

export function PartFallback({ title, value }: { title: string; value: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const formatted = formatJsonFallback(value);
  if (!formatted) return null;

  return (
    <div
      className="rounded-md border border-border-subtle/80 bg-canvas/40 text-[12px]"
      data-testid="part-fallback"
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5 text-text-3">
        {expanded ? (
          <ChevronDown className="w-3 h-3 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="w-3 h-3 shrink-0" aria-hidden />
        )}
        <span className="flex-1 text-text-2">{title}</span>
        <button
          type="button"
          className="text-meta text-link shrink-0"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? 'Hide details' : 'Show details'}
        </button>
      </div>
      {expanded && (
        <pre className="px-2 pb-2 whitespace-pre-wrap font-mono text-text-2 border-t border-border-subtle/60">
          {formatted}
        </pre>
      )}
    </div>
  );
}
