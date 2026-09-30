# Phase 7 (C1) recon: Codex and Claude in the new shell

Read-only recon. No app code changed. Baseline: `rebuild/main` @ c502077. All paths are relative to
`packages/app/` unless noted. Line numbers refer to that commit.

Legend: `TS` = `src/`, `RS` = `src-tauri/src/`.

## 0. Headline findings (risks first)

1. A generic AgentEvent adapter already exists (`TS/lib/transcript/from-agent-events.ts`) but is NOT used in
   production. `useTranscriptViewModel` only calls `fromAgentTimeline(timeline)` for non-OpenCode panes
   (`TS/lib/transcript/use-transcript-view-model.ts:22-30`). `fromAgentEventEnvelopes` / `fromAgentEvents` are referenced
   only by tests and `index.ts` re-exports. C4/C5 must decide which of the two to keep (see section 4).
2. Delta coalescing in the hub can drop text. `ProtocolHub::ingest` keeps only the LAST `MessageDelta` per
   `message_id` inside a 32 ms window (`RS/session/protocol_hub.rs:15,188-212`, test at `:361-400` asserts "a","ab","abc" -> "abc").
   That is only lossless if deltas are cumulative. Codex emits true increments with `text_mode: Append`
   (`RS/protocol/codex_notifications.rs:106-125`), so Codex streaming text can silently lose chunks. OPEN QUESTION: confirm with a live capture
   whether the real Codex `item/agentMessage/delta` is an increment (almost certainly yes).
3. Codex event mapping is tiny. Only `turn/started`, `turn/completed`, `item/agentMessage/{delta,completed}`
   and three approval request methods are mapped (`codex_notifications.rs:8-150`). No reasoning, no command or
   tool items, no file-change/patch items, no usage, no errors, no rate limits, no user message echo. Everything
   else falls into `_ => Vec::new()` and is dropped silently.
4. Claude stream-json mapper expects a flat shape (`type: tool_use | tool_result` at top level,
   `claude_stream_json.rs:246-283`) but real stream-json nests them: `assistant.message.content[]` blocks
   (`text`, `thinking`, `tool_use`) and `user.message.content[]` (`tool_result` with `is_error`). `extract_assistant_text` reads only
   `/message/content/0/text` (`:315-321`). `stream_event` (from `--include-partial-messages`, passed at `:51`) and `system` (init) are dropped.
   `tool_result` is always `ToolStatus::Ok` (`:275`). OPEN QUESTION: no raw stream-json capture exists in the repo; the
   shape claim is from the public stream-json format, not from a recorded fixture.
5. Turn ids are inconsistent for Codex. Deltas/completions use `turn_counter` as `turn_id`
   (`codex_notifications.rs:63,113`), while `TurnStarted`/`TurnCompleted` use the server turn id
   (`:67-74,94-98`). The view-model builder groups by `turn_id`, so a real Codex turn would split into two turns
   (server id for start/complete, counter id for text). Claude uses the counter consistently.
6. User prompts are never emitted as events for Codex or Claude. `ClaudeStreamJsonSession::send_prompt` emits only `TurnStarted`
   (`claude_stream_json.rs:145-162`); Codex `send_turn` emits nothing (`codex_ws.rs` file lines 88-119). So the transcript has no
   user turn for these agents, unless the frontend adds an optimistic one (OPEN QUESTION: nothing found that does).
7. `fromAgentEventEnvelopes` bug: `turn_completed` with `status` cancelled/error leaves `turnActive` true
   (`from-agent-events.ts:239-244`); the legacy reducer sets false always (`agent-timeline-reducer.ts:305-310`). `tool_completed`
   for an unknown tool names it `event.title ?? 'tool'` (`:201-208`).
8. Claude cancel is unsupported (`cancel: false`, `cancel_turn` returns Unsupported, `claude_stream_json.rs:130-139,170-174`) and approvals are
   unsupported. Claude headless runs with `--permission-mode` from env `LOOMRIA_CLAUDE_PERMISSION_MODE` default `default` (`:41-42`), with no
   permission prompt channel, so a tool that needs permission will stall or be denied with no UI. Codex defaults to approvalPolicy `never` +
   `workspace-write` sandbox (`codex_app_server.rs` file lines 25-30), so approvals rarely fire unless `LOOMRIA_CODEX_TURN_APPROVAL` is set (`:60`).
