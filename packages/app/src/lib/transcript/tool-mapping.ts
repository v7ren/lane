import type { ToolCallStatus, TranscriptToolCall } from './types.js';

export function mapOpenCodeToolStatus(status: string | undefined): ToolCallStatus {
  if (!status) return 'running';
  const lower = status.toLowerCase();
  if (lower === 'pending' || lower === 'waiting') return 'pending';
  if (lower === 'running') return 'running';
  if (lower === 'completed' || lower === 'done' || lower === 'success') return 'completed';
  if (lower.includes('error') || lower.includes('fail')) return 'error';
  return 'running';
}

export function mapAgentToolStatus(status?: 'pending' | 'running' | 'ok' | 'error'): ToolCallStatus {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'running':
      return 'running';
    case 'ok':
      return 'completed';
    case 'error':
      return 'error';
    default:
      return 'running';
  }
}

export function toolNameForDisplay(name: string): string {
  return name.replace(/_/g, ' ');
}

/** Normalize tool part state into structured input/output for UI renderers. */
export function normalizeToolPayload(
  toolName: string,
  input: unknown,
  output: unknown,
): Pick<TranscriptToolCall, 'input' | 'output' | 'diff'> {
  const name = toolName.toLowerCase();
  if (typeof input === 'string' && typeof output === 'string') {
    return { input, output };
  }
  const stateIn = input as Record<string, unknown> | undefined;
  const stateOut = output as Record<string, unknown> | undefined;
  if (name === 'bash' || name === 'shell') {
    return {
      input: stateIn?.command ?? stateIn?.input ?? input,
      output: stateOut?.output ?? stateOut?.stdout ?? output,
    };
  }
  if (name === 'read' || name === 'read_file') {
    return {
      input: {
        path: stateIn?.path ?? stateIn?.file ?? input,
        start: stateIn?.startLine ?? stateIn?.start,
        end: stateIn?.endLine ?? stateIn?.end,
      },
      output,
    };
  }
  if (name === 'write' || name === 'edit' || name === 'apply_patch') {
    const diff =
      (typeof stateOut?.diff === 'string' ? stateOut.diff : undefined) ??
      (typeof stateIn?.diff === 'string' ? stateIn.diff : undefined);
    return {
      input: {
        path: stateIn?.path ?? stateIn?.file ?? stateIn?.target,
        content: stateIn?.content,
      },
      output: stateOut?.output ?? output,
      diff,
    };
  }
  if (name === 'grep' || name === 'glob') {
    return {
      input: stateIn?.pattern ?? stateIn?.glob ?? input,
      output: stateOut?.matches ?? stateOut?.count ?? output,
    };
  }
  if (name === 'webfetch' || name === 'web_fetch') {
    return {
      input: stateIn?.url ?? input,
      output,
    };
  }
  return { input, output };
}
