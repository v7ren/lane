import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TranscriptViewModel } from '../../lib/transcript';
import { TranscriptView } from '../transcript/TranscriptView';

const payload = "I'll & <b>x</b>";

const vm: TranscriptViewModel = {
  turns: [
    {
      id: 'a1',
      role: 'assistant',
      items: [
        {
          kind: 'assistant_text',
          id: 't1',
          markdown: payload,
        },
      ],
    },
  ],
  flatItems: [],
  sessionBusy: false,
  turnActive: false,
  globalFilePaths: [],
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

describe('TranscriptView', () => {
  it('renders assistant markdown literally without HTML injection', () => {
    act(() => {
      root.render(<TranscriptView vm={vm} nativeTuiOnly={false} />);
    });

    expect(container.textContent).toContain(payload);
    expect(container.textContent).not.toContain('&#39;');
    expect(container.querySelector('b')).toBeNull();
  });
});
