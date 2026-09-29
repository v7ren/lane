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
