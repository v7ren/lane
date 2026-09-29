import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { AgentTimelineViewModel } from '../agent-timeline-reducer';
import { useDemoFixtures } from '../demo/DemoContext';
import { isTauriRuntime } from '../is-tauri';
import { getOpenCodeStore } from '../opencode/store.js';
import { fromAgentTimeline, fromOpenCode, type TranscriptViewModel } from './index.js';
import { emptyTranscriptViewModel } from './types.js';
import { demoTranscriptForPane } from '../demo/transcript-fixtures.js';
import type { AgentSessionSource } from '../../hooks/useAgentSession';

export function useTranscriptViewModel(
  paneId: string,
  active: boolean,
  openCodePane: boolean,
  source: AgentSessionSource,
  timeline: AgentTimelineViewModel,
  openCodeSessionId?: string | null,
): TranscriptViewModel {
  const demo = useDemoFixtures();
  const demoVm = demo ? demoTranscriptForPane(demo.variant, paneId) : null;

  const preferOpenCodeStore = !demo && isTauriRuntime() && openCodePane;

  const store = preferOpenCodeStore ? getOpenCodeStore(paneId) : null;
  const sessionId = openCodeSessionId ?? null;

  useEffect(() => {
    if (!store || !active || !sessionId) return;
    void store.ensureSessionMessages(sessionId);
  }, [active, sessionId, store]);

  const storeState = useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    () => (store ? store.getState() : null),
    () => null,
  );

  return useMemo(() => {
    if (demoVm) return demoVm;
    if (preferOpenCodeStore) {
      if (!sessionId || !storeState) {
        return emptyTranscriptViewModel();
      }
      return fromOpenCode(storeState, sessionId);
    }
    return fromAgentTimeline(timeline);
  }, [demoVm, preferOpenCodeStore, sessionId, storeState, timeline]);
}
