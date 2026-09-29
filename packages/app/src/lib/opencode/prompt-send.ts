/** Client-generated OpenCode message id for idempotent prompt_async submits. */
export function createPromptMessageId(): string {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `msg_${suffix}`;
}
