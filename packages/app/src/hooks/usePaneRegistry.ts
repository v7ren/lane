import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PaneStreamManager } from '../terminal';
import { disposeTerminalSession } from '../terminal/terminal-session-registry';
import { useDemoFixtures } from '../lib/demo/DemoContext';
import {
  tauri,
  type PaneInfo,
  type PaneStatusEvent,
  type TerminalDataEvent,
  type TerminalSnapshotEvent,
} from '../lib/tauri';

export interface PaneData {
  info: PaneInfo;
  status: PaneInfo['status'];
}

export interface PaneRegistryApi {
  panes: Map<string, PaneData>;
  paneList: PaneData[];
  /** True after the first pane list fetch completes. */
  initialReady: boolean;
  spawnPane: (args: Parameters<typeof tauri.spawnPane>[0]) => Promise<string>;
  killPane: (paneId: string) => Promise<void>;
  replacePaneAgent: (paneId: string, agentType: string, cwd?: string) => Promise<string>;
  killAll: () => Promise<void>;
  writeInput: (paneId: string, text: string, appendNewline?: boolean) => Promise<void>;
  resize: (paneId: string, cols: number, rows: number) => Promise<void>;
  refresh: () => Promise<void>;
  subscribePaneData: (paneId: string, cb: (data: Uint8Array) => void) => () => void;
}

const EMPTY: Map<string, PaneData> = new Map();

function demoPanesMap(demo: NonNullable<ReturnType<typeof useDemoFixtures>>): Map<string, PaneData> {
  const next = new Map<string, PaneData>();
  for (const row of demo.paneList) next.set(row.info.id, row);
  return next;
}

