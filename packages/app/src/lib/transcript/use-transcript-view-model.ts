import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useDemoFixtures } from '../demo/DemoContext';
import { isTauriRuntime } from '../is-tauri';
import { getOpenCodeStore } from '../opencode/store.js';
import {
  fromAgentEventEnvelopes,
  fromAgentTimeline,
  fromOpenCode,
  type TranscriptViewModel,
} from './index.js';
import { emptyTranscriptViewModel } from './types.js';
import { demoTranscriptForPane } from '../demo/transcript-fixtures.js';
import type { AgentSessionSource, SessionTimeline } from '../../hooks/useAgentSession';

export function useTranscriptViewModel(
  paneId: string,
  active: boolean,
  openCodePane: boolean,
  source: AgentSessionSource,
  timeline: SessionTimeline,
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
    return transcriptFromTimeline(source, timeline);
  }, [demoVm, preferOpenCodeStore, sessionId, source, storeState, timeline]);
}

/**
 * Protocol panes render from the raw AgentEvent envelopes; everything else (and
 * protocol panes that have no envelopes yet) falls back to the legacy timeline bridge.
 */
export function transcriptFromTimeline(
  source: AgentSessionSource,
  timeline: SessionTimeline,
): TranscriptViewModel {
  if (source === 'protocol' && timeline.envelopes && timeline.envelopes.length > 0) {
    return fromAgentEventEnvelopes([...timeline.envelopes]);
  }
  return fromAgentTimeline(timeline);
}
