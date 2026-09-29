import type { CommandRegistry } from './index';

export type EditorCommandHandlers = {
  onQuickOpen: () => void;
  onSearchPanel: () => void;
  onReview: () => void;
  onSave: () => void;
  onCloseTab: () => void;
};

export function registerEditorCommands(
  registry: CommandRegistry,
  handlers: EditorCommandHandlers,
): void {
  registry.register({
    id: 'editor.quickOpen',
    label: 'Quick Open File',
    section: 'Editor',
    keywords: 'Ctrl+P',
    run: handlers.onQuickOpen,
  });
  registry.register({
    id: 'editor.search',
    label: 'Search in Files',
    section: 'Editor',
    keywords: 'Ctrl+Shift+F',
    run: handlers.onSearchPanel,
  });
  registry.register({
    id: 'editor.review',
    label: 'Review Changes',
    section: 'Editor',
    run: handlers.onReview,
  });
  registry.register({
    id: 'editor.save',
    label: 'Save File',
    section: 'Editor',
    keywords: 'Ctrl+S',
    run: handlers.onSave,
  });
  registry.register({
    id: 'editor.closeTab',
    label: 'Close Editor Tab',
    section: 'Editor',
    keywords: 'Ctrl+W',
    run: handlers.onCloseTab,
  });
}
