# Plan: agent GUI blank when opening a past session (TUI loads fine)

Status: implemented (H1–H3 + loading/retry). Live check (step 6) still manual before A12.

## Where the GUI gets its data

- `packages/app/src/components/agent/AgentView.tsx:93` sets `openCodePane = agentType === 'opencode_native' && source !== 'native_tui'`.
- If false: `store` is null, `sessionId` is null, transcript falls back to `fromAgentTimeline(timeline)`, which is empty. GUI is blank.
- `source` comes from `packages/app/src/hooks/useAgentSession.ts`. It starts as `'native_tui'` (line 32) and only becomes `'protocol'` or `'opencode_fallback'` after async `sessionCapabilities()` succeeds.
- If that call throws something other than "command missing", the `else` branch (line 86) only sets `error`; `source` stays `'native_tui'`, so nothing reads the OpenCode store.

## Hypotheses (most likely first)

1. `source` stuck on `native_tui` for a resumed/attached pane (`sessionCapabilities` errors or resolves differently there). Matches "TUI fine, GUI empty".
2. `ensureSessionMessages` (`lib/opencode/store.ts:686`) fails silently: no try/catch, and `use-transcript-view-model.ts:29` uses `void`. A `listMessages` error on a past session shows nothing and never retries.
3. Stale `source`/`timeline` when `paneId` changes, and `loadedMessageSessions` blocks reloads once a session is marked loaded.

## Steps

1. Repro and diagnose (orchestrator, live; delegate the CDP reads to Haiku). Click a past session; read `source`, `error`, `openCodePane`, the result of `GET /session/:id/message` via `opencode_request`, and console errors. This picks the real hypothesis.
2. Failing test first (executor). Vitest for the case found in step 1 (for H1: `useAgentSession` returns an OpenCode-capable source when `sessionCapabilities` errors for an `opencode_native` pane).
3. Fix:
   - H1: in the `else` at `useAgentSession.ts:86`, fall back to `opencode_fallback` when `agentType === 'opencode_native'`; or make `openCodePane` depend on agent type only and stop gating the store on `source`.
   - H2: catch errors in `ensureSessionMessages`, add to `loadedMessageSessions` only on success, and surface the error in the transcript instead of an empty view.
   - H3: reset `source` and `timeline` when `paneId` changes.
4. Guard the blank state: loading state while a load is in flight; error plus retry button if it failed.
5. Checks: `npm run typecheck`, `npm run test`; add a test "select past session -> transcript populated".
6. Live check (orchestrator): click 2-3 past sessions, including a different session in the same pane. GUI shows history, TUI toggle still works. Costs no model usage (history reads only).
7. Commit: `fix: load transcript for resumed opencode sessions`.

## Why before A12

A12's "reload keeps the dock" and "TUI shows same session" checks would hit this bug anyway.
