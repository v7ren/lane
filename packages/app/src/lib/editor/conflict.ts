export type DiskConflictPhase = 'idle' | 'prompt' | 'compare';

export type DiskConflictState = {
  phase: DiskConflictPhase;
  diskContent: string | null;
  diskMtimeMs: number | null;
};

export function onDiskChange(
  state: DiskConflictState,
  hasUnsavedEdits: boolean,
  diskContent: string,
  diskMtimeMs: number,
  editorContent: string,
): { state: DiskConflictState; reload: boolean } {
  if (!hasUnsavedEdits) {
    return {
      state: { phase: 'idle', diskContent: null, diskMtimeMs: null },
      reload: true,
    };
  }
  if (diskContent === editorContent) {
    return {
      state: { phase: 'idle', diskContent: null, diskMtimeMs: null },
      reload: false,
    };
  }
  return {
    state: { phase: 'prompt', diskContent, diskMtimeMs },
    reload: false,
  };
}

export function keepMine(state: DiskConflictState): DiskConflictState {
  if (state.phase !== 'prompt') return state;
  return { phase: 'idle', diskContent: null, diskMtimeMs: null };
}

export function openCompare(state: DiskConflictState): DiskConflictState {
  if (state.phase !== 'prompt') return state;
  return { ...state, phase: 'compare' };
}

export function reloadFromDisk(): DiskConflictState {
  return { phase: 'idle', diskContent: null, diskMtimeMs: null };
}

export type FileEditedAction = 'conflict' | 'reload' | 'ignore';

export type FileEditedDecision = {
  action: FileEditedAction;
  /** Matching tab path exactly as stored on the tab (undefined when ignored). */
  tabPath?: string;
};

function toSlashes(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}

/**
 * Normalize a path (absolute or workspace-relative, either separator) to a
 * workspace-relative forward-slash path. Paths outside the root stay absolute
 * so they never match a relative tab.
 */
export function normalizeToWorkspaceRelative(path: string, root: string): string {
  let p = toSlashes(path.trim());
  const r = toSlashes(root.trim()).replace(/\/+$/, '');
  if (r) {
    const winDrive = /^[a-zA-Z]:/.test(r);
    const cmpP = winDrive ? p.toLowerCase() : p;
    const cmpR = winDrive ? r.toLowerCase() : r;
    if (cmpP === cmpR) {
      p = '';
    } else if (cmpP.startsWith(`${cmpR}/`)) {
      p = p.slice(r.length + 1);
    }
  }
  while (p.startsWith('./')) p = p.slice(2);
  return p;
}

/** Decide how an externally edited file should affect the open editor tabs. */
export function decideFileEdited(
  path: string,
  tabs: ReadonlyArray<{ path: string; dirty: boolean }>,
  root: string,
): FileEditedDecision {
  const target = normalizeToWorkspaceRelative(path, root);
  if (!target) return { action: 'ignore' };
  const tab = tabs.find((t) => normalizeToWorkspaceRelative(t.path, root) === target);
  if (!tab) return { action: 'ignore' };
  return { action: tab.dirty ? 'conflict' : 'reload', tabPath: tab.path };
}
