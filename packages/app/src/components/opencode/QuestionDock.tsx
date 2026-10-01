import { useCallback, useEffect, useMemo, useState } from 'react';
import type { QuestionRequest } from '@loomria/shared/opencode';

export type QuestionInfo = QuestionRequest['questions'][number];

/** A question plus the optional flag Codex sets for secret input (masked, never echoed). */
type DockQuestionInfo = QuestionInfo & { secret?: boolean };

export type QuestionDockItem = {
  id: string;
  questions: QuestionInfo[];
  submitting?: boolean;
  /** Server auto-resolution deadline in ms, counted from `receivedAt`. */
  autoResolutionMs?: number;
  /** When the dock received the request (epoch ms); defaults to the first render. */
  receivedAt?: number;
};

export function autoResolutionText(remainingMs: number): string {
  if (remainingMs <= 0) return 'Codex will continue on its own';
  return `Auto-answers in ${Math.ceil(remainingMs / 1000)}s`;
}

function AutoResolutionLine({ totalMs, receivedAt }: { totalMs: number; receivedAt?: number }) {
  const [start] = useState(() => receivedAt ?? Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <p className="text-meta text-text-3" data-testid="question-dock-countdown">
      {autoResolutionText(start + totalMs - now)}
    </p>
  );
}

/** A secret question with no options is just a masked input: no "Other" radio first. */
function isInlineSecret(info: QuestionInfo): boolean {
  return (info as DockQuestionInfo).secret === true && info.options.length === 0;
}

function buildAnswerRow(
  info: QuestionInfo,
  selectedLabels: readonly string[],
  customText: string,
  otherSelected: boolean,
): string[] {
  const multiple = info.multiple === true;
  const trimmedCustom = customText.trim();
  if (multiple) {
    const row = [...selectedLabels];
    if (info.custom === true && otherSelected && trimmedCustom) {
      row.push(trimmedCustom);
    }
    return row;
  }
  if (info.custom === true && otherSelected && trimmedCustom) {
    return [trimmedCustom];
  }
  if (selectedLabels.length > 0) {
    return [selectedLabels[0]];
  }
  return [];
}

function questionAnswered(
  info: QuestionInfo,
  selectedLabels: readonly string[],
  customText: string,
  otherSelected: boolean,
): boolean {
  return buildAnswerRow(info, selectedLabels, customText, otherSelected).length > 0;
}

