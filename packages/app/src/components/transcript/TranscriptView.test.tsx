import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenCodeWireEvent } from '@loomria/shared/opencode';
import { applyOpenCodeWireEvent, createEmptyOpenCodeStore } from '../../lib/opencode/store';
import type { TranscriptViewModel } from '../../lib/transcript';
import { fromOpenCode } from '../../lib/transcript/from-opencode';
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

function replayHelloReadTurn() {
  const fixtureDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../lib/opencode/__fixtures__',
  );
  const events = (
    JSON.parse(readFileSync(path.join(fixtureDir, 'hello-read-turn.json'), 'utf8')) as {
      events: OpenCodeWireEvent[];
    }
  ).events;
  let state = createEmptyOpenCodeStore('pane-test');
  for (const event of events) {
    state = applyOpenCodeWireEvent(state, event);
  }
  return fromOpenCode(state, 'sess_hello');
}

describe('TranscriptView', () => {
  it('renders hello-read turn rows in store order', () => {
    const vm = replayHelloReadTurn();
    act(() => {
      root.render(<TranscriptView vm={vm} nativeTuiOnly={false} />);
    });
    const scroll = container.querySelector('[data-testid="transcript-scroll"]');
    expect(scroll).toBeTruthy();
    const user = scroll?.querySelector('[data-testid="user-turn"]');
    const assistants = scroll?.querySelectorAll('[data-testid="assistant-turn"]') ?? [];
    expect(assistants.length).toBeGreaterThanOrEqual(2);
    const order = Array.from(scroll?.children ?? []).map((el) => el.getAttribute('data-testid'));
    const userIdx = order.indexOf('user-turn');
    const firstAsst = order.findIndex((id) => id === 'assistant-turn');
    expect(userIdx).toBeGreaterThanOrEqual(0);
    expect(userIdx).toBeLessThan(firstAsst);
    expect(user?.textContent).toContain('Read hello.txt');
    // Reasoning is collapsed by default, so expand it to check the content
    const reasoningButton = assistants[0]?.querySelector('button');
    if (reasoningButton) {
      act(() => {
        reasoningButton.click();
      });
    }
    expect(assistants[0]?.textContent).toMatch(/think step one/);
    expect(assistants[0]?.textContent).toMatch(/Read/);
    expect(assistants[1]?.textContent).toMatch(/hello/);
    expect(assistants[0]?.textContent?.indexOf('think step one')).toBeLessThan(
      assistants[0]?.textContent?.indexOf('Read') ?? 999,
    );
  });

  it('renders assistant markdown literally without HTML injection', () => {
    act(() => {
      root.render(<TranscriptView vm={vm} nativeTuiOnly={false} />);
    });

    expect(container.textContent).toContain(payload);
    expect(container.textContent).not.toContain('&#39;');
    expect(container.querySelector('b')).toBeNull();
  });
});
