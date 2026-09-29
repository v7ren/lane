import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../../lib/transcript';
import { UserTurnRow } from './TurnRows';

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

describe('UserTurnRow', () => {
  it('shows single-line prompt with one chevron and > glyph', () => {
    const turn: TranscriptTurn = {
      id: 'u1',
      role: 'user',
      items: [
        {
          kind: 'user_prompt',
          id: 'u1',
          text: 'hi',
          files: [],
          collapsedDefault: true,
        },
      ],
    };
    act(() => {
      root.render(<UserTurnRow turn={turn} />);
    });
    const btn = container.querySelector('button[aria-expanded]');
    expect(btn?.textContent).toContain('>');
    expect(btn?.textContent).toContain('hi');
    expect((btn?.textContent?.match(/>/g) ?? []).length).toBe(1);
    expect(btn?.textContent).not.toMatch(/▸\s*▸/);
  });
});
