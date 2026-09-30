import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import type { TranscriptItem, TranscriptToolCall } from '../../lib/transcript';
import { formatDuration } from '../../lib/transcript';
import { MarkdownBody } from './MarkdownBody';
import { PartFallback } from './PartFallback';
import {
  displayPathChip,
  KNOWN_TOOL_NAMES,
  resolveToolFields,
  toolDisplayLabel,
  filePathFromToolInput,
} from './tool-render';

function GlobGrepOutput({
  output,
  projectRoot,
}: {
  output: unknown;
  projectRoot?: string | null;
}) {
  const record = output && typeof output === 'object' ? (output as Record<string, unknown>) : null;
  const matches = record?.matches ?? output;
  const count =
    typeof record?.count === 'number'
      ? record.count
      : Array.isArray(matches)
        ? matches.length
        : undefined;

  const paths: string[] = Array.isArray(matches)
    ? matches.map((m) => String(m))
    : typeof matches === 'string'
      ? matches.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      : [];

  if (paths.length === 0) {
    return <PartFallback title="Details" value={output} />;
  }

  return (
    <div className="flex flex-wrap gap-1 items-center">
      {paths.map((p) => {
        const chip = displayPathChip(p, projectRoot);
        return (
          <span
            key={p}
            className="font-mono px-2 py-0.5 rounded-full bg-elevated border border-border-subtle"
            title={chip.title}
          >
            {chip.label}
          </span>
        );
      })}
      {count != null && <span className="text-text-3">{count} matches</span>}
    </div>
  );
}

function ToolStatusDot({ status }: { status: TranscriptToolCall['status'] }) {
  if (status === 'running') {
    return <Loader2 className="w-3 h-3 animate-spin text-accent" aria-hidden />;
  }
  const color =
    status === 'completed'
      ? 'bg-status-done'
      : status === 'error'
        ? 'bg-status-error'
        : status === 'pending'
          ? 'bg-text-3'
          : 'bg-accent';
  return <span className={`w-2 h-2 rounded-full ${color}`} aria-hidden />;
}

function TruncatedMono({
  text,
  max = 480,
}: {
  text: string;
  max?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return <pre className="whitespace-pre-wrap font-mono text-[12px] text-text-2">{trimmed}</pre>;
  }
  return (
    <div>
      <pre className="whitespace-pre-wrap font-mono text-[12px] text-text-2">
        {expanded ? trimmed : `${trimmed.slice(0, max)}…`}
      </pre>
      <button
        type="button"
        className="text-meta text-link mt-1"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </div>
  );
}

