import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { InputBatcher } from './input-batcher';
import { configureDesktopXtermTextarea, isTerminalPasteShortcut } from './xterm-textarea';
import { isSafeHttpUrl } from '../lib/safe-agent-text';
import { tauri } from '../lib/tauri';
import {
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_SCROLLBACK,
  terminalThemeFromCss,
} from './theme';
import type { PaneDataListener, TerminalSessionOptions } from './types';
import { shouldNotifyPtyResize } from './terminal-fit.js';
import '@xterm/xterm/css/xterm.css';

function isWindowsRuntime(): boolean {
  return navigator.userAgent.includes('Windows');
}

function openExternalUrl(uri: string): void {
  if (!isSafeHttpUrl(uri)) {
    return;
  }
  void tauri.openExternalUrl(uri);
}

/**
 * Owns one xterm.js instance for a pane: raw PTY rendering, resize, input
 * batching, reattach replay, and StrictMode-safe deferred open.
 */
export class TerminalSession {
  private term: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private inputBatcher: InputBatcher | null = null;
  private unlistenData: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private imeObserver: MutationObserver | null = null;
  private focusCleanup: (() => void) | null = null;
  private pasteCleanup: (() => void) | null = null;
  private clipboardShortcutCleanup: (() => void) | null = null;
  private openFrame: number | null = null;
  private resizeFrame: number | null = null;
  private refreshFrame: number | null = null;
  private lastSentCols = 0;
  private lastSentRows = 0;
  private ptyCols: number;
  private ptyRows: number;
  private generation = 0;
  private themeObserver: MutationObserver | null = null;
  private mountContainer: HTMLElement | null = null;
  private disposed = false;

  constructor(private readonly options: TerminalSessionOptions) {
    this.ptyCols = options.ptyCols ?? 80;
    this.ptyRows = options.ptyRows ?? 24;
  }

  setPtyDimensions(cols: number, rows: number): void {
    if (cols <= 0 || rows <= 0) return;
    this.ptyCols = cols;
    this.ptyRows = rows;
    this.applyPtyDimensions();
  }

