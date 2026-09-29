/** Dedupes PTY echo when mobile mirror performs local echo (stub for desktop strip). */
export class MirrorEchoFilter {
  shouldSkipInbound(_data: Uint8Array): boolean {
    return false;
  }

  noteOutbound(_text: string): void {
    /* no-op */
  }
}
