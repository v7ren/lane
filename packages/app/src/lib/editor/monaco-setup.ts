import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorkerUrl from '../../../../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker&url';
import jsonWorkerUrl from '../../../../../node_modules/monaco-editor/esm/vs/language/json/json.worker.js?worker&url';
import cssWorkerUrl from '../../../../../node_modules/monaco-editor/esm/vs/language/css/css.worker.js?worker&url';
import htmlWorkerUrl from '../../../../../node_modules/monaco-editor/esm/vs/language/html/html.worker.js?worker&url';
import tsWorkerUrl from '../../../../../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js?worker&url';

let configured = false;

function workerFromUrl(url: string): Worker {
  return new Worker(url, { type: 'module', name: url });
}

export function configureMonacoWorkers(): void {
  if (configured) return;
  configured = true;

  const env = globalThis as typeof globalThis & {
    MonacoEnvironment?: { getWorker: (_workerId: string, label: string) => Worker };
  };
  env.MonacoEnvironment = {
    getWorker(_workerId, label) {
      switch (label) {
        case 'json':
          return workerFromUrl(jsonWorkerUrl);
        case 'css':
        case 'scss':
        case 'less':
          return workerFromUrl(cssWorkerUrl);
        case 'html':
        case 'handlebars':
        case 'razor':
          return workerFromUrl(htmlWorkerUrl);
        case 'typescript':
        case 'javascript':
          return workerFromUrl(tsWorkerUrl);
        default:
          return workerFromUrl(editorWorkerUrl);
      }
    },
  };

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