function ToolCard({
  tool,
  projectRoot,
}: {
  tool: TranscriptToolCall;
  projectRoot?: string | null;
}) {
  const [open, setOpen] = useState(tool.status === 'running' || tool.status === 'completed');
  const { name, input, output, diff } = resolveToolFields(tool, projectRoot);
  const headerLabel = toolDisplayLabel(tool);

  return (
    <div
      className="rounded-md border border-border-subtle bg-surface overflow-hidden"
      data-testid={`tool-${tool.id}`}
    >
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-hover"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-text-3 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-text-3 shrink-0" />
        )}
        <ToolStatusDot status={tool.status} />
        <span className="font-mono text-[12px] text-text">{headerLabel}</span>
        {tool.durationMs != null && (
          <span className="ml-auto text-meta text-text-3">{formatDuration(tool.durationMs)}</span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-border-subtle">
          {(name === 'bash' || name === 'shell') && (
            <>
              <TruncatedMono text={String(input ?? '')} />
              {output != null && <TruncatedMono text={String(output)} max={800} />}
            </>
          )}
          {(name === 'read' || name === 'read_file') && (
            <div className="flex flex-wrap gap-2 items-center text-[12px]">
              {(() => {
                const full =
                  filePathFromToolInput(input) ??
                  (typeof (input as { path?: string })?.path === 'string'
                    ? (input as { path: string }).path
                    : undefined);
                if (!full) return null;
                const chip = displayPathChip(full, projectRoot);
                return (
                  <span
                    className="font-mono px-2 py-0.5 rounded-full bg-elevated border border-border-subtle"
                    title={chip.title}
                  >
                    {chip.label}
                  </span>
                );
              })()}
              {(input as { start?: number; end?: number })?.start != null && (
                <span className="text-text-3">
                  L{(input as { start?: number }).start}–
                  {(input as { end?: number }).end ?? '?'}
                </span>
              )}
            </div>
          )}
          {(name === 'write' || name === 'edit' || name === 'apply_patch') && (
            <div className="space-y-1">
              {(() => {
                const full = filePathFromToolInput(input);
                if (!full) return null;
                const chip = displayPathChip(full, projectRoot);
                return (
                  <span className="font-mono text-[12px] text-text-2" title={chip.title}>
                    {chip.label}
                  </span>
                );
              })()}
              {diff && <TruncatedMono text={diff} max={1200} />}
            </div>
          )}
          {(name === 'grep' || name === 'glob') && (
            <div className="space-y-1 text-[12px] text-text-2">
              <p>
                <span className="font-mono">{String(input)}</span>
              </p>
              {output != null && (
                <GlobGrepOutput output={output} projectRoot={projectRoot} />
              )}
            </div>
          )}
          {(name === 'webfetch' || name === 'web_fetch') && (
            <p className="font-mono text-[12px] text-link break-all">{String(input)}</p>
          )}
          {(name === 'todowrite' || name === 'todo_write') && Array.isArray(output) && (
            <ul className="space-y-1 text-[12px]">
              {(output as { content?: string; status?: string }[]).map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-text-3">{t.status}</span>
                  <span>{t.content}</span>
                </li>
              ))}
            </ul>
          )}
          {name === 'task' && <PartFallback title="Details" value={input} />}
          {!KNOWN_TOOL_NAMES.has(name) && (
            <div className="grid gap-2 md:grid-cols-2">
              <PartFallback
                title={`Unknown tool: ${tool.name?.trim() || name}`}
                value={input}
              />
              {output != null && <PartFallback title="Details" value={output} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TranscriptItemView({
  item,
  projectRoot,
}: {
  item: TranscriptItem;
  projectRoot?: string | null;
}) {
  switch (item.kind) {
    case 'assistant_text':
      return (
        <div className="px-1 py-1" data-testid="assistant-text">
          <MarkdownBody markdown={item.markdown} />
          {item.streaming && <span className="text-meta text-text-3">Typing…</span>}
        </div>
      );
    case 'reasoning': {
      const label =
        item.durationMs != null
          ? `Thought · ${formatDuration(item.durationMs)}`
          : item.streaming
            ? 'Thought…'
            : 'Thought';
      return <CollapsibleMuted label={label} body={item.text} defaultOpen />;
    }
    case 'tool_call':
      return <ToolCard tool={item} projectRoot={projectRoot} />;
    case 'patch':
      return (
        <div className="flex flex-wrap gap-1 px-1">
          {item.paths.map((p) => (
            <span
              key={p}
              className="text-[11px] font-mono px-2 py-0.5 rounded-full border border-border-subtle bg-elevated"
            >
              {p}
            </span>
          ))}
        </div>
      );
    case 'todo_update':
      return (
        <ul className="text-[12px] space-y-1 px-1">
          {item.items.map((t) => (
            <li key={t.id} className="flex gap-2 text-text-2">
              <span className="text-text-3">{t.status}</span>
              <span>{t.content}</span>
            </li>
          ))}
        </ul>
      );
    case 'subtask':
      return (
        <CollapsibleMuted label={item.title ?? 'Subtask'} body={item.prompt} defaultOpen={false} />
      );
    case 'retry':
      return (
        <p className="text-meta text-status-approval px-1" data-testid="transcript-retry">
          Retry attempt {item.attempt}
          {item.message ? ` · ${item.message}` : ''}
          {item.retryAtMs != null
            ? ` · retry ${new Date(item.retryAtMs).toLocaleTimeString()}`
            : ''}
        </p>
      );
    case 'error':
      return (
        <p className="text-meta text-status-error px-1" data-testid="transcript-error">
          {item.message}
        </p>
      );
    case 'step_usage':
      return null;
    case 'user_prompt':
      return null;
    default: {
      const _never: never = item;
      return _never;
    }
  }
}

function CollapsibleMuted({
  label,
  body,
  defaultOpen,
}: {
  label: string;
  body: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border border-border-subtle/80 bg-canvas/40 text-[12px]">
      <button
        type="button"
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-text-3 hover:text-text-2"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {label}
      </button>
      {open && (
        <p className="px-2 pb-2 whitespace-pre-wrap text-text-3 border-t border-border-subtle/60">
          {body}
        </p>
      )}
    </div>
  );
}
