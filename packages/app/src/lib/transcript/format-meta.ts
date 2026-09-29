import type { AssistantMessageMeta } from './types.js';

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tokens`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K tokens`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K tokens`;
  return `${n} tokens`;
}

export function formatCostUsd(cost: number): string {
  if (cost >= 0.01) return `$${cost.toFixed(2)}`;
  if (cost >= 0.001) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(4)}`;
}

export function formatAssistantMetaLine(meta: AssistantMessageMeta): string | undefined {
  const parts: string[] = [];
  if (meta.agent) parts.push(capitalize(meta.agent));
  if (meta.model) parts.push(meta.model);
  if (meta.durationMs != null) parts.push(formatDuration(meta.durationMs));
  const totalTokens =
    (meta.inputTokens ?? 0) + (meta.outputTokens ?? 0) + (meta.reasoningTokens ?? 0);
  if (totalTokens > 0) parts.push(formatTokenCount(totalTokens));
  if (meta.costUsd != null) parts.push(formatCostUsd(meta.costUsd));
  return parts.length > 0 ? parts.join(' · ') : undefined;
}
