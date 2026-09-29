import { useEffect, useRef, useState } from 'react';
import { loadBridgeSession } from '../lib/bridge-auth';
import { findBridgeUrl, makeBridgeClient, subscribeBridgeEvents, type BridgeClient } from '../lib/bridge';
import type { PaneInfo } from '@loomria/shared';

export interface BridgeApi {
  client: BridgeClient | null;
  panesFromBridge: PaneInfo[];
  isReady: boolean;
  error: string | null;
}

export function useBridge(bridgeUrl?: string): BridgeApi {
  const [client, setClient] = useState<BridgeClient | null>(null);
  const [panesFromBridge, setPanesFromBridge] = useState<PaneInfo[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<BridgeClient | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    async function tryConnect() {
      if (cancelled) return;
      const session = await loadBridgeSession();
      const url = bridgeUrl ?? session?.baseUrl ?? await findBridgeUrl();
      if (cancelled) return;
      if (!url) {
        setError('Bridge not reachable');
        pollTimer = setTimeout(tryConnect, 2000);
        return;
      }
      const c = makeBridgeClient(url, session?.token);
      clientRef.current = c;
      setClient(c);
      setIsReady(true);
      setError(null);
      unsub = subscribeBridgeEvents(url, (ev) => {
        if (ev.type === 'panes') setPanesFromBridge(ev.panes);
      });
    }

    void tryConnect();
    return () => {
      cancelled = true;
      unsub?.();
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [bridgeUrl]);

  return { client, panesFromBridge, isReady, error };
}
