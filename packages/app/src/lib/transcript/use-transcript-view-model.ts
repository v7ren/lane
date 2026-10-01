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
import {
  emptyTranscriptViewModel,
  flattenTranscriptTurns,
  type TranscriptNotice,
  type TranscriptTurn,
} from './types.js';
import { demoTranscriptForPane } from '../demo/transcript-fixtures.js';
import type { AgentSessionSource, SessionTimeline } from '../../hooks/useAgentSession';
import { setLocalNoticeAnchor, useLocalNotices, type LocalNotice } from '../local-notices';

export function useTranscriptViewModel(
  paneId: string,
  active: boolean,
  openCodePane: boolean,
  source: AgentSessionSource,
  timeline: SessionTimeline,
  openCodeSessionId?: string | null,
): TranscriptViewModel {
  const localNotices = useLocalNotices(paneId);
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

  const transcript = useMemo(() => {
    if (demoVm) return demoVm;
    if (preferOpenCodeStore) {
      if (!sessionId || !storeState) {
        return emptyTranscriptViewModel();
      }
      return fromOpenCode(storeState, sessionId);
    }
    return transcriptFromTimeline(source, timeline);
  }, [demoVm, preferOpenCodeStore, sessionId, source, storeState, timeline]);

  useEffect(() => {
    setLocalNoticeAnchor(paneId, transcript.turns.at(-1)?.id);
  }, [paneId, transcript.turns]);

  return useMemo(() => mergeLocalNotices(transcript, localNotices), [localNotices, transcript]);
}

function mergeLocalNotices(
  transcript: TranscriptViewModel,
  localNotices: readonly LocalNotice[],
): TranscriptViewModel {
  if (localNotices.length === 0) return transcript;

  const existingTurnIds = new Set(transcript.turns.map((turn) => turn.id));
  const noticesByTurn = new Map<string, TranscriptTurn[]>();
  const unanchoredNotices: TranscriptTurn[] = [];

  for (const localNotice of localNotices) {
    const notice: TranscriptNotice = {
      kind: 'notice',
      id: localNotice.id,
      level: localNotice.level,
      text: localNotice.text,
    };
    const noticeTurn: TranscriptTurn = {
      id: `local-notice-turn-${localNotice.id}`,
      role: 'assistant',
      items: [notice],
    };
    const afterTurnId = localNotice.afterTurnId;

    if (afterTurnId && existingTurnIds.has(afterTurnId)) {
      const anchoredNotices = noticesByTurn.get(afterTurnId) ?? [];
      noticesByTurn.set(afterTurnId, [...anchoredNotices, noticeTurn]);
    } else {
      unanchoredNotices.push(noticeTurn);
    }
  }

  const turns = transcript.turns.flatMap((turn) => [turn, ...(noticesByTurn.get(turn.id) ?? [])]);
  turns.push(...unanchoredNotices);

  return {
    ...transcript,
    turns,
    flatItems: flattenTranscriptTurns(turns),
  };
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
