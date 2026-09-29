import { MainLauncher } from '../shell/MainLauncher';
import { useEditor } from '../../lib/editor/EditorContext';
import { EditorTabsBar } from './EditorTabsBar';
import { MonacoEditorPane } from './MonacoEditorPane';
import { ConflictBanner } from './ConflictBanner';
import { QuickOpen } from './QuickOpen';
import { ReviewPanel } from '../review/ReviewPanel';

export function EditorWorkspace({
  launcherProps,
}: {
  launcherProps: {
    onNewAgent: () => void;
    onTogglePanel: () => void;
    onSearchFiles: () => void;
    onCommandPalette: () => void;
  };
}) {
  const editor = useEditor();
  const active = editor.tabs.find((t) => t.id === editor.activeTabId) ?? null;

  const showLauncher = editor.mainView === 'launcher' && editor.tabs.length === 0;

  return (
    <div className="flex flex-col flex-1 min-h-0 relative" data-testid="editor-workspace">
      <EditorTabsBar
        tabs={editor.tabs}
        activeTabId={editor.activeTabId}
        onSelect={editor.setActiveTab}
        onClose={(id) => {
          if (!editor.closeTab(id)) {
            const ok = window.confirm('Discard unsaved changes?');
            if (ok) editor.closeTab(id, true);
          }
        }}
        onDoubleClick={(id) => {
          editor.setActiveTab(id);
          editor.pinActiveTab();
        }}
      />
      <ConflictBanner
        state={editor.conflict}
        onCompare={editor.conflictCompare}
        onKeepMine={editor.conflictKeepMine}
        onReload={() => void editor.conflictReload()}
      />
      <div className="flex-1 min-h-0 relative flex flex-col">
        {editor.mainView === 'review' ? (
          <ReviewPanel onClose={() => editor.setMainView(editor.tabs.length ? 'editor' : 'launcher')} />
        ) : showLauncher ? (
          <MainLauncher {...launcherProps} />
        ) : active ? (
          <MonacoEditorPane
            tab={active}
            revealLine={editor.pendingRevealLine}
            onChange={(v) => editor.updateContent(active.id, v)}
          />
        ) : (
          <MainLauncher {...launcherProps} />
        )}
        <QuickOpen />
      </div>
    </div>
  );
}
