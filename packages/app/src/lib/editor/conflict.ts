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