9. `session_open_in_tui` is Claude-only in its implementation (uses `claude_session_id`, the `claude` manifest `launch.resume`,
   `RS/commands.rs:343-370`) and the UI button "Open in TUI" is gated on `headlessClaude` (`AgentView.tsx:345-352`). Codex uses a different
   mechanism (dual pane: PTY attached to the same app-server, plus a ws client, `RS/codex/dual.rs`; "Show TUI" toggle). The two are
   different UX paths; the plan's "Show TUI toggle for Claude" is a product change, not a rename.
10. The stub `CodexWsClient::spawn_with_thread` takes 3 args (`codex_ws_stub.rs` file lines 14-20) but the adapter passes 4
    (`codex_app_server.rs:18-19`), so `--no-default-features` (codex-ws off) does not compile. Default features include `codex-ws`
    (`Cargo.toml:60`), so it is latent.

## 1. Shared transcript view-model adapter (Phase 3)

Location: `TS/lib/transcript/` (there is no `lib/agent-session*` transcript adapter; `agent-session.ts` is the Tauri command/event
wrapper, see section 1.3).

### 1.1 Output types (`TS/lib/transcript/types.ts`)

```ts
type ToolCallStatus = 'pending' | 'running' | 'completed' | 'error';           // :1
type TranscriptItem =                                                            // :106-118
  | { kind: 'user_prompt'; id; text; files: TranscriptFileChip[]; collapsedDefault? }
  | { kind: 'assistant_text'; id; markdown; streaming? }
  | { kind: 'reasoning'; id; text; durationMs?; streaming? }
  | { kind: 'tool_call'; id; name; title?; status: ToolCallStatus; durationMs?; input: unknown; output: unknown; diff?; metadata? }
  | { kind: 'patch'; id; paths: string[]; summary? }
  | { kind: 'todo_update'; id; items: {id; content; status; priority?}[] }
  | { kind: 'subtask'; id; prompt; title? }
  | { kind: 'retry'; id; attempt; message?; retryAtMs? }
  | { kind: 'error'; id; message }
  | { kind: 'step_usage'; id; inputTokens?; outputTokens?; reasoningTokens?; costUsd? }
  | { kind: 'file'; id; filename?; mime?; url?; path? }
  | { kind: 'compaction'; id; auto? };
type AssistantMessageMeta = { agent?; model?; provider?; durationMs?; inputTokens?; outputTokens?; reasoningTokens?; costUsd? };  // :120
type TranscriptTurn = { id; role: 'user'|'assistant'; items: TranscriptItem[]; meta?: AssistantMessageMeta };                   // :131
type TranscriptViewModel = {                                                                                                    // :143
  turns: TranscriptTurn[]; flatItems: TranscriptItem[]; sessionBusy: boolean; turnActive: boolean;
  rateLimit?: { message; retryAtMs? }; lastError?: string; globalFilePaths: string[];
};
```

There is NO `question` or `permission` transcript item kind. Questions and permissions are rendered by separate docks
(`TS/components/opencode/QuestionDock.tsx`, `PermissionDock.tsx`) mounted in `AgentView.tsx:419-436`, fed from the OpenCode store
(`ocState.questions`, `ocState.permissions`) or, for non-OpenCode, from `timeline.pendingApprovals` via
`buildPermissionDockItems` (`PermissionDock.tsx:39-66`). Approvals for Codex already reach `PermissionDock` through this path.

### 1.2 Producers and the selection hook

