import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import questionAskedFixture from '../../lib/opencode/__fixtures__/question-asked.json';
import { QuestionDock, type QuestionDockItem, type QuestionInfo } from './QuestionDock';

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

function renderDock(
  props: Partial<{
    questions: QuestionDockItem[];
    busy: boolean;
    lastRequestError: string | null;
    onReply: (id: string, answers: string[][]) => void;
    onReject: (id: string) => void;
  }> = {},
) {
  const onReply = props.onReply ?? vi.fn();
  const onReject = props.onReject ?? vi.fn();
  const root = createRoot(container);
  act(() => {
    root.render(
      <QuestionDock
        questions={props.questions ?? []}
        busy={props.busy ?? false}
        lastRequestError={props.lastRequestError ?? null}
        onReply={onReply}
        onReject={onReject}
      />,
    );
  });
  return { root, onReply, onReject };
}

function fixtureFromQuestionAsked(): QuestionDockItem {
  const props = questionAskedFixture.properties;
  return {
    id: props.id,
    questions: props.questions as QuestionInfo[],
  };
}

function clickLabel(text: string) {
  const label = Array.from(container.querySelectorAll('label')).find((el) =>
    el.textContent?.includes(text),
  );
  if (!label) throw new Error(`label not found: ${text}`);
  const input = label.querySelector('input');
  act(() => {
    if (input) {
      input.click();
    } else {
      label.click();
    }
  });
}

function setTextInputValue(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function clickSubmit() {
  const btn = container.querySelector('[data-testid="question-dock-submit"]') as HTMLButtonElement;
  act(() => btn.click());
}

function clickSkip() {
  const btn = container.querySelector('[data-testid="question-dock-skip"]') as HTMLButtonElement;
  act(() => btn.click());
}

describe('QuestionDock', () => {
  it('renders question-asked fixture with prompt and options', () => {
    renderDock({ questions: [fixtureFromQuestionAsked()] });
    expect(container.textContent).toContain('Pick a color:');
    expect(container.textContent).toContain('Red');
    expect(container.textContent).toContain('Blue');
    expect(container.textContent).not.toContain('"questions"');
  });

  it('selects Red then Submit calls onReply with [["Red"]]', () => {
    const item = fixtureFromQuestionAsked();
    const { onReply, root } = renderDock({ questions: [item] });
    clickLabel('Red');
    clickSubmit();
    expect(onReply).toHaveBeenCalledWith(item.id, [['Red']]);
    act(() => root.unmount());
  });

  it('Skip calls onReject', () => {
    const item = fixtureFromQuestionAsked();
    const { onReject, root } = renderDock({ questions: [item] });
    clickSkip();
    expect(onReject).toHaveBeenCalledWith(item.id);
    act(() => root.unmount());
  });

  it('keeps Submit disabled when nothing selected', () => {
    renderDock({ questions: [fixtureFromQuestionAsked()] });
    const submit = container.querySelector('[data-testid="question-dock-submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('multiple: two labels in one answers row', () => {
    const item: QuestionDockItem = {
      id: 'que_multi',
      questions: [
        {
          header: 'Pick',
          question: 'Choose colors',
          options: [
            { label: 'Red', description: '' },
            { label: 'Blue', description: '' },
          ],
          multiple: true,
        },
      ],
    };
    const { onReply, root } = renderDock({ questions: [item] });
    clickLabel('Red');
    clickLabel('Blue');
    clickSubmit();
    expect(onReply).toHaveBeenCalledWith('que_multi', [['Red', 'Blue']]);
    act(() => root.unmount());
  });

  it('two QuestionInfo: Submit disabled until both answered', () => {
    const item: QuestionDockItem = {
      id: 'que_two',
      questions: [
        {
          header: 'One',
          question: 'First?',
          options: [{ label: 'A', description: '' }],
        },
        {
          header: 'Two',
          question: 'Second?',
          options: [{ label: 'B', description: '' }],
        },
      ],
    };
    const { onReply, root } = renderDock({ questions: [item] });
    const submit = container.querySelector('[data-testid="question-dock-submit"]') as HTMLButtonElement;
    clickLabel('A');
    expect(submit.disabled).toBe(true);
    clickLabel('B');
    expect(submit.disabled).toBe(false);
    clickSubmit();
    expect(onReply).toHaveBeenCalledWith('que_two', [['A'], ['B']]);
    act(() => root.unmount());
  });

  it('custom: Other text included in answers', () => {
    const item: QuestionDockItem = {
      id: 'que_custom',
      questions: [
        {
          header: 'Pick',
          question: 'Your color?',
          options: [{ label: 'Red', description: '' }],
          custom: true,
        },
      ],
    };
    const { onReply, root } = renderDock({ questions: [item] });
    clickLabel('Other…');
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    setTextInputValue(input, 'Purple');
    clickSubmit();
    expect(onReply).toHaveBeenCalledWith('que_custom', [['Purple']]);
    act(() => root.unmount());
  });

  it('submitting disables Submit and Skip', () => {
    renderDock({ questions: [{ ...fixtureFromQuestionAsked(), submitting: true }], busy: false });
    const submit = container.querySelector('[data-testid="question-dock-submit"]') as HTMLButtonElement;
    const skip = container.querySelector('[data-testid="question-dock-skip"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(skip.disabled).toBe(true);
  });

  it('lastRequestError renders in red', () => {
    renderDock({
      questions: [fixtureFromQuestionAsked()],
      lastRequestError: 'Request failed',
    });
    const err = container.querySelector('[data-testid="question-dock-error"]');
    expect(err?.textContent).toBe('Request failed');
    expect(err?.className).toContain('text-status-error');
  });

  it('renders a secret question as a masked input and submits the typed value', () => {
    const consoleSpy = vi.spyOn(console, 'log');
    const { onReply, root } = renderDock({
      questions: [
        {
          id: 'sec-1',
          questions: [
            { question: 'Token?', header: 'Key', options: [], custom: false, secret: true } as QuestionInfo,
          ],
        },
      ],
    });
    const input = container.querySelector<HTMLInputElement>('[data-testid="question-dock-secret"]');
    expect(input?.type).toBe('password');
    expect(input?.autocomplete).toBe('off');
    expect(container.textContent).not.toContain('Other');
    setTextInputValue(input!, 'hunter2');
    expect(container.textContent).not.toContain('hunter2');
    clickSubmit();
    expect(onReply).toHaveBeenCalledWith('sec-1', [['hunter2']]);
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
    act(() => root.unmount());
  });

  it('counts down the auto-resolution time, then says Codex continues on its own', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const { root } = renderDock({
        questions: [
          {
            id: 'auto-1',
            autoResolutionMs: 3000,
            questions: [{ question: 'Pick', header: 'H', options: [{ label: 'A', description: '' }] } as QuestionInfo],
          },
        ],
      });
      const line = () => container.querySelector('[data-testid="question-dock-countdown"]')?.textContent;
      expect(line()).toBe('Auto-answers in 3s');
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(line()).toBe('Auto-answers in 1s');
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(line()).toBe('Codex will continue on its own');
      expect(container.querySelector('[data-testid="question-dock-submit"]')).not.toBeNull();
      act(() => root.unmount());
    } finally {
      vi.useRealTimers();
    }
  });
});