  /** Text currently on screen (the visible rows only, not scrollback). */
  readVisibleText(): string {
    if (!this.term) return '';
    const buffer = this.term.buffer.active;
    const lines: string[] = [];
    for (let row = 0; row < this.term.rows; row += 1) {
      lines.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '');
    }
    return lines.join('\n');
  }

  /** Returns true when the xterm instance is mounted and a reflow was scheduled. */
  nudgeReflow(): boolean {
    if (!this.term) return false;
    this.fitAndNotify();
    this.scheduleRefresh();
    return true;
  }

  /** Move the xterm wrapper into another in-flow host (or the park) without disposing. */
  reparent(target: HTMLElement): void {
    const wrapper = this.mountContainer;
    if (!wrapper || this.disposed) return;
    if (wrapper.parentElement === target) {
      if (this.hostHasLayout()) this.scheduleFit();
      return;
    }
    target.appendChild(wrapper);
    if (this.hostHasLayout()) {
      requestAnimationFrame(() => {
        if (this.disposed) return;
        this.fitAndNotify();
        this.scheduleRefresh();
      });
    }
  }

  /** @internal tests — stable xterm root element across reparents */
  getTerminalElement(): HTMLElement | undefined {
    return this.term?.element;
  }

  mount(
    container: HTMLElement,
    subscribePaneData: (paneId: string, cb: PaneDataListener) => () => void,
  ): void {
    const gen = ++this.generation;
    this.disposed = false;
    this.mountContainer = container;

    this.openFrame = requestAnimationFrame(() => {
      this.openFrame = null;
      if (this.disposed || gen !== this.generation || !container.isConnected) {
        return;
      }

      const terminal = new Terminal({
        theme: terminalThemeFromCss(),
        fontFamily: TERMINAL_FONT_FAMILY,
        fontSize: TERMINAL_FONT_SIZE,
        scrollback: TERMINAL_SCROLLBACK,
        cursorBlink: true,
        convertEol: false,
        allowProposedApi: true,
        allowTransparency: false,
        scrollOnUserInput: true,
        disableStdin: false,
        windowsPty: isWindowsRuntime()
          ? {
              backend: 'conpty',
            }
          : undefined,
      });

      const fitAddon = new FitAddon();
      const unicode11Addon = new Unicode11Addon();
      const webLinksAddon = new WebLinksAddon((_event, uri) => {
        openExternalUrl(uri);
      });

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(webLinksAddon);
      terminal.loadAddon(unicode11Addon);
      terminal.unicode.activeVersion = '11';

      terminal.open(container);

      this.term = terminal;
      this.fitAddon = fitAddon;
      this.inputBatcher = new InputBatcher((text) => {
        this.options.onInput(text, false);
      }, 4);

      terminal.onData((data) => {
        this.inputBatcher?.push(data);
        this.scrollToCursor();
        this.scheduleRefresh();
      });

      this.unlistenData = subscribePaneData(this.options.paneId, (data) => {
        terminal.write(data, () => {
          this.scrollToCursor();
          this.scheduleRefresh();
        });
      });
      this.installFileLinkProvider(terminal);
      this.installTextareaGuards(container, terminal, this.inputBatcher);
      this.installResizeObservers(container);
      this.installFocusHandlers(container);
      this.installThemeObserver(terminal);
      this.fitAndNotify();
      requestAnimationFrame(() => {
        if (this.disposed || gen !== this.generation) return;
        this.fitAndNotify();
      });
      this.scheduleRefresh();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;

    if (this.openFrame !== null) {
      cancelAnimationFrame(this.openFrame);
      this.openFrame = null;
    }
    if (this.resizeFrame !== null) {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = null;
    }
    if (this.refreshFrame !== null) {
      cancelAnimationFrame(this.refreshFrame);
      this.refreshFrame = null;
    }
    this.unlistenData?.();
    this.unlistenData = null;

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;

    this.imeObserver?.disconnect();
    this.imeObserver = null;

    this.mountContainer = null;

    this.themeObserver?.disconnect();
    this.themeObserver = null;

    this.focusCleanup?.();
    this.focusCleanup = null;

    this.pasteCleanup?.();
    this.pasteCleanup = null;

    this.clipboardShortcutCleanup?.();
    this.clipboardShortcutCleanup = null;

    this.inputBatcher?.dispose();
    this.inputBatcher = null;

    this.fitAddon = null;
    this.term?.dispose();
    this.term = null;
  }

  private hostHasLayout(): boolean {
    const container = this.mountContainer;
    if (!container) return false;
    const rect = container.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  private installResizeObservers(container: HTMLElement): void {
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.hostHasLayout()) return;
      this.scheduleFit();
    });
    this.resizeObserver.observe(container);

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          window.setTimeout(() => {
            if (!this.hostHasLayout()) return;
            this.fitAndNotify();
            this.scheduleRefresh();
          }, 50);
        }
      },
      { threshold: 0.1 },
    );
    this.intersectionObserver.observe(container);
  }

  private installThemeObserver(terminal: Terminal): void {
    const applyTheme = () => {
      terminal.options.theme = terminalThemeFromCss();
      this.scheduleRefresh();
    };
    this.themeObserver = new MutationObserver(applyTheme);
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }

  private installPasteFallback(
    container: HTMLElement,
    terminal: Terminal,
  ): void {
    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text/plain');
      if (!text) return;

      event.preventDefault();
      event.stopPropagation();
      terminal.focus();
      this.inputBatcher?.flushNow();
      terminal.paste(text);
      this.scrollToCursor();
      this.scheduleRefresh();
    };

    container.addEventListener('paste', onPaste, true);
    this.pasteCleanup = () => {
      container.removeEventListener('paste', onPaste, true);
    };
  }

  private installClipboardShortcutFallback(
    container: HTMLElement,
    terminal: Terminal,
  ): void {
    const pasteFromClipboard = async (event: KeyboardEvent) => {
      if (!isTerminalPasteShortcut(event)) return;
      const clipboard = navigator.clipboard;
      if (!clipboard?.readText) return;

      event.preventDefault();
      event.stopPropagation();

      let text = '';
      try {
        text = await clipboard.readText();
      } catch {
        return;
      }
      if (!text || this.disposed) return;

      terminal.focus();
      this.inputBatcher?.flushNow();
      terminal.paste(text);
      this.scrollToCursor();
      this.scheduleRefresh();
    };

    container.addEventListener('keydown', pasteFromClipboard, true);
    this.clipboardShortcutCleanup = () => {
      container.removeEventListener('keydown', pasteFromClipboard, true);
    };
  }

  private installFocusHandlers(container: HTMLElement): void {
    const focusTerminal = () => {
      this.term?.focus();
    };
    container.addEventListener('pointerdown', focusTerminal);
    this.focusCleanup = () => {
      container.removeEventListener('pointerdown', focusTerminal);
    };
  }

  private installTextareaGuards(
    container: HTMLElement,
    terminal: Terminal,
    inputBatcher: InputBatcher,
  ): void {
    const textarea = container.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null;

    const fixImePosition = () => {
      if (!textarea) return;
      configureDesktopXtermTextarea(container, textarea);
    };

    if (textarea) {
      this.imeObserver = new MutationObserver(fixImePosition);
      this.imeObserver.observe(textarea, { attributes: true, attributeFilter: ['style'] });
    }
    fixImePosition();
    this.installPasteFallback(container, terminal);
    this.installClipboardShortcutFallback(container, terminal);
    void inputBatcher;
  }

  private scrollToCursor(): void {
    const terminal = this.term;
    if (!terminal) return;
    terminal.scrollToBottom();
  }

  private installFileLinkProvider(terminal: Terminal): void {
    terminal.registerLinkProvider({
      provideLinks(bufferLineNumber, callback) {
        const line = terminal.buffer.active.getLine(bufferLineNumber - 1);
        if (!line) {
          callback(undefined);
          return;
        }

        const text = line.translateToString();
        const fileUrlRegex = /file:\/\/\/[^\s'"\])}>,;`]+/g;
        const links = [];
        let match: RegExpExecArray | null;
        while ((match = fileUrlRegex.exec(text)) !== null) {
          const url = match[0];
          links.push({
            text: url,
            range: {
              start: { x: match.index + 1, y: bufferLineNumber },
              end: { x: match.index + url.length, y: bufferLineNumber },
            },
            activate() {
              openExternalUrl(url);
            },
          });
        }
        callback(links.length > 0 ? links : undefined);
      },
    });
  }

  private scheduleFit(): void {
    if (this.resizeFrame !== null) return;
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = null;
      this.fitAndNotify();
      this.scheduleRefresh();
    });
  }

  private fitAndNotify(): void {
    const terminal = this.term;
    const fitAddon = this.fitAddon;
    if (!terminal || !fitAddon || !this.hostHasLayout()) return;

    try {
      fitAddon.fit();
    } catch {
      return;
    }

    const { cols, rows } = terminal;
    if (!shouldNotifyPtyResize(this.lastSentCols, this.lastSentRows, cols, rows)) {
      return;
    }
    this.lastSentCols = cols;
    this.lastSentRows = rows;
    this.options.onResize(cols, rows);
    if (typeof window !== 'undefined') {
      const w = window as Window & {
        __loomriaPtyResizeLog?: { count: number; events: { cols: number; rows: number; t: number }[] };
      };
      const log = (w.__loomriaPtyResizeLog ??= { count: 0, events: [] });
      log.count += 1;
      log.events.push({ cols, rows, t: Date.now() });
    }
  }

  private applyPtyDimensions(): void {
    const terminal = this.term;
    if (!terminal) return;
    const { ptyCols: cols, ptyRows: rows } = this;
    if (cols > 0 && rows > 0 && (cols !== terminal.cols || rows !== terminal.rows)) {
      terminal.resize(cols, rows);
      terminal.scrollToBottom();
      this.scheduleRefresh();
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshFrame !== null) return;
    this.refreshFrame = requestAnimationFrame(() => {
      this.refreshFrame = null;
      const terminal = this.term;
      if (!terminal) return;
      terminal.clearTextureAtlas();
      terminal.refresh(0, Math.max(0, terminal.rows - 1));
    });
  }

}
