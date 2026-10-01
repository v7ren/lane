import { normalizeToolPathValue, unescapeDisplayPath } from './path-display.js';
import type { ToolCallStatus, TranscriptToolCall } from './types.js';

export type ToolNormalizeContext = {
  projectRoot?: string | null;
};

export function mapOpenCodeToolStatus(status: string | undefined): ToolCallStatus {
  if (!status) return 'running';
  const lower = status.toLowerCase();
  if (lower === 'pending' || lower === 'waiting') return 'pending';
  if (lower === 'running') return 'running';
  if (lower === 'completed' || lower === 'done' || lower === 'success') return 'completed';
  if (lower.includes('error') || lower.includes('fail')) return 'error';
  return 'running';
}

export function mapAgentToolStatus(status?: 'pending' | 'running' | 'ok' | 'error'): ToolCallStatus {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'running':
      return 'running';
    case 'ok':
      return 'completed';
    case 'error':
      return 'error';
    default:
      return 'running';
  }
}

export function toolNameForDisplay(name: string): string {
  return name.replace(/_/g, ' ');
}

/** Normalize tool part state into structured input/output for UI renderers. */
function formatGlobGrepOutput(output: unknown, projectRoot?: string | null): unknown {
  if (typeof output === 'string') {
    const trimmed = output.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        return formatGlobGrepOutput(JSON.parse(trimmed) as unknown, projectRoot);
      } catch {
        return normalizeToolPathValue(unescapeDisplayPath(output), projectRoot);
      }
    }
    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => normalizeToolPathValue(line, projectRoot) as string);
    return lines.length <= 1 ? (lines[0] ?? output) : lines;
  }
  return normalizeToolPathValue(output, projectRoot);
}

export function normalizeToolPayload(
  toolName: string,
  input: unknown,
  output: unknown,
  context?: ToolNormalizeContext,
): Pick<TranscriptToolCall, 'input' | 'output' | 'diff'> {
  const projectRoot = context?.projectRoot;
  const name = toolName.toLowerCase();
  if (typeof input === 'string' && typeof output === 'string') {
    return { input, output };
  }
  const stateIn = input as Record<string, unknown> | undefined;
  const stateOut = output as Record<string, unknown> | undefined;
  if (name === 'bash' || name === 'shell') {
    return {
      input: stateIn?.command ?? stateIn?.input ?? input,
      output: stateOut?.output ?? stateOut?.stdout ?? output,
    };
  }
  if (name === 'read' || name === 'read_file') {
    const pathRaw = stateIn?.path ?? stateIn?.filePath ?? stateIn?.file ?? input;
    return {
      input: {
        path: normalizeToolPathValue(pathRaw, projectRoot),
        start: stateIn?.startLine ?? stateIn?.start,
        end: stateIn?.endLine ?? stateIn?.end,
      },
      output: normalizeToolPathValue(output, projectRoot),
    };
  }
  if (name === 'write' || name === 'edit' || name === 'apply_patch') {
    const diff =
      (typeof stateOut?.diff === 'string' ? stateOut.diff : undefined) ??
      (typeof stateIn?.diff === 'string' ? stateIn.diff : undefined);
    const pathRaw =
      stateIn?.path ?? stateIn?.filePath ?? stateIn?.file_path ?? stateIn?.file ?? stateIn?.target;
    const baseInput = {
      path: normalizeToolPathValue(pathRaw, projectRoot),
      content: stateIn?.content ?? stateIn?.contents,
    };
    if (name === 'edit' || name === 'apply_patch') {
      const oldString = stateIn?.oldString ?? stateIn?.old_string;
      const newString = stateIn?.newString ?? stateIn?.new_string;
      return {
        input: {
          ...baseInput,
          ...(typeof oldString === 'string' ? { oldString } : {}),
          ...(typeof newString === 'string' ? { newString } : {}),
        },
        output: stateOut?.output ?? output,
        diff,
      };
    }
    return {
      input: baseInput,
      output: stateOut?.output ?? output,
      diff,
    };
  }
  if (name === 'filechange' || name === 'file_change') {
    // Codex puts {"changes":[{path,kind,diff}]} in the input; keep it structured.
    return { input: input, output };
  }
  if (name === 'grep' || name === 'glob') {
    const pattern = stateIn?.pattern ?? stateIn?.glob ?? input;
    const rawOut = stateOut?.matches ?? stateOut?.paths ?? stateOut?.files ?? output;
    const meta =
      stateOut?.metadata && typeof stateOut.metadata === 'object'
        ? (stateOut.metadata as { count?: number })
        : undefined;
    const count = stateOut?.count ?? meta?.count;
    const formatted = formatGlobGrepOutput(rawOut, projectRoot);
    const matchCount =
      count ?? (Array.isArray(formatted) ? formatted.length : undefined);
    return {
      input: pattern,
      output: matchCount != null ? { matches: formatted, count: matchCount } : formatted,
    };
  }
  if (name === 'webfetch' || name === 'web_fetch') {
    return {
      input: stateIn?.url ?? input,
      output,
    };
  }
  return { input, output };
}
