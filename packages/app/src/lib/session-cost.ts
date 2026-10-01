import { useCallback, useEffect, useSyncExternalStore } from 'react';

/** Claude's `total_cost_usd` is cumulative per process; `base` carries the cost of earlier processes. */
export type SessionCostState = Readonly<{ base: number; latest: number | null }>;

export const EMPTY_SESSION_COST: SessionCostState = { base: 0, latest: null };

/** A value lower than the previous one means the process restarted, so the previous one joins `base`. */
export function nextSessionCost(state: SessionCostState, value: number | undefined | null): SessionCostState {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value === state.latest) return state;
  if (state.latest !== null && value < state.latest) {
    const base = state.base + state.latest;
    return Number.isFinite(base) ? { base, latest: value } : state;
  }
  return { base: state.base, latest: value };
}

export function sessionCostTotal(state: SessionCostState): number | null {
  return state.latest === null ? null : state.base + state.latest;
}

export function formatCost(total: number | null): string | null {
  if (total === null || !Number.isFinite(total) || total < 0) return null;
  return `$${total.toFixed(total >= 10 ? 1 : 2)}`;
}

/** Running session total for a pane; null while no cost was reported. */
export function useSessionCost(paneId: string, latest: number | undefined | null): number | null {
  const subscribe = useCallback((listener: () => void) => subscribeToPane(paneId, listener), [paneId]);
  const getSnapshot = useCallback(() => getPaneState(paneId), [paneId]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    updatePaneCost(paneId, latest);
  }, [latest, paneId]);

  return sessionCostTotal(state);
}

let paneCosts = new Map<string, SessionCostState>();
const paneSubscribers = new Map<string, Set<() => void>>();

function getPaneState(paneId: string): SessionCostState {
  return paneCosts.get(paneId) ?? EMPTY_SESSION_COST;
}

function subscribeToPane(paneId: string, listener: () => void): () => void {
  const listeners = paneSubscribers.get(paneId) ?? new Set<() => void>();
  listeners.add(listener);
  paneSubscribers.set(paneId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) paneSubscribers.delete(paneId);
  };
}

function updatePaneCost(paneId: string, value: number | undefined | null): void {
  const current = getPaneState(paneId);
  const next = nextSessionCost(current, value);
  if (next === current) return;

  paneCosts = new Map(paneCosts).set(paneId, next);
  paneSubscribers.get(paneId)?.forEach((listener) => listener());
}
