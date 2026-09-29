import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { usePaneRegistry } from '../../hooks/usePaneRegistry';
import { useSelectedSession } from '../../lib/shell-data';
import { useEditor } from '../../lib/editor/EditorContext';
import { sessionDiff, vcsWorkingDiff, type DiffFile } from '../../lib/editor/opencode-file-actions';
import { configureMonacoWorkers } from '../../lib/editor/monaco-setup';
import { languageForPath } from '../../lib/editor/language';

const DiffEditor = lazy(async () => {
  configureMonacoWorkers();
  const mod = await import('@monaco-editor/react');
  return { default: mod.DiffEditor };
});

export function ReviewPanel({ onClose }: { onClose: () => void }) {
  const registry = usePaneRegistry();
  const session = useSelectedSession();
  const editor = useEditor();
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [index, setIndex] = useState(0);
  const [inline, setInline] = useState(false);
  const diffHostRef = useRef<HTMLDivElement>(null);
  const [diffHeight, setDiffHeight] = useState(320);

  const paneId =
    session?.paneId ??
    registry.paneList.find((p) => p.info.agent_type === 'opencode_native')?.info.id ??
    null;

  useEffect(() => {
    configureMonacoWorkers();
    if (!paneId) {
      void vcsWorkingDiff('demo').then(setFiles).catch(() => setFiles([]));
      return;
    }
    void (async () => {
      try {
        if (session?.sessionId) {
          setFiles(await sessionDiff(paneId, session.sessionId));
        } else {
          setFiles(await vcsWorkingDiff(paneId));
        }
      } catch {
        setFiles(await vcsWorkingDiff('demo'));
      }
    })();
  }, [paneId, session?.sessionId]);

  useEffect(() => {
    const el = diffHostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDiffHeight(Math.max(120, el.clientHeight)));
    ro.observe(el);
    setDiffHeight(Math.max(120, el.clientHeight));
    return () => ro.disconnect();
  }, [files.length, index]);

  const current = files[index];

  return (
    <div className="flex flex-1 min-h-0 flex-col bg-canvas" data-testid="review-panel">
      <div className="h-7 flex items-center gap-2 px-3 border-b border-border-subtle bg-surface text-section-label text-text-3">
        <span>Review</span>
        <button type="button" className="ml-2 text-meta normal-case hover:text-text" onClick={() => setInline((v) => !v)}>
          {inline ? 'Inline' : 'Side by side'}
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            disabled={index <= 0}
            className="p-1 rounded hover:bg-hover disabled:opacity-40"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-meta normal-case text-text-2">
            {files.length ? `${index + 1}/${files.length}` : '0/0'}
          </span>
          <button
            type="button"
            disabled={index >= files.length - 1}
            className="p-1 rounded hover:bg-hover disabled:opacity-40"
            onClick={() => setIndex((i) => Math.min(files.length - 1, i + 1))}
          >
            <ChevronRight size={14} />
          </button>
          {current && (
            <button
              type="button"
              className="ml-2 text-meta normal-case text-accent hover:underline"
              onClick={() => void editor.openFile(current.path)}
            >
              Open file
            </button>
          )}
          <button type="button" className="ml-2 text-meta normal-case hover:text-text" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <div ref={diffHostRef} className="flex-1 min-h-0" data-testid="monaco-diff-host">
        {current ? (
          <Suspense fallback={<div className="p-4 text-meta text-text-3">Loading diff…</div>}>
            <div data-testid="monaco-diff-editor" className="h-full min-h-[120px]">
              <DiffEditor
                height={diffHeight}
                theme="loomria-dark"
                language={languageForPath(current.path)}
                original={current.before ?? ''}
                modified={current.after ?? ''}
                options={{ renderSideBySide: !inline, readOnly: true, minimap: { enabled: false } }}
              />
            </div>
          </Suspense>
        ) : (
          <p className="p-4 text-meta text-text-3">No changes to review.</p>
        )}
      </div>
    </div>
  );
}
