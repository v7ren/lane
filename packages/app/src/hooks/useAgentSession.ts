import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentEventEnvelope, Capabilities } from '../lib/agent-events';
import { capabilitiesNativeTuiOnly } from '../lib/agent-events';
import {
  mergeAgentEventEnvelopes,
  reduceAgentTimeline,
  type AgentTimelineViewModel,
} from '../lib/agent-timeline-reducer';
import {
  isSessionCommandMissing,
  sessionCapabilities,
  sessionHistory,
  subscribeAgentEvents,
} from '../lib/agent-session';
import { useDemoFixtures } from '../lib/demo/DemoContext';
import { opencodeCapabilities, opencodeViewToEnvelopes } from '../lib/opencode-agent-adapter';
import { useOpenCodeChat } from './useOpenCodeChat';
import { isTauriRuntime } from '../lib/is-tauri';

export type AgentSessionSource = 'protocol' | 'opencode_fallback' | 'native_tui';

export function useAgentSession(
  paneId: string | null,
  active: boolean,
  agentType?: string | null,
  sessionState?: string | null,
) {
  const demo = useDemoFixtures();
  const demoSession = paneId && demo?.agentSessions[paneId] ? demo.agentSessions[paneId] : null;

  const [capabilities, setCapabilities] = useState<Capabilities>(capabilitiesNativeTuiOnly());
  const [source, setSource] = useState<AgentSessionSource>('native_tui');
  const [timeline, setTimeline] = useState<AgentTimelineViewModel>(() =>
    reduceAgentTimeline([], []),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vmRef = useRef(timeline);

  const opencode = useOpenCodeChat(
    source === 'opencode_fallback' ? paneId : null,
    active && source === 'opencode_fallback',
    sessionState,
  );

  const applyVm = useCallback((vm: AgentTimelineViewModel) => {
    vmRef.current = vm;
    setTimeline(vm);
  }, []);

  const refreshCapabilities = useCallback(async () => {
    if (!paneId || !active) return;
    if (demoSession) {
      setCapabilities(demoSession.capabilities);
      setSource(demoSession.source);
      applyVm(demoSession.timeline);
      setError(null);
      setLoading(false);
      return;
    }
    if (!isTauriRuntime()) {
      setCapabilities(capabilitiesNativeTuiOnly());
      setSource('native_tui');
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const caps = await sessionCapabilities(paneId);
      setCapabilities(caps);
      setSource('protocol');
      const history = await sessionHistory(paneId);
      const vm = reduceAgentTimeline(history, []);
      applyVm(vm);
      setError(null);
    } catch (err) {
      if (isSessionCommandMissing(err) && agentType === 'opencode_native') {
        setCapabilities(opencodeCapabilities());
        setSource('opencode_fallback');
        setError(null);
      } else if (isSessionCommandMissing(err)) {
        setCapabilities(capabilitiesNativeTuiOnly());
        setSource('native_tui');
        setError(null);
      } else {
        setError(String(err));
      }
    } finally {
      setLoading(false);
    }
  }, [active, agentType, applyVm, demoSession, paneId]);

  useEffect(() => {
    if (!paneId || !active) {
      applyVm(reduceAgentTimeline([], []));
      return;
    }
    void refreshCapabilities();
  }, [active, applyVm, paneId, refreshCapabilities]);

  useEffect(() => {
    if (demoSession || !paneId || !active || source !== 'protocol') return;
    let unlisten: (() => void) | null = null;
    void subscribeAgentEvents((envelope: AgentEventEnvelope) => {
      if (envelope.pane_id !== paneId) return;
      const next = mergeAgentEventEnvelopes(vmRef.current, [envelope]);
      applyVm(next);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [active, applyVm, demoSession, paneId, source]);

  useEffect(() => {
    if (source !== 'opencode_fallback' || !paneId || !active) return;
    const envelopes = opencodeViewToEnvelopes(paneId, opencode.view, opencode.permissions);
    applyVm(reduceAgentTimeline([], envelopes));
  }, [active, applyVm, opencode.permissions, opencode.view, paneId, source]);

  return {
    capabilities,
    source,
    timeline,
    loading,
    error: error ?? opencode.error,
    refreshing: opencode.refreshing,
    refresh: source === 'opencode_fallback' ? opencode.refresh : refreshCapabilities,
  };
}
