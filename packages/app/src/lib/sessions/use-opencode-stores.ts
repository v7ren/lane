import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { getOpenCodeStore, type OpenCodeStoreState } from '../opencode/store.js';

const EMPTY_MAP = new Map<string, OpenCodeStoreState>();

function buildSnapshot(paneIds: string[]): Map<string, OpenCodeStoreState> {
  if (paneIds.length === 0) return EMPTY_MAP;
  const map = new Map<string, OpenCodeStoreState>();
  for (const paneId of paneIds) {
    map.set(paneId, getOpenCodeStore(paneId).getState());
  }
  return map;
}

function mapsEqual(a: Map<string, OpenCodeStoreState>, b: Map<string, OpenCodeStoreState>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
}

export function useOpenCodePaneStates(paneIds: string[]): Map<string, OpenCodeStoreState> {
  const key = paneIds.slice().sort().join('|');
  const cachedRef = useRef<Map<string, OpenCodeStoreState>>(EMPTY_MAP);

  const subscribe = useMemo(() => {
    const stores = paneIds.map((id) => getOpenCodeStore(id));
    return (onStoreChange: () => void) => {
      const unsubs = stores.map((s) => s.subscribe(onStoreChange));
      return () => unsubs.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const getSnapshot = useMemo(() => {
    return () => {
      const next = buildSnapshot(paneIds);
      if (!mapsEqual(cachedRef.current, next)) {
        cachedRef.current = next;
      }
      return cachedRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useEnsureOpenCodeStores(
  paneIds: string[],
  selectedSessionByPane: Record<string, string | undefined>,
): void {
  const paneKey = useMemo(() => paneIds.slice().sort().join('|'), [paneIds]);

  useEffect(() => {
    for (const paneId of paneIds) {
      void getOpenCodeStore(paneId).loadInitial();
    }
  }, [paneKey, paneIds]);

  const loadKey = useMemo(
    () =>
      paneIds
        .map((id) => `${id}:${selectedSessionByPane[id] ?? ''}`)
        .sort()
        .join('|'),
    [paneIds, selectedSessionByPane],
  );

  useEffect(() => {
    for (const paneId of paneIds) {
      const sessionId = selectedSessionByPane[paneId];
      if (!sessionId) continue;
      void getOpenCodeStore(paneId).ensureSessionMessages(sessionId);
    }
  }, [loadKey, paneIds, selectedSessionByPane]);
}
