export type ToolCallStatus = 'pending' | 'running' | 'completed' | 'error';

export type TranscriptFileChip = {
  id: string;
  path?: string;
  filename?: string;
  mime?: string;
  url?: string;
};

export type TranscriptUserPrompt = {
  kind: 'user_prompt';
  id: string;
  text: string;
  files: TranscriptFileChip[];
  collapsedDefault?: boolean;
};

export type TranscriptAssistantText = {
  kind: 'assistant_text';
  id: string;
  markdown: string;
  streaming?: boolean;
};

export type TranscriptReasoning = {
  kind: 'reasoning';
  id: string;
  text: string;
  durationMs?: number;
  streaming?: boolean;
};

export type TranscriptToolCall = {
  kind: 'tool_call';
  id: string;
  name: string;
  title?: string;
  status: ToolCallStatus;
  durationMs?: number;
  input: unknown;
  output: unknown;
  diff?: string;
};

export type TranscriptPatch = {
  kind: 'patch';
  id: string;
  paths: string[];
  summary?: string;
};

export type TranscriptTodoUpdate = {
  kind: 'todo_update';
  id: string;
  items: { id: string; content: string; status: string; priority?: string }[];
};

export type TranscriptSubtask = {
  kind: 'subtask';
  id: string;
  prompt: string;
  title?: string;
};

export type TranscriptRetry = {
  kind: 'retry';
  id: string;
  attempt: number;
  message?: string;
};

export type TranscriptError = {
  kind: 'error';
  id: string;
  message: string;
};

export type TranscriptStepUsage = {
  kind: 'step_usage';
  id: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
};

export type TranscriptItem =
  | TranscriptUserPrompt
  | TranscriptAssistantText
  | TranscriptReasoning
  | TranscriptToolCall
  | TranscriptPatch
  | TranscriptTodoUpdate
  | TranscriptSubtask
  | TranscriptRetry
  | TranscriptError
  | TranscriptStepUsage;

export type AssistantMessageMeta = {
  agent?: string;
  model?: string;
  provider?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
};

export type TranscriptTurn = {
  id: string;
  role: 'user' | 'assistant';
  items: TranscriptItem[];
  meta?: AssistantMessageMeta;
};

export type TranscriptRateLimit = {
  message: string;
  retryAtMs?: number;
};

export type TranscriptViewModel = {
  turns: TranscriptTurn[];
  flatItems: TranscriptItem[];
  sessionBusy: boolean;
  turnActive: boolean;
  rateLimit?: TranscriptRateLimit;
  lastError?: string;
  globalFilePaths: string[];
};

export function emptyTranscriptViewModel(): TranscriptViewModel {
  return {
    turns: [],
    flatItems: [],
    sessionBusy: false,
    turnActive: false,
    globalFilePaths: [],
  };
}

export function flattenTranscriptTurns(turns: TranscriptTurn[]): TranscriptItem[] {
  const out: TranscriptItem[] = [];
  for (const turn of turns) {
    for (const item of turn.items) {
      out.push(item);
    }
  }
  return out;
}
