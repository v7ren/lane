import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TranscriptToolCall } from '../../lib/transcript';
import { TranscriptItemView } from './TranscriptItemView';

const readTool: TranscriptToolCall = {
  kind: 'tool_call',
  id: 'oc-read-1',
  name: 'read',
  title: 'C:\\Users\\Ren-pc\\Desktop\\work2\\loomria-p5\\packages\\app\\src\\main.ts',
  status: 'completed',
  input: {
    filePath: 'C:/Users/Ren-pc/Desktop/work2/loomria-p5/packages/app/src/main.ts',
  },
  output: null,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const globTool: TranscriptToolCall = {
  kind: 'tool_call',
  id: 'oc-glob-1',
  name: 'glob',
  status: 'completed',
  input: '**/hello.txt',
  output: { matches: ['hello.txt'], count: 1 },
};

describe('TranscriptItemView read tool', () => {
  it('renders Read label and relative path chip for OpenCode-shaped input', () => {
    act(() => {
      root.render(
        <TranscriptItemView
          item={readTool}
          projectRoot="C:/Users/Ren-pc/Desktop/work2/loomria-p5"
        />,
      );
    });
    expect(container.textContent).toContain('Read');
    expect(container.textContent).toContain('packages/app/src/main.ts');
    expect(container.textContent).not.toContain('filePath');
    expect(container.textContent).not.toContain('\\\\Users');
  });
});

describe('TranscriptItemView glob tool', () => {
  it('renders unescaped relative paths', () => {
    act(() => {
      root.render(
        <TranscriptItemView
          item={{
            ...globTool,
            output: ['C:\\\\Users\\\\Ren\\\\repo\\\\hello.txt'],
          }}
          projectRoot="C:/Users/Ren/repo"
        />,
      );
    });
    expect(container.textContent).toContain('hello.txt');
    expect(container.textContent).not.toContain('\\\\Users');
  });

  it('shows pattern and zero count for empty glob output without JSON fallback', () => {
    act(() => {
      root.render(
        <TranscriptItemView
          item={{
            ...globTool,
            output: { matches: [], count: 0 },
          }}
        />,
      );
    });
    expect(container.querySelector('[data-testid="part-fallback"]')).toBeNull();
    expect(container.textContent).not.toContain('{"');
    expect(container.querySelector('[data-testid="tool-glob-pattern"]')?.textContent).toBe(
      '**/hello.txt',
    );
    expect(container.querySelector('[data-testid="tool-glob-count"]')?.textContent).toBe('0 files');
  });
});

describe('TranscriptItemView part types', () => {
  it('renders patch paths without raw JSON', () => {
    act(() => {
      root.render(
        <TranscriptItemView
          item={{
            kind: 'patch',
            id: 'p1',
            paths: ['src/a.ts', 'src/b.ts'],
          }}
        />,
      );
    });
    expect(container.querySelector('[data-testid="transcript-patch"]')).not.toBeNull();
    const paths = container.querySelectorAll('[data-testid="transcript-patch-path"]');
    expect(paths.length).toBe(2);
    expect(container.textContent).toContain('src/a.ts');
    expect(container.textContent).not.toContain('{"');
  });

  it('renders retry with attempt and API error message', () => {
    act(() => {
      root.render(
        <TranscriptItemView
          item={{
            kind: 'retry',
            id: 'r1',
            attempt: 2,
            message: 'upstream timeout',
          }}
        />,
      );
    });
    const el = container.querySelector('[data-testid="transcript-retry"]');
    expect(el?.textContent).toContain('Retry attempt 2');
    expect(el?.textContent).toContain('upstream timeout');
  });

  it('renders error with status class', () => {
    act(() => {
      root.render(
        <TranscriptItemView
          item={{
            kind: 'error',
            id: 'e1',
            message: 'Something failed',
          }}
        />,
      );
    });
    const el = container.querySelector('[data-testid="transcript-error"]');
    expect(el?.textContent).toContain('Something failed');
    expect(el?.className).toContain('text-status-error');
  });

  it('renders file attachment chip with filename', () => {
    act(() => {
      root.render(
        <TranscriptItemView
          item={{
            kind: 'file',
            id: 'f1',
            filename: 'notes.md',
            mime: 'text/markdown',
            url: 'https://example.test/notes.md',
          }}
        />,
      );
    });
    expect(container.querySelector('[data-testid="transcript-file"]')).not.toBeNull();
    expect(container.textContent).toContain('notes.md');
  });

  it('renders compaction divider text', () => {
    act(() => {
      root.render(
        <TranscriptItemView
          item={{
            kind: 'compaction',
            id: 'c1',
            auto: true,
          }}
        />,
      );
    });
    const el = container.querySelector('[data-testid="transcript-compaction"]');
    expect(el?.textContent?.trim()).toBe('Context compacted');
  });
});
