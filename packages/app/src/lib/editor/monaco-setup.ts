import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

let configured = false;

export function configureMonacoWorkers(): void {
  if (configured) return;
  configured = true;
  loader.config({ monaco });
  monaco.editor.defineTheme('loomria-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#0B0B0C',
      'editor.foreground': '#FAFAFA',
      'editorLineNumber.foreground': '#71717A',
      'editor.selectionBackground': '#3B82F640',
      'editor.inactiveSelectionBackground': '#3B82F625',
    },
  });
}
