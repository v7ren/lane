import { useSyncExternalStore } from 'react';

import {
  selectEnvironment,
  selectMessages,
  selectPermissions,
  selectServerMeta,
  selectSessionStatus,
  selectSessions,
  selectTodos,
} from './selectors.js';
import { getOpenCodeStore } from './store.js';

function useOpenCodeStoreSlice<T>(paneId: string, selector: (state: ReturnType<ReturnType<typeof getOpenCodeStore>['getState']>) => T): T {
  const store = getOpenCodeStore(paneId);
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}

export function useOpenCodeSessions(paneId: string) {
  return useOpenCodeStoreSlice(paneId, selectSessions);
}

export function useOpenCodeMessages(paneId: string, sessionId: string) {
  return useOpenCodeStoreSlice(paneId, (state) => selectMessages(state, sessionId));
}

export function useOpenCodeSessionStatus(paneId: string, sessionId: string) {
  return useOpenCodeStoreSlice(paneId, (state) => selectSessionStatus(state, sessionId));
}

export function useOpenCodePermissions(paneId: string) {
  return useOpenCodeStoreSlice(paneId, selectPermissions);
}

export function useOpenCodeTodos(paneId: string, sessionId: string) {
  return useOpenCodeStoreSlice(paneId, (state) => selectTodos(state, sessionId));
}

export function useOpenCodeServer(paneId: string) {
  return useOpenCodeStoreSlice(paneId, selectServerMeta);
}

export function useOpenCodeEnvironment(paneId: string) {
  return useOpenCodeStoreSlice(paneId, selectEnvironment);
}