function QuestionRequestCard({
  request,
  disabled,
  onSubmit,
  onSkip,
}: {
  request: QuestionDockItem;
  disabled: boolean;
  onSubmit: (id: string, answers: string[][]) => void;
  onSkip: (id: string) => void;
}) {
  const infos = useMemo(
    () => request.questions.map((q) => (isInlineSecret(q) ? { ...q, custom: true } : q)),
    [request.questions],
  );
  const [selectedByQuestion, setSelectedByQuestion] = useState<string[][]>(() =>
    infos.map(() => []),
  );
  const [customTextByQuestion, setCustomTextByQuestion] = useState<string[]>(() =>
    infos.map(() => ''),
  );
  const [otherSelectedByQuestion, setOtherSelectedByQuestion] = useState<boolean[]>(() =>
    infos.map((info) => isInlineSecret(info)),
  );

  const answers = useMemo(
    () =>
      infos.map((info, index) =>
        buildAnswerRow(
          info,
          selectedByQuestion[index] ?? [],
          customTextByQuestion[index] ?? '',
          otherSelectedByQuestion[index] ?? false,
        ),
      ),
    [customTextByQuestion, infos, otherSelectedByQuestion, selectedByQuestion],
  );

  const canSubmit = infos.every((info, index) =>
    questionAnswered(
      info,
      selectedByQuestion[index] ?? [],
      customTextByQuestion[index] ?? '',
      otherSelectedByQuestion[index] ?? false,
    ),
  );

  const handleSubmit = useCallback(() => {
    if (!canSubmit || disabled) return;
    onSubmit(request.id, answers);
  }, [answers, canSubmit, disabled, onSubmit, request.id]);

  const toggleLabel = (questionIndex: number, label: string, multiple: boolean) => {
    setSelectedByQuestion((prev) => {
      const next = prev.map((row) => [...row]);
      const row = next[questionIndex] ?? [];
      if (multiple) {
        const has = row.includes(label);
        next[questionIndex] = has ? row.filter((l) => l !== label) : [...row, label];
      } else {
        next[questionIndex] = [label];
        setOtherSelectedByQuestion((o) => {
          const copy = [...o];
          copy[questionIndex] = false;
          return copy;
        });
      }
      return next;
    });
  };

  const selectOther = (questionIndex: number, multiple: boolean) => {
    if (multiple) {
      setOtherSelectedByQuestion((prev) => {
        const next = [...prev];
        next[questionIndex] = !next[questionIndex];
        return next;
      });
      return;
    }
    setOtherSelectedByQuestion((prev) => {
      const next = [...prev];
      next[questionIndex] = true;
      return next;
    });
    setSelectedByQuestion((prev) => {
      const next = prev.map((row) => [...row]);
      next[questionIndex] = [];
      return next;
    });
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
    >
      {infos.map((info, questionIndex) => {
        const multiple = info.multiple === true;
        const secret = (info as DockQuestionInfo).secret === true;
        const inlineSecret = isInlineSecret(info);
        const allowCustom = info.custom === true;
        const selected = selectedByQuestion[questionIndex] ?? [];
        const otherSelected = (otherSelectedByQuestion[questionIndex] ?? false) || inlineSecret;
        const customText = customTextByQuestion[questionIndex] ?? '';
        const groupName = `${request.id}-q-${questionIndex}`;

        return (
          <fieldset key={questionIndex} className="space-y-2 border-0 p-0 m-0 min-w-0">
            {info.header ? (
              <legend className="text-meta font-medium text-text-2">{info.header}</legend>
            ) : null}
            <p className="text-body text-text">{info.question}</p>
            <div className="flex flex-col gap-1.5">
              {info.options.map((opt) => {
                const checked = selected.includes(opt.label);
                return (
                  <label
                    key={opt.label}
                    className="flex items-start gap-2 rounded-md border border-border-subtle/60 bg-elevated/40 px-2 py-1.5 cursor-pointer hover:bg-hover has-[:disabled]:opacity-50"
                  >
                    <input
                      type={multiple ? 'checkbox' : 'radio'}
                      name={multiple ? undefined : groupName}
                      className="mt-0.5 shrink-0"
                      disabled={disabled}
                      checked={checked}
                      onChange={() => toggleLabel(questionIndex, opt.label, multiple)}
                    />
                    <span className="min-w-0">
                      <span className="text-body text-text block">{opt.label}</span>
                      {opt.description ? (
                        <span className="text-meta text-text-3 block">{opt.description}</span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
              {allowCustom ? (
                <div className="space-y-1">
                  {inlineSecret ? null : <label
                    className="flex items-center gap-2 rounded-md border border-border-subtle/60 bg-elevated/40 px-2 py-1.5 cursor-pointer hover:bg-hover has-[:disabled]:opacity-50"
                  >
                    <input
                      type={multiple ? 'checkbox' : 'radio'}
                      name={multiple ? undefined : groupName}
                      className="shrink-0"
                      disabled={disabled}
                      checked={otherSelected}
                      onChange={() => selectOther(questionIndex, multiple)}
                    />
                    <span className="text-body text-text">Other…</span>
                  </label>}
                  {otherSelected ? (
                    <input
                      type={secret ? 'password' : 'text'}
                      autoComplete={secret ? 'off' : undefined}
                      data-testid={secret ? 'question-dock-secret' : undefined}
                      className="w-full rounded-md border border-border-subtle bg-surface px-2 py-1 text-body focus:outline-none focus:ring-2 focus:ring-accent/40"
                      disabled={disabled}
                      value={customText}
                      placeholder="Your answer"
                      onChange={(event) => {
                        const value = event.target.value;
                        setCustomTextByQuestion((prev) => {
                          const next = [...prev];
                          next[questionIndex] = value;
                          return next;
                        });
                      }}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          </fieldset>
        );
      })}
      {request.autoResolutionMs && request.autoResolutionMs > 0 ? (
        <AutoResolutionLine totalMs={request.autoResolutionMs} receivedAt={request.receivedAt} />
      ) : null}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="submit"
          data-testid="question-dock-submit"
          disabled={disabled || !canSubmit}
          className="px-3 py-1 rounded-full bg-accent text-white text-meta disabled:opacity-40"
        >
          Submit
        </button>
        <button
          type="button"
          data-testid="question-dock-skip"
          disabled={disabled}
          className="px-3 py-1 rounded-full border border-border-subtle text-meta hover:bg-hover disabled:opacity-40"
          onClick={() => onSkip(request.id)}
        >
          Skip
        </button>
      </div>
    </form>
  );
}

export function QuestionDock({
  questions,
  busy,
  lastRequestError,
  onReply,
  onReject,
}: {
  questions: QuestionDockItem[];
  busy: boolean;
  lastRequestError?: string | null;
  onReply: (id: string, answers: string[][]) => void;
  onReject: (id: string) => void;
}) {
  if (questions.length === 0) return null;
  return (
    <div
      className="border-t border-accent/30 bg-accent/5 px-3 py-2 space-y-3 shrink-0"
      data-testid="question-dock"
    >
      {lastRequestError ? (
        <p className="text-meta text-status-error" data-testid="question-dock-error">
          {lastRequestError}
        </p>
      ) : null}
      {questions.map((request) => (
        <QuestionRequestCard
          key={request.id}
          request={request}
          disabled={busy || Boolean(request.submitting)}
          onSubmit={onReply}
          onSkip={onReject}
        />
      ))}
    </div>
  );
}
