import type { Capabilities } from './agent-events';
import { capabilitiesNativeTuiOnly } from './agent-events';
import { isSessionCommandMissing } from './agent-session';
import { opencodeCapabilities } from './opencode-agent-adapter';

export type AgentSessionSource = 'protocol' | 'opencode_fallback' | 'native_tui';

export type AgentSessionCapabilitiesResolution = {
  source: AgentSessionSource;
  capabilities: Capabilities;
  error: string | null;
};

/** Maps session_capabilities / session_history failures to GUI data source. */
export function resolveAgentSessionOnCapabilitiesError(
  err: unknown,
  agentType?: string | null,
): AgentSessionCapabilitiesResolution {
  if (isSessionCommandMissing(err) && agentType === 'opencode_native') {
    return {
      source: 'opencode_fallback',
      capabilities: opencodeCapabilities(),
      error: null,
    };
  }
  if (isSessionCommandMissing(err)) {
    return {
      source: 'native_tui',
      capabilities: capabilitiesNativeTuiOnly(),
      error: null,
    };
  }
  if (agentType === 'opencode_native') {
    console.warn('[agent-session] capabilities failed, using opencode fallback', err);
    return {
      source: 'opencode_fallback',
      capabilities: opencodeCapabilities(),
      error: null,
    };
  }
  return {
    source: 'native_tui',
    capabilities: capabilitiesNativeTuiOnly(),
    error: String(err),
  };
}
