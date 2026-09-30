import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import type { TranscriptToolCall } from '../../lib/transcript';
import { formatDuration } from '../../lib/transcript';
import { PartFallback } from './PartFallback';
import {
  displayPathChip,
  KNOWN_TOOL_NAMES,
  readOutputText,
  resolveToolFields,
  toolPathHeader,
  writeContentText,
  editDiffText,
} from './tool-render';

const GLOB_GREP_MAX_HITS = 10;

type GlobGrepKind = 'grep' | 'glob';

function grepGlobPatternText(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object') {
    const rec = input as Record<string, unknown>;
    if (typeof rec.pattern === 'string') return rec.pattern;
    if (typeof rec.glob === 'string') return rec.glob;
  }
  return '';
}

function globGrepCountLabel(kind: GlobGrepKind, count: number): string {
  switch (kind) {
    case 'grep':
      return `${count} matches`;
    case 'glob':
      return `${count} files`;
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

function parseGlobGrepOutput(output: unknown): { count: number; paths: string[] } {
  if (output == null) {
    return { count: 0, paths: [] };
  }
  const record = typeof output === 'object' ? (output as Record<string, unknown>) : null;
  const matches = record?.matches ?? output;
  const paths: string[] = Array.isArray(matches)
    ? matches.map((m) => String(m))
    : typeof matches === 'string'
      ? matches
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
      : [];

  const count =
    typeof record?.count === 'number' ? record.count : paths.length;

  return { count, paths };
}

type WebfetchStatusKey = 'status' | 'statusCode' | 'code';

function webfetchUrlText(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object') {
    const url = (input as Record<string, unknown>).url;
    if (typeof url === 'string') return url;
  }
  return '';
}

function webfetchStatusFromRecord(rec: Record<string, unknown>, key: WebfetchStatusKey): number | undefined {
  switch (key) {
    case 'status': {
      const val = rec.status;
      return typeof val === 'number' && Number.isFinite(val) ? val : undefined;
    }
    case 'statusCode': {
      const val = rec.statusCode;
      return typeof val === 'number' && Number.isFinite(val) ? val : undefined;
    }
    case 'code': {
      const val = rec.code;
      return typeof val === 'number' && Number.isFinite(val) ? val : undefined;
    }
    default: {
      const _never: never = key;
      return _never;
    }
  }
}

function webfetchHttpStatus(output: unknown): number | undefined {
  if (output == null || typeof output !== 'object') return undefined;
  const rec = output as Record<string, unknown>;
  const keys: WebfetchStatusKey[] = ['status', 'statusCode', 'code'];
  for (const key of keys) {
    const status = webfetchStatusFromRecord(rec, key);
    if (status != null) return status;
  }
  return undefined;
}

function WebfetchToolBody({ input, output }: { input: unknown; output: unknown }) {
  const url = webfetchUrlText(input);
  const httpStatus = webfetchHttpStatus(output);

  return (
    <div className="space-y-1 text-[12px] text-text-2">
      {url !== '' && (
        <p
          className="font-mono text-link break-all"
          data-testid="tool-webfetch-url"
        >
          {url}
        </p>
      )}
      {httpStatus != null && (
        <span className="font-mono text-text-3" data-testid="tool-webfetch-status">
          {String(httpStatus)}
        </span>
      )}
    </div>
  );
}

function GlobGrepToolBody({
  kind,
  input,
  output,
  projectRoot,
}: {
  kind: GlobGrepKind;
  input: unknown;
  output: unknown;
  projectRoot?: string | null;
}) {
  const pattern = grepGlobPatternText(input);
  const { count, paths } = parseGlobGrepOutput(output);
  const visiblePaths = paths.slice(0, GLOB_GREP_MAX_HITS);
  const patternTestId = kind === 'grep' ? 'tool-grep-pattern' : 'tool-glob-pattern';
  const countTestId = kind === 'grep' ? 'tool-grep-count' : 'tool-glob-count';
  const hitsTestId = kind === 'grep' ? 'tool-grep-hits' : 'tool-glob-hits';

  return (
    <div className="space-y-1 text-[12px] text-text-2">
      <p>
        <span className="font-mono" data-testid={patternTestId}>
          {pattern}
        </span>
      </p>
      <span data-testid={countTestId} className="text-text-3">
        {globGrepCountLabel(kind, count)}
      </span>
      {visiblePaths.length > 0 && (
        <div className="flex flex-wrap gap-1 items-center" data-testid={hitsTestId}>
          {visiblePaths.map((p) => {
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
        </div>
      )}
    </div>
  );
}

function toolStatusChipLabel(status: TranscriptToolCall['status']): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'running':
      return 'Running';
    case 'completed':
      return 'Completed';
    case 'error':
      return 'Error';
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

function ToolStatusChip({ status }: { status: TranscriptToolCall['status'] }) {
  const label = toolStatusChipLabel(status);
  switch (status) {
    case 'pending':
      return (
        <span
          data-testid="tool-status-chip"
          className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-elevated border border-border-subtle text-text-3"
        >
          {label}
        </span>
      );
    case 'running':
      return (
        <span
          data-testid="tool-status-chip"
          className="shrink-0 inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-accent/10 border border-accent/30 text-accent"
        >
          <Loader2 className="w-2.5 h-2.5 animate-spin" aria-hidden />
          {label}
        </span>
      );
    case 'completed':
      return (
        <span
          data-testid="tool-status-chip"
          className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-status-done/15 border border-status-done/30 text-status-done"
        >
          {label}
        </span>
      );
    case 'error':
      return (
        <span
          data-testid="tool-status-chip"
          className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-status-error/15 border border-status-error/30 text-status-error"
        >
          {label}
        </span>
      );
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

const BASH_OUTPUT_MAX_LINES = 40;

function bashCommandText(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object') {
    const rec = input as Record<string, unknown>;
    if (typeof rec.command === 'string') return rec.command;
    if (typeof rec.input === 'string') return rec.input;
  }
  return '';
}

function bashOutputText(output: unknown): string {
  if (output == null) return '';
  if (typeof output === 'string') return output;
  if (typeof output === 'object') {
    const rec = output as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof rec.stdout === 'string') parts.push(rec.stdout);
    if (typeof rec.stderr === 'string') parts.push(rec.stderr);
    if (typeof rec.output === 'string') parts.push(rec.output);
    if (parts.length > 0) return parts.join('');
  }
  return '';
}

function TruncatedMonoLines({
  text,
  maxLines = BASH_OUTPUT_MAX_LINES,
  testId,
}: {
  text: string;
  maxLines?: number;
  testId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const trimmed = text.trimEnd();
  if (!trimmed) {
    return (
      <pre
        data-testid={testId}
        className="whitespace-pre-wrap font-mono text-[12px] text-text-2"
      />
    );
  }
  const lines = trimmed.split(/\r?\n/);
  if (lines.length <= maxLines) {
    return (
      <pre
        data-testid={testId}
        className="whitespace-pre-wrap font-mono text-[12px] text-text-2"
      >
        {trimmed}
      </pre>
    );
  }
  const collapsed = lines.slice(0, maxLines).join('\n');
  return (
    <div>
      <pre
        data-testid={testId}
        className="whitespace-pre-wrap font-mono text-[12px] text-text-2"
      >
        {expanded ? trimmed : collapsed}
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

function BashToolBody({ input, output }: { input: unknown; output: unknown }) {
  const command = bashCommandText(input);
  const outputText = bashOutputText(output);
  return (
    <>
      <TruncatedMonoLines text={command} maxLines={BASH_OUTPUT_MAX_LINES} testId="tool-bash-command" />
      {outputText !== '' && (
        <TruncatedMonoLines text={outputText} testId="tool-bash-output" />
      )}
    </>
  );
}

function CollapsibleToolContent({
  text,
  testId,
}: {
  text: string;
  testId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const trimmed = text.trimEnd();
  if (!trimmed) return null;
  return (
    <div>
      {expanded && (
        <pre
          data-testid={testId}
          className="whitespace-pre-wrap font-mono text-[12px] text-text-2"
        >
          {trimmed}
        </pre>
      )}
      <button
        type="button"
        className="text-meta text-link"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </div>
  );
}

export function ToolCard({
  tool,
  projectRoot,
}: {
  tool: TranscriptToolCall;
  projectRoot?: string | null;
}) {
  const [open, setOpen] = useState(tool.status === 'running' || tool.status === 'completed');
  const { name, input, output, diff } = resolveToolFields(tool, projectRoot);
  const header = toolPathHeader(tool, name, input, projectRoot);

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
        <ToolStatusChip status={tool.status} />
        {header.kindLabel != null ? (
          <span className="flex items-center gap-2 flex-1 min-w-0">
            <span className="shrink-0 text-[10px] font-medium text-text-3">{header.kindLabel}</span>
            <span
              data-testid={header.pathTestId}
              className="font-mono text-[12px] text-text truncate"
              title={header.primary}
            >
              {header.primary}
            </span>
          </span>
        ) : (
          <span className="font-mono text-[12px] text-text flex-1 min-w-0 truncate">{header.primary}</span>
        )}
        {tool.durationMs != null && (
          <span className="shrink-0 text-meta text-text-3">{formatDuration(tool.durationMs)}</span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-border-subtle" data-testid="tool-card-body">
          {(name === 'bash' || name === 'shell') && (
            <BashToolBody input={input} output={output} />
          )}
          {(name === 'read' || name === 'read_file') && (
            <div className="space-y-2">
              {(input as { start?: number; end?: number })?.start != null && (
                <span className="text-[12px] text-text-3">
                  L{(input as { start?: number }).start}–
                  {(input as { end?: number }).end ?? '?'}
                </span>
              )}
              <CollapsibleToolContent
                text={readOutputText(output)}
                testId="tool-read-content"
              />
            </div>
          )}
          {name === 'write' && (
            <CollapsibleToolContent
              text={writeContentText(input)}
              testId="tool-write-content"
            />
          )}
          {(name === 'edit' || name === 'apply_patch') && (
            <TruncatedMonoLines
              text={editDiffText(input, diff)}
              maxLines={BASH_OUTPUT_MAX_LINES}
              testId="tool-edit-diff"
            />
          )}
          {name === 'grep' && (
            <GlobGrepToolBody kind="grep" input={input} output={output} projectRoot={projectRoot} />
          )}
          {name === 'glob' && (
            <GlobGrepToolBody kind="glob" input={input} output={output} projectRoot={projectRoot} />
          )}
          {(name === 'webfetch' || name === 'web_fetch') && (
            <WebfetchToolBody input={input} output={output} />
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
