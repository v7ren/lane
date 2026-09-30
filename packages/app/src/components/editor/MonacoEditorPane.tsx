import { lazy, Suspense, useEffect, useRef } from 'react';
import { configureMonacoWorkers } from '../../lib/editor/monaco-setup';
import { languageForPath } from '../../lib/editor/language';
import { dispatchAddToComposer } from '../../lib/editor/add-to-composer';
import { shouldApplyExternalContent } from '../../lib/editor/content-sync';
import type { EditorTab } from '../../lib/editor/tabs';
import type * as Monaco from 'monaco-editor';

const MonacoEditor = lazy(async () => {
  configureMonacoWorkers();
  const mod = await import('@monaco-editor/react');
  return { default: mod.default };
});

export function MonacoEditorPane({
  tab,
  revealLine,
  onChange,
}: {
  tab: EditorTab;
  revealLine?: number | null;
  onChange: (value: string) => void;
}) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const appliedRevisionRef = useRef(tab.revision ?? 0);

  useEffect(() => {
    configureMonacoWorkers();
  }, []);

  // Uncontrolled after mount: only content replaced from outside (disk reload) is pushed in.
  useEffect(() => {
    const editor = editorRef.current;
    const revision = tab.revision ?? 0;
    if (!editor) return;
    if (
      shouldApplyExternalContent({
        revision,
        appliedRevision: appliedRevisionRef.current,
        tabContent: tab.content,
        editorValue: editor.getValue(),
      })
    ) {
      editor.setValue(tab.content);
    }
    appliedRevisionRef.current = revision;
  }, [tab.revision, tab.content]);

  useEffect(() => {
    if (!revealLine || !editorRef.current) return;
    editorRef.current.revealLineInCenter(revealLine);
  }, [revealLine, tab.path]);

  return (
    <Suspense
      fallback={
        <div
          className="flex-1 flex items-center justify-center text-meta text-text-3"
          data-testid="monaco-editor-pane-loading"
        >
          Loading editor…
        </div>
      }
    >
      <div className="flex-1 min-h-0" data-testid="monaco-editor-pane">
      <MonacoEditor
        key={tab.id}
        height="100%"
        language={languageForPath(tab.path)}
        theme="loomria-dark"
        defaultValue={tab.content}
        onChange={(v) => onChange(v ?? '')}
        onMount={(ed) => {
          editorRef.current = ed;
          appliedRevisionRef.current = tab.revision ?? 0;
          if (revealLine) ed.revealLineInCenter(revealLine);
          ed.addAction({
            id: 'loomria-add-to-composer',
            label: 'Add selection to chat',
            contextMenuGroupId: '9_cutcopypaste',
            run: (editor) => {
              const model = editor.getModel();
              const range = editor.getSelection();
              if (!model || !range) return;
              const selection = model.getValueInRange(range);
              if (!selection.trim()) return;
              dispatchAddToComposer({ path: tab.path, selection });
            },
          });
        }}
        options={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: 13,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          padding: { top: 8 },
        }}
      />
      </div>
    </Suspense>
  );
}
