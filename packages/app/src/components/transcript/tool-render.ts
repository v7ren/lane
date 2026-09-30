import { normalizeToolPayload } from '../../lib/transcript/tool-mapping';
import type { TranscriptToolCall } from '../../lib/transcript';

export function parseToolInput(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  const trimmed = input.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return input;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return input;
  }
}

export function canonicalToolName(tool: TranscriptToolCall): string {
  const raw = (tool.name ?? '').trim();
  if (raw) return raw.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_');
  const title = (tool.title ?? '').trim().toLowerCase();
  if (title.startsWith('read')) return 'read';
  return title.replace(/[^a-z0-9_]/g, '_');
}

export function toolDisplayLabel(tool: TranscriptToolCall): string {
  const name = canonicalToolName(tool);
  if (name === 'read' || name === 'read_file') return 'Read';
  if (name === 'bash' || name === 'shell') return 'Bash';
  if (name === 'write') return 'Write';
  if (name === 'edit' || name === 'apply_patch') return 'Edit';
  if (name === 'grep') return 'Grep';
  if (name === 'glob') return 'Glob';
  if (name === 'webfetch' || name === 'web_fetch') return 'Web fetch';
  if (name === 'todowrite' || name === 'todo_write' || name === 'todo') return 'Todo';
  if (name === 'task') return 'Task';
  const pretty = tool.name?.replace(/_/g, ' ').trim();
  return pretty ? pretty.charAt(0).toUpperCase() + pretty.slice(1) : 'Tool';
}

export function resolveToolFields(
  tool: TranscriptToolCall,
  projectRoot?: string | null,
): {
  name: string;
  input: unknown;
  output: unknown;
  diff?: string;
} {
  const name = canonicalToolName(tool);
  const parsedIn = parseToolInput(tool.input);
  const parsedOut = parseToolInput(tool.output);
  const normalized = normalizeToolPayload(name, parsedIn, parsedOut, { projectRoot });
  let input = normalized.input;
  if (name === 'read' || name === 'read_file') {
    const path =
      filePathFromToolInput(parsedIn) ??
      filePathFromToolInput(normalized.input) ??
      filePathFromToolInput(tool.input);
    const rec =
      (typeof normalized.input === 'object' && normalized.input
        ? normalized.input
        : typeof parsedIn === 'object' && parsedIn
          ? parsedIn
          : {}) as Record<string, unknown>;
    input = {
      path,
      start: rec.startLine ?? rec.start,
      end: rec.endLine ?? rec.end,
    };
  }
  return {
    name,
    input,
    output: normalized.output,
    diff: normalized.diff ?? tool.diff,
  };
}

export function filePathFromToolInput(input: unknown): string | undefined {
  if (typeof input === 'string') {
    const parsed = parseToolInput(input);
    if (parsed !== input) return filePathFromToolInput(parsed);
    return input;
  }
  if (input && typeof input === 'object') {
    const rec = input as Record<string, unknown>;
    const path =
      rec.path ?? rec.filePath ?? rec.file ?? rec.target ?? rec.filename;
    if (typeof path === 'string' && path.length > 0) return path;
  }
  return undefined;
}

export function displayPathChip(fullPath: string, projectRoot: string | null | undefined): {
  label: string;
  title: string;
} {
  const title = fullPath;
  if (!projectRoot) {
    const base = fullPath.replace(/\\/g, '/').split('/').pop();
    return { label: base ?? fullPath, title };
  }
  const normRoot = projectRoot.replace(/\\/g, '/').replace(/\/$/, '');
  const normPath = fullPath.replace(/\\/g, '/');
  const rootLower = normRoot.toLowerCase();
  const pathLower = normPath.toLowerCase();
  if (pathLower.startsWith(`${rootLower}/`)) {
    return { label: normPath.slice(normRoot.length + 1), title };
  }
  if (pathLower === rootLower) {
    return { label: normPath.split('/').pop() ?? fullPath, title };
  }
  const base = normPath.split('/').pop();
  return { label: base ?? fullPath, title };
}

export function readOutputText(output: unknown): string {
  if (output == null) return '';
  if (typeof output === 'string') return output;
  if (typeof output === 'object') {
    const rec = output as Record<string, unknown>;
    if (typeof rec.content === 'string') return rec.content;
    if (typeof rec.text === 'string') return rec.text;
    try {
      return JSON.stringify(output, null, 2);
    } catch {
      return String(output);
    }
  }
  return String(output);
}

