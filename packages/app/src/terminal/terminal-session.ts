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
import {
  layoutDeltaBelowOneCell,
  shouldNotifyPtyResize,
  TERMINAL_SCROLLBAR_GUTTER_PX,
} from './terminal-fit.js';
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
  private ptyNotifyTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPtyCols = 0;
  private pendingPtyRows = 0;
  private lastSentCols = 0;
  private lastSentRows = 0;
  private ptyCols: number;
  private ptyRows: number;
  private generation = 0;
  private themeObserver: MutationObserver | null = null;
  private agentTuiLayoutObserver: MutationObserver | null = null;
  private mountContainer: HTMLElement | null = null;
  private fitRegion: HTMLElement | null = null;
  private lastObservedWidth = 0;
  private lastObservedHeight = 0;
  private surfaceHost: HTMLElement | null = null;
  private surfaceVisibilityObserver: MutationObserver | null = null;
  private surfaceWasActive = false;
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

  /** Returns true when the xterm instance is mounted and a reflow was scheduled. */
  nudgeReflow(): boolean {
    if (!this.term) return false;
    this.fitAndNotify();
    this.refreshAndNudgeAltBuffer();
    return true;
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
      this.installSurfaceVisibilityObserver(container);
      this.installAgentTuiLayoutObserver(container);
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
    if (this.ptyNotifyTimer !== null) {
      clearTimeout(this.ptyNotifyTimer);
      this.ptyNotifyTimer = null;
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

    this.agentTuiLayoutObserver?.disconnect();
    this.agentTuiLayoutObserver = null;

    this.surfaceVisibilityObserver?.disconnect();
    this.surfaceVisibilityObserver = null;
    this.surfaceHost = null;

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

  private surfaceIsActive(): boolean {
    const host = this.surfaceHost ?? this.mountContainer?.closest('[data-pane-surface-host]');
    if (host instanceof HTMLElement) {
      return host.getAttribute('data-pane-surface-host') === '1';
    }
    return true;
  }

  private hostHasLayout(): boolean {
    const region = this.fitRegion ?? this.mountContainer;
    if (!region) return false;
    const rect = region.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  private fitRegionSize(): { width: number; height: number } | null {
    const region = this.fitRegion ?? this.mountContainer;
    if (!region) return null;
    const rect = region.getBoundingClientRect();
    const width = Math.max(0, rect.width - TERMINAL_SCROLLBAR_GUTTER_PX);
    const height = rect.height;
    if (width <= 0 || height <= 0) return null;
    return { width, height };
  }

  private installSurfaceVisibilityObserver(container: HTMLElement): void {
    const host = container.closest('[data-pane-surface-host]');
    if (!(host instanceof HTMLElement)) return;
    this.surfaceHost = host;

    const refit = () => {
      if (!this.surfaceIsActive() || !this.hostHasLayout()) return;
      this.scheduleFit();
    };

    this.surfaceVisibilityObserver = new MutationObserver(refit);
    this.surfaceVisibilityObserver.observe(host, {
      attributes: true,
      attributeFilter: ['data-pane-surface-host', 'data-surface-visible'],
    });
    refit();
  }

  private installResizeObservers(container: HTMLElement): void {
    const region =
      container.closest('[data-terminal-fit-region]') ??
      container.parentElement ??
      container;
    this.fitRegion = region instanceof HTMLElement ? region : container;

    this.resizeObserver = new ResizeObserver(() => {
      if (!this.surfaceIsActive() || !this.hostHasLayout()) return;
      const size = this.fitRegionSize();
      if (!size) return;
      const cellW = this.term?.options.fontSize ?? TERMINAL_FONT_SIZE;
      const cellH = (this.term?.options.fontSize ?? TERMINAL_FONT_SIZE) * 1.2;
      if (
        this.lastObservedWidth > 0 &&
        layoutDeltaBelowOneCell(
          this.lastObservedWidth,
          this.lastObservedHeight,
          size.width,
          size.height,
          cellW,
          cellH,
        )
      ) {
        return;
      }
      this.lastObservedWidth = size.width;
      this.lastObservedHeight = size.height;
      this.scheduleFit();
    });
    this.resizeObserver.observe(this.fitRegion);

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          window.setTimeout(() => {
            this.fitAndNotify();
            this.scheduleRefresh();
          }, 50);
        }
      },
      { threshold: 0.1 },
    );
    this.intersectionObserver.observe(this.fitRegion);
  }

  /** Refit when Agent Mode moves the pane surface out of the parked off-screen slot. */
  private installAgentTuiLayoutObserver(container: HTMLElement): void {
    const layoutRoot = container.closest('[data-agent-tui-layout]');
    if (!layoutRoot) return;

    const refitIfOpen = () => {
      if (layoutRoot.getAttribute('data-agent-tui-layout') !== 'open') return;
      requestAnimationFrame(() => {
        if (this.disposed) return;
        this.scheduleFit();
      });
    };

    this.agentTuiLayoutObserver = new MutationObserver(refitIfOpen);
    this.agentTuiLayoutObserver.observe(layoutRoot, {
      attributes: true,
      attributeFilter: ['data-agent-tui-layout'],
    });
    refitIfOpen();
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
    if (!terminal || !fitAddon) return;
    const active = this.surfaceIsActive() && this.hostHasLayout();
    if (!active) {
      this.surfaceWasActive = false;
      return;
    }
    if (!this.surfaceWasActive) {
      this.lastSentCols = 0;
      this.lastSentRows = 0;
    }
    this.surfaceWasActive = true;

    try {
      fitAddon.fit();
    } catch {
      return;
    }

    const { cols, rows } = terminal;
    this.pendingPtyCols = cols;
    this.pendingPtyRows = rows;
    if (this.ptyNotifyTimer !== null) {
      clearTimeout(this.ptyNotifyTimer);
    }
    this.ptyNotifyTimer = setTimeout(() => {
      this.ptyNotifyTimer = null;
      const nextCols = this.pendingPtyCols;
      const nextRows = this.pendingPtyRows;
      if (!shouldNotifyPtyResize(this.lastSentCols, this.lastSentRows, nextCols, nextRows)) {
        return;
      }
      this.lastSentCols = nextCols;
      this.lastSentRows = nextRows;
      this.options.onResize(nextCols, nextRows);
      if (typeof window !== 'undefined') {
        const w = window as Window & {
          __loomriaPtyResizeLog?: { count: number; events: { cols: number; rows: number; t: number }[] };
        };
        const log = (w.__loomriaPtyResizeLog ??= { count: 0, events: [] });
        log.count += 1;
        log.events.push({ cols: nextCols, rows: nextRows, t: Date.now() });
      }
    }, 180);
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

  private refreshAndNudgeAltBuffer(): void {
    this.scheduleRefresh();
  }
}
