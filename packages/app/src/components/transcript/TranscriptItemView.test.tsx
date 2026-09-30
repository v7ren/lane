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