function editStringsFromInput(input: unknown): { oldText: string; newText: string } {
  if (input && typeof input === 'object') {
    const rec = input as Record<string, unknown>;
    const oldRaw = rec.oldString ?? rec.old_string ?? rec.old;
    const newRaw = rec.newString ?? rec.new_string ?? rec.new;
    const oldText = typeof oldRaw === 'string' ? oldRaw : '';
    const newText = typeof newRaw === 'string' ? newRaw : '';
    return { oldText, newText };
  }
  return { oldText: '', newText: '' };
}

function looksLikeUnifiedDiff(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.startsWith('@@')) return true;
  if (trimmed.includes('\n@@')) return true;
  return /^---\s/m.test(trimmed) || /^\+\+\+\s/m.test(trimmed);
}

function computeSimpleLineDiff(oldText: string, newText: string): string {
  if (oldText === newText) return '';
  const oldLines = oldText.split(/\r?\n/);
  const newLines = newText.split(/\r?\n/);
  const lines: string[] = [];
  let oi = 0;
  let ni = 0;
  while (oi < oldLines.length || ni < newLines.length) {
    if (oi < oldLines.length && ni < newLines.length && oldLines[oi] === newLines[ni]) {
      oi += 1;
      ni += 1;
      continue;
    }
    if (
      oi < oldLines.length &&
      (ni >= newLines.length || !newLines.slice(ni).includes(oldLines[oi]))
    ) {
      lines.push(`- ${oldLines[oi]}`);
      oi += 1;
      continue;
    }
    if (ni < newLines.length) {
      lines.push(`+ ${newLines[ni]}`);
      ni += 1;
    }
  }
  return lines.join('\n');
}

export function editDiffText(input: unknown, diff?: string): string {
  if (typeof diff === 'string' && diff.trim()) {
    if (looksLikeUnifiedDiff(diff)) return diff.trimEnd();
    const { oldText, newText } = editStringsFromInput(input);
    if (!oldText && !newText) return diff.trimEnd();
  }
  const { oldText, newText } = editStringsFromInput(input);
  if (oldText || newText) return computeSimpleLineDiff(oldText, newText);
  if (typeof diff === 'string' && diff.trim()) return diff.trimEnd();
  return '';
}

export function writeContentText(input: unknown): string {
  if (typeof input === 'string') {
    const parsed = parseToolInput(input);
    if (parsed !== input) return writeContentText(parsed);
    return input;
  }
  if (input && typeof input === 'object') {
    const rec = input as Record<string, unknown>;
    const content = rec.content ?? rec.contents ?? rec.text ?? rec.body;
    if (typeof content === 'string') return content;
  }
  return '';
}

export function toolPathHeader(
  tool: TranscriptToolCall,
  name: string,
  input: unknown,
  projectRoot?: string | null,
): {
  primary: string;
  pathTestId?: string;
  kindLabel?: string;
} {
  const isRead = name === 'read' || name === 'read_file';
  const isWrite = name === 'write';
  const isEdit = name === 'edit' || name === 'apply_patch';
  if (!isRead && !isWrite && !isEdit) {
    return { primary: toolDisplayLabel(tool) };
  }
  const full = filePathFromToolInput(input);
  if (!full) {
    return { primary: toolDisplayLabel(tool) };
  }
  const chip = displayPathChip(full, projectRoot);
  let pathTestId: string;
  if (isWrite) {
    pathTestId = 'tool-write-path';
  } else if (isRead) {
    pathTestId = 'tool-read-path';
  } else {
    pathTestId = 'tool-edit-path';
  }
  return {
    primary: chip.label,
    pathTestId,
    kindLabel: toolDisplayLabel(tool),
  };
}

export function formatJsonFallback(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export const KNOWN_TOOL_NAMES = new Set([
  'bash',
  'shell',
  'read',
  'read_file',
  'write',
  'edit',
  'apply_patch',
  'grep',
  'glob',
  'webfetch',
  'web_fetch',
  'todowrite',
  'todo_write',
  'todo',
  'task',
]);