export function usePaneRegistry(): PaneRegistryApi {
  const demo = useDemoFixtures();
  const [panes, setPanes] = useState<Map<string, PaneData>>(() =>
    demo ? demoPanesMap(demo) : EMPTY,
  );
  const [initialReady, setInitialReady] = useState(Boolean(demo));
  const panesRef = useRef(panes);
  panesRef.current = panes;

  const streamsRef = useRef(new PaneStreamManager());
  const replacingRef = useRef<Set<string>>(new Set());
  const exitRefreshTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const refresh = useCallback(async () => {
    try {
      const list = await tauri.listPanes();
      const next = new Map<string, PaneData>();
      for (const info of list) {
        next.set(info.id, { info, status: info.status });
      }
      setPanes(next);
    } catch (err) {
      console.error('[usePaneRegistry] refresh failed', err);
    } finally {
      setInitialReady(true);
    }
  }, []);

  useEffect(() => {
    if (demo) return;
    refresh();
  }, [demo, refresh]);

  useEffect(() => {
    if (demo) return;
    let disposed = false;
    let unsubSnapshot: (() => void) | undefined;
    let unsubData: (() => void) | undefined;
    let unsubStatus: (() => void) | undefined;
    let unsubExit: (() => void) | undefined;
    let unsubPanesChanged: (() => void) | undefined;

    (async () => {
      unsubPanesChanged = await tauri.onPanesChanged(() => {
        void refresh();
      });
      const ingestData = (e: TerminalDataEvent) => {
        streamsRef.current.ingest(e.pane_id, e.data);
      };
      unsubData = await tauri.onTerminalData(ingestData);
      unsubSnapshot = await tauri.onTerminalSnapshot((e: TerminalSnapshotEvent) => {
        // Snapshot events are retained for MCP/debug consumers; xterm rendering
        // consumes raw terminal-data events instead.
        void e;
      });
      unsubStatus = await tauri.onPtyStatus((e: PaneStatusEvent) => {
        setPanes((prev) => {
          const existing = prev.get(e.pane_id);
          if (!existing || existing.status === e.status) return prev;
          const next = new Map(prev);
          next.set(e.pane_id, { ...existing, status: e.status });
          return next;
        });
      });
      unsubExit = await tauri.onPtyExit((e) => {
        if (replacingRef.current.has(e.pane_id)) {
          return;
        }
        setPanes((prev) => {
          const next = new Map(prev);
          const existing = next.get(e.pane_id);
          if (existing) {
            next.set(e.pane_id, { ...existing, status: 'error' });
          }
          return next;
        });
        const pending = exitRefreshTimers.current.get(e.pane_id);
        if (pending) clearTimeout(pending);
        const timer = setTimeout(() => {
          exitRefreshTimers.current.delete(e.pane_id);
          if (!replacingRef.current.has(e.pane_id)) {
            void refresh();
          }
        }, 200);
        exitRefreshTimers.current.set(e.pane_id, timer);
      });

      if (disposed) {
        unsubData?.();
        unsubSnapshot?.();
        unsubStatus?.();
        unsubExit?.();
        unsubPanesChanged?.();
      }
    })();

    return () => {
      disposed = true;
      unsubData?.();
      unsubSnapshot?.();
      unsubStatus?.();
      unsubExit?.();
      unsubPanesChanged?.();
    };
  }, [demo, refresh]);

  const spawnPane = useCallback(async (args: Parameters<typeof tauri.spawnPane>[0]) => {
    if (demo) {
      const id = `demo-${args.agent_type}-${Date.now()}`;
      const now = Date.now();
      const info: PaneInfo = {
        id,
        agent_type: args.agent_type,
        pid: 4242,
        status: 'running',
        created_at: now,
        last_output_at: now,
        cwd: args.cwd ?? demo.projectPath,
        cols: args.cols ?? 120,
        rows: args.rows ?? 32,
      };
      setPanes((prev) => {
        const next = new Map(prev);
        next.set(id, { info, status: info.status });
        return next;
      });
      return id;
    }
    const id = await tauri.spawnPane(args);
    await refresh();
    return id;
  }, [demo, refresh]);

  const killPane = useCallback(async (paneId: string) => {
    disposeTerminalSession(paneId);
    if (demo) {
      setPanes((prev) => {
        const next = new Map(prev);
        next.delete(paneId);
        return next;
      });
      return;
    }
    await tauri.killPane(paneId);
    streamsRef.current.delete(paneId);
    await refresh();
  }, [demo, refresh]);

  const replacePaneAgent = useCallback(
    async (paneId: string, agentType: string, cwd?: string) => {
      if (demo) {
        setPanes((prev) => {
          const existing = prev.get(paneId);
          if (!existing) throw new Error(`unknown pane: ${paneId}`);
          const info = { ...existing.info, agent_type: agentType, created_at: Date.now() };
          const next = new Map(prev);
          next.set(paneId, { info, status: existing.status });
          return next;
        });
        return paneId;
      }
      const existing = panesRef.current.get(paneId);
      if (!existing) {
        throw new Error(`unknown pane: ${paneId}`);
      }
      const { cols, rows } = existing.info;
      const spawnCwd = cwd ?? existing.info.cwd;

      streamsRef.current.reset(paneId);

      const pendingExit = exitRefreshTimers.current.get(paneId);
      if (pendingExit) {
        clearTimeout(pendingExit);
        exitRefreshTimers.current.delete(paneId);
      }

      replacingRef.current.add(paneId);
      try {
        await tauri.killPane(paneId);
        const id = await tauri.spawnPane({
          agent_type: agentType,
          pane_id: paneId,
          cols,
          rows,
          cwd: spawnCwd,
        });
        await refresh();
        return id;
      } catch (err) {
        await refresh();
        throw err;
      } finally {
        setTimeout(() => {
          replacingRef.current.delete(paneId);
        }, 800);
      }
    },
    [demo, refresh],
  );

  const killAll = useCallback(async () => {
    for (const id of panesRef.current.keys()) {
      disposeTerminalSession(id);
    }
    if (demo) {
      setPanes(new Map());
      return;
    }
    await tauri.killAllPanes();
    await refresh();
  }, [demo, refresh]);

  const writeInput = useCallback(async (paneId: string, text: string, appendNewline = true) => {
    await tauri.writeInput(paneId, text, appendNewline);
  }, []);

  const resize = useCallback(async (paneId: string, cols: number, rows: number) => {
    await tauri.resize(paneId, cols, rows);
  }, []);

  const subscribePaneData = useCallback((paneId: string, cb: (data: Uint8Array) => void) => {
    return streamsRef.current.subscribe(paneId, cb, tauri.readRawBuffer);
  }, []);


  const paneList = useMemo(
    () => Array.from(panes.values()).sort((a, b) => a.info.created_at - b.info.created_at),
    [panes],
  );

  return {
    panes,
    paneList,
    initialReady,
    spawnPane,
    killPane,
    replacePaneAgent,
    killAll,
    writeInput,
    resize,
    refresh,
    subscribePaneData,
  };
}
