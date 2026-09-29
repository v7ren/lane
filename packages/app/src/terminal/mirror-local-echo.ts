import type { Terminal } from '@xterm/xterm';
import type { MirrorEchoFilter } from './mirror-echo-filter';

export function applyMirrorLocalEcho(terminal: Terminal, text: string, filter: MirrorEchoFilter): void {
  if (!text) return;
  filter.noteOutbound(text);
  terminal.write(text);
}
