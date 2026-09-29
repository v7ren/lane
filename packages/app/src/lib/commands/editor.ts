export type CommandRegistry = {
  register(cmd: {
    id: string;
    title: string;
    group: string;
    keybinding?: string;
    run: () => void | Promise<void>;
  }): void;
};

export function registerEditorCommands(
  registry: CommandRegistry,
  handlers: {
    onQuickOpen: () => void;
    onSearchPanel: () => void;
    onReview: () => void;
    onSave: () => void;
    onCloseTab: () => void;
  },
): void {
  registry.register({
    id: 'editor.quickOpen',
    title: 'Quick Open File',
    group: 'Editor',
    keybinding: 'Ctrl+P',
    run: handlers.onQuickOpen,
  });
  registry.register({
    id: 'editor.search',
    title: 'Search in Files',
    group: 'Editor',
    keybinding: 'Ctrl+Shift+F',
    run: handlers.onSearchPanel,
  });
  registry.register({
    id: 'editor.review',
    title: 'Review Changes',
    group: 'Editor',
    run: handlers.onReview,
  });
  registry.register({
    id: 'editor.save',
    title: 'Save File',
    group: 'Editor',
    keybinding: 'Ctrl+S',
    run: handlers.onSave,
  });
  registry.register({
    id: 'editor.closeTab',
    title: 'Close Editor Tab',
    group: 'Editor',
    keybinding: 'Ctrl+W',
    run: handlers.onCloseTab,
  });
}
