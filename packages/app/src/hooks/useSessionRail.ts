import { useEffect, useSyncExternalStore } from 'react';
import { useDemoFixtures } from '../lib/demo/DemoContext';
import { loadBridgeSession } from '../lib/bridge-auth';
import { findBridgeUrl, subscribeBridgeEvents } from '../lib/bridge';

export type SessionRailState = {
  pane_id: string;
  agent_type?: string | null;
  state: string;
  updated_at_ms: number;
  detail?: string | null;
};

/**
 * One shared store for every caller. Each component used to keep its own copy and subscribe to the
 * live `session_state` events on its own, so a component mounted after an event (e.g. the right
 * rail) never saw it and showed "Connecting" while the sidebar said "Done".
 */
let sharedStates: Map<string, SessionRailState> = new Map();
const listeners = new Set<() => void>();
let subscribers = 0;
let stopBridge: (() => void) | null = null;
let starting = false;

function publish(data: SessionRailState): void {
  const next = new Map(sharedStates);
  next.set(data.pane_id, data);
  sharedStates = next;
  for (const listener of listeners) listener();
}

async function startBridge(): Promise<void> {
  if (stopBridge || starting) return;
  starting = true;
  try {
    const session = await loadBridgeSession();
    const url = session?.baseUrl ?? (await findBridgeUrl());
    if (!url || subscribers === 0) return;
    stopBridge = subscribeBridgeEvents(url, (event) => {
      if (event.type !== 'session_state') return;
      const data = event.data as SessionRailState;
      if (!data?.pane_id) return;
      publish(data);
    });
  } finally {
    starting = false;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test hook: forget all shared state. */
export function resetSessionRailForTests(): void {
  sharedStates = new Map();
  stopBridge?.();
  stopBridge = null;
  subscribers = 0;
  starting = false;
  listeners.clear();
}

export function useSessionRail(): Map<string, SessionRailState> {
  const demo = useDemoFixtures();
  const states = useSyncExternalStore(
    subscribe,
    () => sharedStates,
    () => sharedStates,
  );

  useEffect(() => {
    if (demo) return;
    subscribers += 1;
    void startBridge();
    return () => {
      subscribers -= 1;
    };
  }, [demo]);

  return demo?.sessionStates ?? states;
}
