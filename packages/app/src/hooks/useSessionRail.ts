import { useEffect, useState } from 'react';
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

export function useSessionRail(): Map<string, SessionRailState> {
  const demo = useDemoFixtures();
  const [states, setStates] = useState<Map<string, SessionRailState>>(
    () => demo?.sessionStates ?? new Map(),
  );

  useEffect(() => {
    if (demo) return;
    let unsub: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      const session = await loadBridgeSession();
      const url = session?.baseUrl ?? (await findBridgeUrl());
      if (!url || cancelled) return;
      unsub = subscribeBridgeEvents(url, (event) => {
        if (event.type !== 'session_state') return;
        const data = event.data as SessionRailState;
        if (!data?.pane_id) return;
        setStates((prev) => {
          const next = new Map(prev);
          next.set(data.pane_id, data);
          return next;
        });
      });
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [demo]);

  return demo?.sessionStates ?? states;
}