| Producer | File:line | Input |
| --- | --- | --- |
| `fromOpenCode(state, sessionId)` | `from-opencode.ts:285` | OpenCode store state (SSE-driven) |
| `fromAgentEventEnvelopes(envelopes)` | `from-agent-events.ts:287` | `AgentEventEnvelope[]` (sorted by seq) |
| `fromAgentTimeline(timeline)` | `from-agent-events.ts:312` | legacy `AgentTimelineViewModel` (reducer output) |
| `fromAgentEvents(timeline, envelopes?)` | `from-agent-events.ts:413` | picks the two above |
| `useTranscriptViewModel(paneId, active, openCodePane, source, timeline, sessionId)` | `use-transcript-view-model.ts:10-48` | the only production consumer; OpenCode uses the store, everything else `fromAgentTimeline` |

`fromAgentTimeline` limitations (what Codex/Claude get TODAY): tools are all appended to the LAST assistant turn, not to their
own turn (`:374-387`); file paths become one `patch` item `files-changed` on the last assistant turn (`:389-398`); approvals are not
in the VM (they live in `timeline.pendingApprovals`); no user-turn for non-echoed prompts.

### 1.3 Session data pipeline for non-OpenCode panes

- `useAgentSession(paneId, active, agentType, sessionState)` (`TS/hooks/useAgentSession.ts:25-131`): calls `session_capabilities`
  then `session_history` (`:73-77`), then subscribes to `agent://event` (`:106`) and reduces with `mergeAgentEventEnvelopes`
  (`:108`; dedupes via `seq <= maxSeq`, `agent-timeline-reducer.ts:333-338`). On command failure falls back: `opencode_native` ->
  `opencode_fallback` polling, else `native_tui` (`TS/lib/agent-session-capabilities.ts:15-35`).
- Tauri wrappers (`TS/lib/agent-session.ts`): `sessionCapabilities`, `sessionHistory`, `sessionSendPrompt`
  (args `{pane_id,text}`), `sessionRespondApproval` (`{pane_id,approval_id,decision}`), `sessionCancelTurn`, `sessionOpenInTui`,
  `subscribeAgentEvents` on channel `agent://event`.
- Hub: `RS/session/protocol_hub.rs` keeps a per-pane ring buffer (`HISTORY_CAP = 2000`, `RS/protocol/types.rs:8`), assigns `seq`, emits
  `AgentEventEnvelope {pane_id, seq, event}`. History cap means long sessions lose old events on reload (OPEN QUESTION: intended?).
- `AgentView.tsx` consumes: `timeline.pendingApprovals` (`:119`), `capabilities.{send_prompt,approvals,cancel,attach_tui}` (`:162-166,227,247,264`),
  `transcript.turnActive/sessionBusy` for the Stop button (`:446`).

## 2. Codex event source

Path: Codex dual pane spawns `codex app-server` over WebSocket plus an attached PTY TUI (`RS/codex/dual.rs`); on spawn,
`register_pane_protocol` registers the `CodexAppServer` adapter with the hub using `{ws_url, thread_id, cwd}` (`RS/codex/protocol.rs:10-40`,
called from `RS/commands.rs:~296-306`). Feature `codex-ws` (default on, `Cargo.toml:59-62`) enables `tungstenite`.

Transport: blocking tungstenite thread `codex-ws` (`RS/protocol/codex_ws.rs`), JSON-RPC 2.0. Client requests: `initialize`, `thread/start`
(with `threadId`, `cwd`, optional `approvalPolicy`/`sandboxPolicy`), `turn/start` (`input:[{type:text,text}]`, optional `approvalPolicy`),
`turn/interrupt`, and approval responses `{result:{decision: accept|acceptForSession|decline}}`. Server messages with `method`+`id`
and no result/error are treated as server requests (approvals) vs notifications (`codex_ws.rs` file lines 215-248).

### 2.1 AgentEvent type (Rust `RS/protocol/types.rs:62-156`, TS mirror `TS/lib/agent-events.ts:15-85`)

Tagged `type` snake_case. Every kind with fields (optional marked `?`):

