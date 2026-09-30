import type { OpenCodeStoreState, SessionIssue, SessionStatus } from './store.js';

export type ParsedWireSessionStatus = {
  type: Exclude<SessionStatus, 'unknown'>;
  message?: string;
  attempt?: number;
  retryAtMs?: number;
};

function parseRetryAt(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  return undefined;
}

/** Parse OpenCode `session.status` payload or GET /session/status entry. */
export function parseWireSessionStatus(raw: unknown): ParsedWireSessionStatus | null {
  if (typeof raw === 'string') {
    switch (raw) {
      case 'busy':
      case 'retry':
      case 'idle':
        return { type: raw };
      default:
        return null;
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const typeRaw = record.type ?? record.status;
  if (typeof typeRaw !== 'string') return null;
  switch (typeRaw) {
    case 'busy':
    case 'retry':
    case 'idle': {
      const message =
        typeof record.message === 'string' && record.message.trim()
          ? record.message.trim()
          : undefined;
      const attempt =
        typeof record.attempt === 'number' && Number.isFinite(record.attempt)
          ? record.attempt
          : undefined;
      const retryAtMs = parseRetryAt(
        record.retryAt ?? record.retry_at ?? record.retry_at_ms ?? record.retryAtMs,
      );
      return { type: typeRaw, message, attempt, retryAtMs };
    }
    default:
      return null;
  }
}

export function applyParsedSessionStatus(
  state: OpenCodeStoreState,
  sessionID: string,
  parsed: ParsedWireSessionStatus,
  props: Record<string, unknown>,
): OpenCodeStoreState {
  let next: OpenCodeStoreState = {
    ...state,
    sessionStatus: { ...state.sessionStatus, [sessionID]: parsed.type },
  };
  if (parsed.type === 'idle') {
    next = clearOptimisticBusy(next, sessionID);
    if (state.sessionIssues[sessionID]) {
      const { [sessionID]: _removed, ...sessionIssues } = next.sessionIssues;
      next = { ...next, sessionIssues };
    }
    return next;
  }
  if (parsed.type === 'retry') {
    const message =
      parsed.message ??
      (typeof props.message === 'string' ? props.message : undefined) ??
      'Retrying';
    const issue: SessionIssue = {
      message,
      retryAtMs: parsed.retryAtMs,
      kind: 'retry',
      updatedAt: Date.now(),
    };
    next = {
      ...next,
      sessionIssues: { ...next.sessionIssues, [sessionID]: issue },
    };
  }
  return next;
}

export function applySessionStatusSnapshot(
  state: OpenCodeStoreState,
  snapshot: Record<string, unknown>,
): OpenCodeStoreState {
  let next = state;
  const busyIds = new Set(Object.keys(snapshot));
  for (const sessionId of next.sessionOrder) {
    if (!busyIds.has(sessionId) && next.sessionStatus[sessionId] !== 'idle') {
      next = applyParsedSessionStatus(next, sessionId, { type: 'idle' }, {});
    }
  }
  for (const [sessionId, raw] of Object.entries(snapshot)) {
    const parsed = parseWireSessionStatus(raw);
    if (parsed) {
      next = applyParsedSessionStatus(next, sessionId, parsed, {});
    }
  }
  return next;
}

export function markOptimisticBusy(
  state: OpenCodeStoreState,
  sessionID: string,
): OpenCodeStoreState {
  if (state.optimisticBusy[sessionID]) return state;
  return {
    ...state,
    optimisticBusy: { ...state.optimisticBusy, [sessionID]: true },
    sessionStatus: { ...state.sessionStatus, [sessionID]: 'busy' },
  };
}

export function clearOptimisticBusy(
  state: OpenCodeStoreState,
  sessionID: string,
): OpenCodeStoreState {
  if (!state.optimisticBusy[sessionID]) return state;
  const { [sessionID]: _removed, ...optimisticBusy } = state.optimisticBusy;
  return { ...state, optimisticBusy };
}

export function formatOpenCodeSessionStatusLabel(
  status: SessionStatus,
  issue?: SessionIssue | null,
  attempt?: number,
): string {
  switch (status) {
    case 'busy':
      return 'Busy';
    case 'retry': {
      const parts = ['Retrying'];
      if (attempt != null) parts.push(`attempt ${attempt}`);
      if (issue?.message) parts.push(issue.message);
      return parts.join(' · ');
    }
    case 'idle':
      return 'Idle';
    case 'unknown':
      return 'Idle';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
