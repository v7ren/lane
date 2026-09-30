export type FileEditedListener = (paths: string[]) => void;

const listeners = new Set<FileEditedListener>();

/** Extract edited file paths from an OpenCode `file.edited` event's properties. */
export function fileEditedPathsFromProps(props: Record<string, unknown>): string[] {
  const out: string[] = [];
  const files = props.files;
  if (Array.isArray(files)) {
    for (const f of files) if (typeof f === 'string' && f) out.push(f);
  }
  const file = props.file;
  if (typeof file === 'string' && file) out.push(file);
  return out;
}

export function emitFileEdited(paths: string[]): void {
  if (paths.length === 0) return;
  for (const l of [...listeners]) l(paths);
}

export function subscribeFileEdited(listener: FileEditedListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