| kind | fields |
| --- | --- |
| `turn_started` | `turn_id` |
| `message_delta` | `turn_id, message_id, role: assistant|user, text, content_kind?: text|reasoning (default text), text_mode?: append|replace (default append)` |
| `message_completed` | `turn_id, message_id, role, text, content_kind?, duration_ms?` |
| `message_meta` | `turn_id, message_id, agent?, model?, provider?, duration_ms?` |
| `tool_started` | `turn_id, tool_id, name, input_summary (string), tool_state?, title?` |
| `tool_completed` | `turn_id, tool_id, status: ok|error, output_summary (string), tool_state?, title?` (NOTE: no `name`) |
| `approval_requested` | `approval_id, title, detail, kind: command|edit|other, options: ApprovalDecision[]` |
| `approval_resolved` | `approval_id, decision: allow_once|allow_always|deny` |
| `files_changed` | `paths: string[]` |
| `usage` | `input_tokens?, output_tokens?, cost_usd?` |
| `rate_limited` | `retry_at_ms?, message` |
| `turn_completed` | `turn_id, status: ok|cancelled|error, error?` |
| `error` | `message` |

Also: `Capabilities { chat, send_prompt, approvals, cancel, file_changes, attach_tui }` (`types.rs:39-47`; TS `agent-events.ts:3-10`).
Envelope: `{pane_id, seq, event}` (`types.rs:204-209`). Tool input/output are flattened to strings (`input_summary`, `output_summary`), so structured
tool data (diff, exit code, paths) is lost before it reaches the frontend (`normalizeToolPayload` in `tool-mapping.ts:58-140` then has to re-parse strings).

### 2.2 Codex wire -> AgentEvent (everything currently mapped)

Source: `RS/protocol/codex_notifications.rs`.

