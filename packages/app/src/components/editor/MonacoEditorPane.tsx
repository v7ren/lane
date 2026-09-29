import { lazy, Suspense, useEffect } from 'react';
import { configureMonacoWorkers } from '../../lib/editor/monaco-setup';
import { languageForPath } from '../../lib/editor/language';
import type { EditorTab } from '../../lib/editor/tabs';

const MonacoEditor = lazy(async () => {
  configureMonacoWorkers();
  const mod = await import('@monaco-editor/react');
  return { default: mod.default };
});

export function MonacoEditorPane({
  tab,
  onChange,
}: {
  tab: EditorTab;
  onChange: (value: string) => void;
}) {
  useEffect(() => {
    configureMonacoWorkers();
  }, []);

  return (
    <Suspense
      fallback={<div className="flex-1 flex items-center justify-center text-meta text-text-3">Loading editor…</div>}
    >
      <MonacoEditor
        height="100%"
        language={languageForPath(tab.path)}
        theme="loomria-dark"
        value={tab.content}
        onChange={(v) => onChange(v ?? '')}
        options={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: 13,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          padding: { top: 8 },
        }}
      />
    </Suspense>
  );
}
