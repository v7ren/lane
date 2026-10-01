import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentEventEnvelope, Capabilities } from '../lib/agent-events';
import { capabilitiesNativeTuiOnly } from '../lib/agent-events';
import {
  mergeAgentEventEnvelopes,
  reduceAgentTimeline,
  type AgentTimelineViewModel,
} from '../lib/agent-timeline-reducer';
import {
  mergeEnvelopeLog,
  sessionCapabilities,
  sessionHistory,
  subscribeAgentEvents,
} from '../lib/agent-session';
import { useDemoFixtures } from '../lib/demo/DemoContext';
import { opencodeViewToEnvelopes } from '../lib/opencode-agent-adapter';
import { useOpenCodeChat } from './useOpenCodeChat';
import { isTauriRuntime } from '../lib/is-tauri';
import {
  resolveAgentSessionOnCapabilitiesError,
  type AgentSessionSource,
} from '../lib/agent-session-capabilities';

export type { AgentSessionSource };

/** Timeline view model carrying the raw ordered envelopes it was built from (protocol panes only). */
export type SessionTimeline = AgentTimelineViewModel & {
  envelopes?: readonly AgentEventEnvelope[];
};

const NO_ENVELOPES: readonly AgentEventEnvelope[] = [];

const CAPABILITY_RETRY_MS = 1000;
const MAX_CAPABILITY_RETRIES = 20;

function isProtocolChatAgent(agentType?: string | null): boolean {
  return agentType === 'claude' || agentType === 'claude_code' || agentType === 'codex';
}

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
  const [envelopes, setEnvelopes] = useState<readonly AgentEventEnvelope[]>(NO_ENVELOPES);
  const vmRef = useRef(timeline);
  const envelopesRef = useRef<readonly AgentEventEnvelope[]>(NO_ENVELOPES);

  const applyEnvelopes = useCallback((next: readonly AgentEventEnvelope[]) => {
    envelopesRef.current = next;
    setEnvelopes(next);
  }, []);

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
      applyEnvelopes(NO_ENVELOPES);
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
      applyEnvelopes(mergeEnvelopeLog(envelopesRef.current, history));
      setError(null);
    } catch (err) {
      const resolved = resolveAgentSessionOnCapabilitiesError(err, agentType);
      setCapabilities(resolved.capabilities);
      setSource(resolved.source);
      setError(resolved.error);
    } finally {
      setLoading(false);
    }
  }, [active, agentType, applyEnvelopes, applyVm, demoSession, paneId]);

  useEffect(() => {
    if (!paneId || !active) {
      applyVm(reduceAgentTimeline([], []));
      applyEnvelopes(NO_ENVELOPES);
      setSource('native_tui');
      setError(null);
      return;
    }
    setSource('native_tui');
    setError(null);
    applyVm(reduceAgentTimeline([], []));
    applyEnvelopes(NO_ENVELOPES);
    void refreshCapabilities();
  }, [active, applyEnvelopes, applyVm, paneId, refreshCapabilities]);

  // A Claude/Codex chat registers its protocol session a moment after the pane spawns. An early
  // lookup fails like "no chat for this pane", so keep retrying instead of staying terminal-only.
  const capabilityRetries = useRef(0);
  const [retryTick, setRetryTick] = useState(0);
  useEffect(() => {
    capabilityRetries.current = 0;
  }, [paneId]);
  useEffect(() => {
    if (demoSession || !paneId || !active || source !== 'native_tui') return;
    if (!isTauriRuntime() || !isProtocolChatAgent(agentType)) return;
    if (capabilityRetries.current >= MAX_CAPABILITY_RETRIES) return;
    const timer = window.setTimeout(() => {
      capabilityRetries.current += 1;
      void refreshCapabilities().finally(() => setRetryTick((tick) => tick + 1));
    }, CAPABILITY_RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [active, agentType, demoSession, paneId, refreshCapabilities, retryTick, source]);

  useEffect(() => {
    if (demoSession || !paneId || !active || source !== 'protocol') return;
    let unlisten: (() => void) | null = null;
    void subscribeAgentEvents((envelope: AgentEventEnvelope) => {
      if (envelope.pane_id !== paneId) return;
      const next = mergeAgentEventEnvelopes(vmRef.current, [envelope]);
      applyVm(next);
      applyEnvelopes(mergeEnvelopeLog(envelopesRef.current, [envelope]));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [active, applyEnvelopes, applyVm, demoSession, paneId, source]);

  useEffect(() => {
    if (source !== 'opencode_fallback' || !paneId || !active) return;
    const fallbackEnvelopes = opencodeViewToEnvelopes(paneId, opencode.view, opencode.permissions);
    applyVm(reduceAgentTimeline([], fallbackEnvelopes));
  }, [active, applyVm, opencode.permissions, opencode.view, paneId, source]);

  const timelineWithEnvelopes = useMemo<SessionTimeline>(
    () => (source === 'protocol' && envelopes.length > 0 ? { ...timeline, envelopes } : timeline),
    [envelopes, source, timeline],
  );

  const expectsProtocolChat =
    !demoSession && Boolean(paneId) && active && isTauriRuntime() && isProtocolChatAgent(agentType);
  const connecting =
    expectsProtocolChat && source === 'native_tui' && capabilityRetries.current < MAX_CAPABILITY_RETRIES;
  const connectFailed =
    expectsProtocolChat && source === 'native_tui' && capabilityRetries.current >= MAX_CAPABILITY_RETRIES;
  const retryConnect = useCallback(() => {
    capabilityRetries.current = 0;
    setRetryTick((tick) => tick + 1);
    void refreshCapabilities();
  }, [refreshCapabilities]);

  return {
    connecting,
    connectFailed,
    retryConnect,
    capabilities,
    source,
    timeline: timelineWithEnvelopes,
    envelopes,
    loading,
    error: error ?? opencode.error,
    refreshing: opencode.refreshing,
    refresh: source === 'opencode_fallback' ? opencode.refresh : refreshCapabilities,
  };
}