| Codex JSON-RPC method | -> AgentEvent | Fields used | Line |
| --- | --- | --- | --- |
| `turn/started` | `turn_started` | `params.turnId` or `params.turn.id` (fallback counter) | 66-75 |
| `turn/completed` | `turn_completed` | `params.turn.status` interrupted->cancelled, failed->error, else ok; `turn.error.message`; `turn.id` | 76-105 |
| `item/agentMessage/delta`, `thread/item/delta` | `message_delta` (assistant, text, append) | `delta` or `item.text`; `itemId`/`item.id` | 106-125 |
| `item/agentMessage/completed`, `thread/item/completed` | `message_completed` (assistant, text) | `item.text`, `item.id` | 126-143 |
| `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `exec/command/requestApproval`, `command/requestApproval` | `approval_requested` (kind always `command`, options all three) | `params.title` or `commandActions[0].name`, `params.command` (else raw params JSON) | 8-55, 144-147 |
| anything else | dropped | | 148 |

Local events: `approval_resolved` is emitted by the adapter when the user answers (`codex_app_server.rs` file lines 67-77); `error` is emitted on ws loop
failure (`codex_ws.rs` file line 67). Server request id is the approval id (string or stringified number, `codex_notifications.rs:10-19`).

Known app-server notifications NOT mapped (from the public Codex app-server protocol; none are in repo fixtures, so treat as OPEN QUESTIONS to verify
with a live capture): `item/started`, `item/completed` for `reasoning`, `commandExecution`, `fileChange`, `mcpToolCall`, `webSearch`;
`item/reasoning/*` deltas; `item/commandExecution/outputDelta`; `turn/diff/updated`; `turn/plan/updated`; `thread/tokenUsage/updated`;
`account/rateLimits/updated`; `error`; `thread/started`. Exact names must be confirmed against the installed `codex` version.

## 3. Claude event source

Headless path: pane spawned with `agent_type == "claude"` and `surface == "headless"` -> `register_claude_headless_protocol` (`RS/commands.rs:~309-340`)
-> `ClaudeStreamJsonAdapter` (`RS/protocol/claude_stream_json.rs`). It spawns
`claude -p --input-format stream-json --output-format stream-json --include-partial-messages --verbose --session-id <id> --permission-mode <mode>`
(`:45-57`), writes `{"type":"user","message":{"role":"user","content":text}}` lines to stdin (`:151-160`), and parses stdout lines with
`ClaudeStreamMapper::push_line` (`:202-312`). stderr lines are forwarded only if they look like auth failures (`:94-107`).

### 3.1 Claude wire -> AgentEvent (current)

| stdout `type` | -> AgentEvent | Notes | Line |
| --- | --- | --- | --- |
| `assistant` / `message` | `message_delta` (assistant, Append, text = `/message/content/0/text` or `text`) | only first content block, only text. Text that looks like auth failure becomes `error` + `turn_completed(error)` | 216-245 |
| `tool_use` (top level) | `tool_started` (name, `input` JSON stringified, state None) | real stream has this nested in `assistant.message.content[]` -> likely never matches (OPEN QUESTION, verify with capture) | 246-266 |
| `tool_result` (top level) | `tool_completed` status always `ok`, content stringified | real stream: `user.message.content[]` with `is_error` | 267-283 |
| `result` | `message_completed` (accumulated text) + `usage` (input/output tokens only; no cost) + `turn_completed(ok)` | `total_cost_usd`, `is_error`, `duration_ms`, `subtype` ignored | 284-292, 323-353 |
| `error` | `error` + `turn_completed(error)` | | 293-308 |
| `stream_event`, `system`, `user`, anything else | dropped | partial-message deltas requested at `:51` but unused | 309 |

After `result` or `error`, `turn_finished` is set and ALL further lines are ignored until `begin_turn` (`:210-212`); `begin_turn` is called per prompt (`:147`).
`message_id` falls back to the literal `"assistant"` (`:232,199`), so with no `uuid` every assistant message in every turn shares one id.
Turn id = counter at read time (`:213`), consistent with `TurnStarted` emitted in `send_prompt` (`:148-150`).

Claude events that have no AgentEvent kind yet: `thinking` blocks (would be `message_delta` with `content_kind: reasoning`), `rate_limit_event`,
permission denials (`result.permission_denials`), `total_cost_usd`, `init` (model, tools, session id).

### 3.2 `session_open_in_tui` (Claude)

`RS/commands.rs:343-370`: reads `claude_session_id(registry, pane_id)` (`RS/session/claude_headless.rs`), the pane cwd, and the `claude` manifest `launch.resume`
args; spawns a NEW PTY pane with `--resume <session_id>`; returns the new pane id. The headless child is not stopped (OPEN QUESTION: two processes on one session id;
verify concurrent-writer behavior). Frontend: `sessionOpenInTui` (`TS/lib/agent-session.ts:65-68`), button at `AgentView.tsx:344-352`; `headlessClaude` is computed in
`AppShell.tsx:675-678` (`surface === 'headless' && agent_type === 'claude'`). The returned pane id is discarded by the button (`void sessionOpenInTui(paneId)`), so the caller
does not navigate to the new pane (OPEN QUESTION: does the shell auto-select it via `pty://panes-changed`?).

## 4. Mapping table: AgentEvent kind -> transcript item

"Legacy" = `fromAgentTimeline` (what runs today). "Envelope" = `fromAgentEventEnvelopes` (exists, unused in prod). "Dock" = separate UI outside the transcript.

| AgentEvent kind | Target | Legacy (`agent-timeline-reducer` + `fromAgentTimeline`) | Envelope (`from-agent-events.ts`) | Status |
| --- | --- | --- | --- | --- |
| `turn_started` | flag | `turnActive=true` | creates assistant TurnBuilder, `turnActive=true` (`:79-86`) | mapped |
| `message_delta` role=user | `user_prompt` | becomes a user `TimelineMessage` | `user_prompt` (`:99-111`) | mapped (but no producer emits user events for Codex/Claude) |
| `message_delta` text | `assistant_text` (streaming) | message.text (`:241-274`) | `upsertAssistantText` (`:117-124`) | mapped |
| `message_delta` reasoning | `reasoning` (streaming) | message.reasoning | `upsertReasoning` (`:112-116`) | mapped; no Codex/Claude producer |
| `message_completed` text/reasoning | `assistant_text` / `reasoning` (final) | yes | yes (`:127-157`) | mapped |
| `message_meta` | turn `meta` (agent/model/provider/duration) | header line | `tb.meta` (`:159-170`) | mapped; no Codex/Claude producer |
| `tool_started` | `tool_call` (running) | `timeline.tools`, attached to last assistant turn | pushed into its own turn (`:171-185`) | mapped (input string only) |
| `tool_completed` | `tool_call` status/output | updates tool | updates or creates (`:186-212`) | mapped; name lost when tool unseen |
| `approval_requested` | permission (Dock) | `pendingApprovals` -> `PermissionDock` | ignored in VM (`:248-250`) | mapped via Dock, NOT a transcript item |
| `approval_resolved` | permission (Dock) | clears pending | ignored | mapped via Dock; no transcript record of the decision |
| `files_changed` | `patch` | one `patch` item `files-changed` on last assistant turn | only `globalFilePaths`, NO `patch` item (`:213-217`) | PARTIAL (legacy yes, envelope no); Codex never emits it, Claude capability says `file_changes: true` but mapper never emits it |
| `usage` | `step_usage` + meta tokens | `turnUsage` on last assistant message -> `step_usage` | `step_usage` + meta (`:218-235`) | mapped |
| `rate_limited` | banner (`rateLimit`) | `vm.rateLimit` | `vmFlags.rateLimit` | mapped as VM banner, not an item; no producer |
| `turn_completed` | flag + error | `turnActive=false`, `lastError` if error | `turnActive` stays true unless ok (BUG, `:239-244`); error -> `lastError` | mapped; envelope bug |
| `error` | `error` item | `lastError` only | `lastError` only | UNMAPPED as transcript item (`TranscriptError` exists, never produced from AgentEvent) |
| (no kind) `question` | question | n/a | n/a | No AgentEvent kind and no transcript kind. OpenCode uses store + QuestionDock; Codex/Claude have no question concept in current protocols (OPEN QUESTION: Claude `AskUserQuestion` tool, Codex `item/tool/requestUserInput`) |
| (no kind) `patch` with diff | `patch`/`tool_call.diff` | n/a | n/a | No AgentEvent carries a diff or per-file change; Codex `fileChange` items and Claude Edit/Write tool inputs are dropped or stringified |
| (no kind) `retry`, `compaction`, `todo_update`, `subtask`, `file` | same | n/a | n/a | OpenCode-only transcript kinds with no AgentEvent source; Claude `TodoWrite`/`Task` tools could map via `tool_call.name` |

Transcript kinds with NO AgentEvent source today: `todo_update`, `subtask`, `retry`, `error`, `file`, `compaction`, (`patch` partially).

## 5. Recorded fixtures available for replay tests

Do not edit these. Working tree of `rebuild/main` shows none of them dirty (only `Cargo.toml` is modified).

| Fixture | Content | Usable for |
| --- | --- | --- |
| `src-tauri/tests/fixtures/agent_event_sequences.json` | type-name lists only (no payloads) for codex/claude/opencode prompt-ok and codex approval-denied | sequence-shape checks only; `from-agent-events.test.ts:50-66` builds minimal events from it |
| `src-tauri/tests/fixtures/live/codex_prompt.json` | `turn_started, message_delta("ok"), turn_completed` (ids redacted `<id>`) | Codex basic turn replay (no reasoning/tools/usage) |
| `.../live/codex_approval_deny.json` | `turn_started, approval_requested(command, 3 options, detail is a long pwsh path ending in an ellipsis), approval_resolved(deny), turn_completed(ok)` | Codex approval flow -> PermissionDock |
| `.../live/codex_cancel.json` | `turn_started, turn_completed(cancelled)` | cancel status (exposes the envelope `turnActive` bug) |
| `.../live/claude_prompt.json` | `turn_started, message_delta("ok"), message_completed("ok"), usage(1,1), turn_completed(ok)` | Claude basic turn + usage |
| `.../live/opencode_prompt.json`, `opencode_approval_deny.json`, `opencode_cancel.json`, `opencode_hi_chat.json` | OpenCode AgentEvent captures (hi_chat has meta+usage) | reference only (OpenCode is covered by the store path) |
| `src-tauri/tests/live_fixture_replay.rs` | Rust replay of the above plus synthetic wire JSON through `map_codex_*` and `ClaudeStreamMapper` | model for wire-level replay (`:181-215`) |
| `src/lib/opencode/__fixtures__/*.json`, `src/lib/transcript/fixtures/live_opencode_capture.json` | OpenCode SSE/store fixtures | OpenCode only |

Gaps: there is NO raw wire capture (Codex JSON-RPC frames or Claude stream-json lines) in the repo. The fixtures above are post-mapping AgentEvents, and all are
"tiny" happy paths. There is no fixture with reasoning, tool calls, file changes, usage for Codex, errors, or rate limits for Codex/Claude. C4/C5 fixture replay
tests will need new sanitized wire captures (a live recording task for the orchestrator), because the existing ones cannot exercise tools/reasoning/patch mapping.

## 6. Proposed `AgentCapabilities` (C2)

Existing pieces to reconcile:
- Rust/TS `Capabilities` (6 booleans) from the hub (`agent-events.ts:3-10`); `opencodeCapabilities()` hard-codes `cancel:false, file_changes:false`
  (`TS/lib/opencode-agent-adapter.ts:5-14`) even though the composer Stop works for OpenCode via `abortOpenCodeSession` (`AgentComposerPanel.tsx:530`).
- `composerFeaturesForCapabilities` / `composerFeaturesOpenCode` (`TS/lib/commands/agent.ts:101-127`): a 9-flag composer feature map already exists.

Proposed (TS, `TS/lib/agent-capabilities.ts`), a superset that can derive today's `Capabilities` and composer features:

```ts
export type AgentId = 'opencode' | 'codex' | 'claude';

export type AgentCapabilities = {
  agent: AgentId;
  transport: 'opencode_http' | 'codex_app_server' | 'claude_stream_json';
  // composer
  send: boolean;
  abort: boolean;
  models: false | { pick: boolean; source: 'catalog' | 'static' };
  agents: boolean;                       // OpenCode agent picker (build/plan)
  permissionModes: false | { values: readonly string[]; userPickable: boolean };
  slashCommands: boolean;
  fileMentions: boolean;
  shellMode: boolean;
  attachments: false | { images: boolean; files: boolean };
  // transcript/session
  reasoning: boolean;
  tools: boolean;
  patches: boolean;                      // emits per-file patch/diff data
  usage: boolean;
  questions: boolean;                    // agent-initiated multi-choice questions
  permissions: boolean;                  // interactive approvals
  permissionReplies: readonly ('once' | 'always' | 'reject')[];
  fork: boolean;
  revert: boolean;
  summarize: boolean;
  sessionList: boolean;                  // server-side session list/search/rename/delete
  tui: false | { mode: 'attach' | 'resume_new_pane' };  // codex: attach (Show TUI), claude: resume (Open in TUI)
};
```

Notes for C2:
- Keep the Rust `Capabilities` as the runtime subset the hub reports; `AgentCapabilities` is the static, per-agent declaration. OPEN QUESTION: should it be
  static per agent or merged with the hub's runtime `Capabilities` (e.g. Claude `approvals` depends on permission-mode)? Suggest static object + runtime AND-mask.
- Suggested initial values: OpenCode = everything true except nothing (`abort: true`, `questions: true`, `permissions: true`, `tui: attach`);
  Codex = `send, abort, permissions(once/always/reject), reasoning:false until mapped, tools:false until mapped, tui: attach`; Claude = `send, usage, tui: resume_new_pane`,
  `abort:false`, `permissions:false` (per `claude_stream_json.rs:130-139`). Flip flags to true only as C4/C5 commits land, so the UI never advertises unmapped features.

### 6.1 What the composer hardcodes as OpenCode-only today (`TS/components/composer/AgentComposerPanel.tsx`)

| Hardcode | Line(s) | Effect on Codex/Claude |
| --- | --- | --- |
| `features = openCode ? composerFeaturesOpenCode() : composerFeaturesForCapabilities(capabilities)` | 92 | agent/model pickers are `false` for non-OpenCode (`agent.ts:104-105`); permission picker follows `caps.approvals`, so it shows for Codex ("Allow/Ask" pill, but its state is OpenCode-only: see below) |
| `features.mentions`, `slashCommands`, `shellMode` are defined but NEVER read | (grep: only `attach, agentPicker, permissionPicker, modelPicker, stop` are read, 467-525) | `@` and `/` pickers open for every agent (`:368,372,457`); results come only from OpenCode endpoints, so they are silently empty/unavailable for Codex/Claude |
| Mention search gated on `openCode` | 260-279 | no hits for Codex/Claude |
| Agents/models/commands/config loaded only when `openCode` | 190-251 | pickers empty |
| Submit path: shell (`!`), slash (`/cmd`), prompt with parts/agent/model/permissionMode all behind `openCode && sessionId` | 293-322 | Codex/Claude only get `onSendProtocol(raw)` (text only): attachments, mentions and file parts are built (`:288-292`) but DROPPED on the protocol path (`:324`); `!cmd` and `/cmd` are sent as literal text |
| `permissionMode` state is `'allow' | 'ask'` with OpenCode session prefs | 96, 253-257 | not wired to Codex `approvalPolicy` or Claude `--permission-mode` (both come from env vars on the Rust side, `codex_app_server.rs` file lines 25-30,60; `claude_stream_json.rs:41-42`) |
| Stop: `openCode && sessionId ? abortOpenCodeSession : onCancelProtocol` | 528-531 | Claude cancel returns Unsupported; Stop button is shown if `capabilities.cancel && turnActive` or `transcript.sessionBusy` (`AgentView.tsx:453`) |
| `composerAllowlistOk()` check + allowlist banner | 127-131 | OpenCode only |
| "Shell mode" link in hint row | 660-672 | hidden for others, but the hint text still advertises `! for shell / for commands @ for files` (`:659`) for all agents |
| Upload/attach button `features.attach` = `caps.send_prompt` | 467-478 | shown for Codex/Claude but attachments are dropped (see above) |
| `AgentView`: `composerDisabled = !capabilities.send_prompt && !openCodePane` | AgentView `:293` | fine |
| `AgentView.respondApproval` falls through to `tauri.replyOpenCodePermission` when `source !== 'protocol'` | AgentView `:225-241` | wrong target if a non-OpenCode pane ever runs without protocol source |
| Fork action only wired for OpenCode (`onForkFromMessage`) | AgentView `:416-422` | already gated; add `fork` capability |
| `nativeTuiOnly` derived from 4 capability booleans | AgentView `:169-174` | replace with `tui && !send` |
| `headlessClaude` gating Open in TUI vs Show TUI | AgentView `:345-360`, AppShell `:675` | replace with `capabilities.tui.mode` |

## 7. Open questions (need live capture or owner decision)

1. Real Codex app-server frames for reasoning, commandExecution, fileChange, tokenUsage, errors. No raw capture in repo; exact method names and payloads for the installed `codex`
   version are unverified.
2. Real Claude stream-json lines (with `--include-partial-messages`): confirm nested `assistant.message.content[]`, `user.message.content[].tool_result`, `stream_event`, `result` fields.
3. Whether hub delta coalescing is intended to be lossy for append-mode deltas (finding 2). A fix is either to coalesce by concatenating appends or to emit Codex/Claude deltas as
   `replace` with accumulated text (the Claude mapper keeps accumulated text but only sends the latest chunk).
4. Where user prompts for Codex/Claude should enter the transcript (optimistic local echo in the frontend vs a Rust-emitted `message_completed role=user` on `send_prompt`).
5. Codex turn-id unification (server turn id vs counter).
6. History ring buffer cap (2000) for long Codex/Claude sessions and reload behavior; `session_history` has no persistence across app restarts (`RS/session/persist.rs` exists; relationship unverified).
7. `session_open_in_tui` side effects (second `claude` process on the same session id; new pane is not auto-selected by the caller).
8. Should `fromAgentEventEnvelopes` replace `fromAgentTimeline` for C4/C5 (recommended: envelopes are the only path that can place tools on their own turn), which also requires
   fixing finding 7 and deciding how `timeline.pendingApprovals` stays in sync.
9. Claude interactive permissions: stream-json headless has no approval channel; decide between `--permission-prompt-tool` (MCP-based) vs staying read-only/allow-mode for Phase 7.
