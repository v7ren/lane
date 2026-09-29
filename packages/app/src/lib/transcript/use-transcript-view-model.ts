import { useEffect, useMemo, useState } from 'react';
import { useSyncExternalStore } from 'react';
import type { AgentTimelineViewModel } from '../agent-timeline-reducer';
import { useDemoFixtures } from '../demo/DemoContext';
import { isTauriRuntime } from '../is-tauri';
import { getOpenCodeStore } from '../opencode/store.js';
import { fromAgentTimeline, fromOpenCode, type TranscriptViewModel } from './index.js';
import { demoTranscriptForPane } from '../demo/transcript-fixtures.js';
import type { AgentSessionSource } from '../../hooks/useAgentSession';

export function useTranscriptViewModel(
  paneId: string,
  active: boolean,
  agentType: string | undefined,
  source: AgentSessionSource,
  timeline: AgentTimelineViewModel,
): TranscriptViewModel {
  const demo = useDemoFixtures();
  const demoVm = demo ? demoTranscriptForPane(demo.variant, paneId) : null;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const useStore =
    !demo &&
    isTauriRuntime() &&
    agentType === 'opencode_native' &&
    source !== 'native_tui';

  const store = useStore ? getOpenCodeStore(paneId) : null;

  useEffect(() => {
    if (!store || !active) return;
    let cancelled = false;
    void store.loadInitial().then(() => {
      if (cancelled) return;
      const state = store.getState();
      const id = state.sessionOrder[0] ?? Object.keys(state.sessions)[0] ?? null;
      setSessionId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [active, store]);

  const storeState = useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    () => (store ? store.getState() : null),
    () => null,
  );

  return useMemo(() => {
    if (demoVm) return demoVm;
    if (useStore && storeState && sessionId) {
      return fromOpenCode(storeState, sessionId);
    }
    return fromAgentTimeline(timeline);
  }, [demoVm, sessionId, storeState, timeline, useStore]);
}
