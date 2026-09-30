import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '../../lib/transcript';
import { formatCostUsd, formatTokenCount } from '../../lib/transcript';
import { AssistantTurnBlock, UserTurnRow } from './TurnRows';

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

describe('AssistantTurnBlock', () => {
  it('shows meta footer with tokens and cost from step-finish meta', () => {
    const turn: TranscriptTurn = {
      id: 'a1',
      role: 'assistant',
      items: [
        {
          kind: 'assistant_text',
          id: 't1',
          markdown: 'done',
        },
        {
          kind: 'step_usage',
          id: 's1',
          inputTokens: 100,
          outputTokens: 50,
          costUsd: 0.0123,
        },
      ],
      meta: {
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.0123,
      },
    };
    act(() => {
      root.render(<AssistantTurnBlock turn={turn} />);
    });
    const footer = container.querySelector('[data-testid="meta-footer"]');
    expect(footer?.textContent).toContain(formatTokenCount(150));
    expect(footer?.textContent).toContain(formatCostUsd(0.0123));
  });
});
