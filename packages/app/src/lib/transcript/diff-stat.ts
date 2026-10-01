export type DiffStat = { added: number; removed: number };

const LCS_CELL_LIMIT = 4_000_000;

function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Lines added and removed between two texts, after dropping common lines (LCS). */
export function lineDiffCounts(oldText: string, newText: string): DiffStat | undefined {
  let a = splitLines(oldText);
  let b = splitLines(newText);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  a = a.slice(start, endA);
  b = b.slice(start, endB);
  if (a.length === 0 || b.length === 0) return { added: b.length, removed: a.length };
  if (a.length * b.length > LCS_CELL_LIMIT) return undefined;

  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  const common = prev[b.length];
  return { added: b.length - common, removed: a.length - common };
}

/** Counts `+` / `-` lines of a unified diff, ignoring file headers and hunk markers. */
export function unifiedDiffCounts(diff: string): DiffStat {
  let added = 0;
  let removed = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) removed += 1;
  }
  return { added, removed };
}

function parseMaybeJson(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  const t = input.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return input;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return input;
  }
}

function str(rec: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

function sum(a: DiffStat, b: DiffStat): DiffStat {
  return { added: a.added + b.added, removed: a.removed + b.removed };
}

/**
 * `+N −M` for an edit-like tool call, or undefined when the tool is not an edit
 * or the counts cannot be derived. `name` is the canonical lower-case tool name.
 */
export function diffStat(name: string, rawInput: unknown, diff?: string): DiffStat | undefined {
  const lower = name.toLowerCase();
  const input = parseMaybeJson(rawInput);
  const rec = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : undefined;
  let result: DiffStat | undefined;
  if (lower === 'write') {
    const content = rec ? str(rec, 'content', 'contents', 'text') : undefined;
    if (content !== undefined) result = { added: splitLines(content).length, removed: 0 };
  } else if (lower === 'multiedit' || lower === 'multi_edit') {
    const edits = rec && Array.isArray(rec.edits) ? rec.edits : undefined;
    if (edits) {
      result = { added: 0, removed: 0 };
      for (const e of edits) {
        if (!e || typeof e !== 'object') continue;
        const er = e as Record<string, unknown>;
        const editStat = lineDiffCounts(
          str(er, 'old_string', 'oldString') ?? '',
          str(er, 'new_string', 'newString') ?? '',
        );
        if (!editStat) {
          result = undefined;
          break;
        }
        result = sum(result, editStat);
      }
    }
  } else if (lower === 'edit') {
    const o = rec ? str(rec, 'old_string', 'oldString') : undefined;
    const n = rec ? str(rec, 'new_string', 'newString') : undefined;
    if (o !== undefined || n !== undefined) result = lineDiffCounts(o ?? '', n ?? '');
  } else if (lower === 'filechange' || lower === 'file_change') {
    const changes = rec && Array.isArray(rec.changes) ? rec.changes : undefined;
    if (changes) {
      result = { added: 0, removed: 0 };
      for (const c of changes) {
        if (!c || typeof c !== 'object') continue;
        const d = str(c as Record<string, unknown>, 'diff');
        if (d) result = sum(result, unifiedDiffCounts(d));
      }
    }
  }
  if (!result && (lower === 'edit' || lower === 'apply_patch' || lower === 'filechange') && diff?.trim()) {
    result = unifiedDiffCounts(diff);
  }
  if (!result || (result.added === 0 && result.removed === 0)) return undefined;
  return result;
}
