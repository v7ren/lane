# Agent GUI: implementation plan

Date: 2026-10-01. Branch `rebuild/main`. Spec: `docs/agent-gui-spec.md` (section numbers below refer to it). The work already marked done in `docs/agent-gui-fix-plan.md` section 5 is not re-planned here.

Paths are relative to `packages/app/` unless they start with `docs/`. `NEW` marks a file that does not exist yet.

---

## First sprint (P0, can start now)

| Order | Task | Executor | Can start | Runs in parallel with |
|---|---|---|---|---|
| 1 | A1 Rust shared events, envelope, hub | SONNET | now | A2, B1, B3, B4, C1, D1, E6 |
| 1 | A2 TS shared events, reducer, transcript items | SONNET | now (shapes fixed by spec 2.1 to 2.3) | A1, B1, B3, B4, C1, D1, E6 |
| 1 | B1 Agent mark on header and sidebar rows | HAIKU | now | all of row 1 |
| 1 | B3 `git_info.rs` (branch, changed count, diff files) | SONNET | now | all of row 1 |
| 1 | B4 Composer draft persistence | HAIKU | now | all of row 1 |
| 1 | C1 Command model (pure lib) and capability fields | SONNET | now | all of row 1 |
| 1 | D1 Fix the Codex question answer path, redact logs | SONNET | now | all of row 1 |
| 1 | E6 Reasoning collapsed by default | HAIKU | now | all of row 1 |
| 2 | A3 Epoch reset and `replayed` in the frontend, contract fixture | SONNET | after A1 and A2 | A5 |
| 2 | A5 Claude approval payloads, answer unknown control requests | SONNET | after A1 | A3 |
| 3 | A4 Local notices and `session_post_notice` | HAIKU | after A1 and A2 (A3 recommended) | |

Sprint exit:
- All tasks merged, and the four verification commands are green.
- Live check: Back to chat and Open in terminal keep the transcript intact (A3); a Codex question can be answered (D1).

---

## Rules for every task

Run these before each commit. All of them must pass.

```sh
# repo root (C:\Users\Ren-pc\Desktop\work2\loomria-ui)
npm run typecheck
npm test
# packages/app/src-tauri
cargo test --no-default-features --features codex-ws
cargo check --no-default-features
```

- **API pairs move in the same commit.** `session/protocol_hub.rs` and `session/protocol_hub_stub.rs` must have the same public methods and the same delta-merge semantics (non-test builds use the hub, test builds use the stub; see `session/mod.rs`). The same applies to `protocol/codex_ws.rs` and `protocol/codex_ws_stub.rs` (`CodexWsClient`), and to new `#[tauri::command]` functions plus their `generate_handler!` entry in `src-tauri/src/lib.rs` plus their TS wrapper in `src/lib/tauri.ts` or `src/lib/agent-session.ts`.
- **New `AgentEvent` variants or fields** update all of these together: `types.rs`, `event_contract.rs` (`event_type`, `turn_id_of`), every constructor (`claude_stream_json.rs`, `claude_session_file.rs`, `codex_notifications.rs`, `codex_ws.rs`, `codex/dual.rs`, `opencode/event_map.rs`, `protocol/opencode_http.rs`, tests), and `src/lib/agent-events.ts`, `agent-timeline-reducer.ts`, `lib/transcript/from-agent-events.ts` (exhaustive `never` switches).
- **Line endings.** Source files are CRLF; patch scripts preserve them. Use `python`, not `python3`. Use `MSYS_NO_PATHCONV=1` when passing `/cmd` arguments in Git Bash.
- **Live checks.** Use the e2e harness (handoff section 6), one tiny prompt each, in `%TEMP%\loomria-e2e-repo`. Close the app with `close-app.ps1`. Never kill processes you did not start. Record each live result in `docs/agent-gui-fix-plan.md` section 5 Progress.
- **Capability flags** in `src/lib/agent-capabilities.ts` flip only after their live check.

### Files more than one task edits

Tasks that share a file must not run at the same time. Run them in the listed order, or rebase.

| File | Tasks (in order) |
|---|---|
| `src-tauri/src/protocol/types.rs` | A1 → D3 → G4 |
| `session/protocol_hub.rs`, `protocol_hub_stub.rs` | A1 → G4 |
| `protocol/claude_stream_json.rs` | A1 → A5 → F1 → E5 → G1 → G4 |
| `protocol/claude_session_file.rs` | A1 → C5 → F1 → G4 |
| `protocol/codex_notifications.rs` | A1 → D2 → D6 → D7 → D8 |
| `protocol/codex_ws.rs`, `codex_ws_stub.rs` | A5 → D3 → D4 → D7 → D8 → D9 → F4 |
| `protocol/codex_app_server.rs` | D1 → D3 → D4 |
| `codex/dual.rs` | D3 → D5 → D8 |
| `src-tauri/src/commands.rs` | D1 → A4 → C4 → D5 → D8 → D9 → G2 → G4 |
| `src-tauri/src/lib.rs` | B3 → A4 → C4 → D5 → D9 |
| `src/lib/agent-events.ts`, `agent-timeline-reducer.ts` | A2 → A3 |
| `src/lib/transcript/from-agent-events.ts`, `transcript/types.ts` | A2 → A3 → E1 → E2 → E3 → E7 |
| `src/hooks/useAgentSession.ts` | A3 → E3 → F2 → E7 |
| `src/components/agent/AgentView.tsx` | B1 → B6 → B5 → B2 → C2 → D2 → D5 → E5 → G2 |
| `src/components/composer/AgentComposerPanel.tsx` | B4 → B5 → C2 → C4 → G4 |
| `src/components/transcript/ToolCard.tsx`, `TranscriptItemView.tsx`, `TurnRows.tsx` | E6 → A2 → C5 → E1 → E2 → E3 → E7 |
| `src/components/opencode/QuestionDock.tsx`, `src/lib/protocol-questions.ts` | A2 → D2 → D7 → G5 |
| `src/components/opencode/PermissionDock.tsx` | G3 → E4 |
| `src/lib/shell-data.ts` | B1 → D9 → F2 |
| `src/lib/agent-capabilities.ts` | C1 → C3 → C6 → D10 → G4 (flag flips) |

---

## Phase A: shared plumbing (P0)

### A1. Rust shared events, envelope and hub (spec 2.1, 2.2)
- **Goal:** add `Notice`, `PlanUpdated` and `ToolOutputDelta`, plus `ApprovalRequested.payload`, `Usage.context_tokens/context_window`, and the envelope fields `epoch`/`replayed`/`ts_ms`. Seeded history becomes uncapped, `ToolOutputDelta` becomes ephemeral and coalesced, and the hub gets `emit_local`. Fix the stub's Append merge and the state mapping of `ApprovalResolved`.
- **Files:**
  - `src-tauri/src/protocol/types.rs`, `event_contract.rs`, `protocol/mod.rs` (re-exports `NoticeLevel`, `NoticeAction`, `PlanItem`, `PlanStatus`);
  - `session/protocol_hub.rs`, `session/protocol_hub_stub.rs`, `session/state.rs`;
  - constructors (`payload: None`, context `None`) in `claude_stream_json.rs`, `claude_session_file.rs`, `claude_mirror.rs`, `codex_notifications.rs`, `codex_ws.rs`, `codex/dual.rs`, `opencode/event_map.rs`, `protocol/opencode_http.rs`;
  - tests in `src-tauri/tests/protocol_hub_unit.rs`, `tests/protocol_transcript_test.rs`.
- **Steps:**
  1. Add the types exactly as in spec 2.2, with serde snake_case and `#[serde(default)]` on every new field.
  2. Hub: set `epoch = generation` and `ts_ms = now_ms()` on each envelope. `seed_history` sets `replayed = true` and pushes into a NEW `seed: Vec<AgentEventEnvelope>`. `history()` returns `seed` followed by the ring.
  3. Hub: coalesce `ToolOutputDelta` by `tool_id` (concatenate) in a second map flushed by the existing timer. Emit it but never store it.
  4. Add `emit_local(pane_id, event)`, which calls `ingest` (stub: the same).
  5. Stub `ingest`: copy `merge_delta` from the real hub.
  6. `state.rs`: `ApprovalResolved` maps to `Working`; `Notice{level: Error}` maps to `Error`.
  7. Usage context producers. Claude `map_result`: `context_tokens = input + cache_read + cache_creation`. Codex `thread/tokenUsage/updated`: `context_tokens = tokenUsage.last.inputTokens`, `context_window = tokenUsage.modelContextWindow`.
- **Tests:**
  - serde round-trip for each new variant;
  - `agent_event_json_contract` gains the new types;
  - stub: Append deltas concatenate, `ToolOutputDelta` is not in `history()`, seeded events have `replayed: true` and survive more than `HISTORY_CAP` live events, epoch differs after re-register;
  - `state.rs` mapping;
  - usage mapping from `claude_raw_turns.jsonl` (context = 4 + 77261 + 25432) and `codex_raw_turns.jsonl` (window 258400).
- **Done when:** the four commands are green. Live: a Claude chat still streams and shows usage. This is a no-regression check because the UI ignores the new fields until A2 and A3.
- **Size:** M · **Deps:** none · **Executor:** SONNET

### A2. TS shared events, reducer and transcript items (spec 2.1 to 2.3, 3.4 items 5 and 6)
- **Goal:** mirror the A1 shapes in TS and render the `notice` item.
- **Files:** `src/lib/agent-events.ts` (`ApprovalPayload`, new variants, envelope fields), `src/lib/agent-timeline-reducer.ts` (`plan`, `notices` in the view model, and `ToolOutputDelta` ignored), `src/lib/transcript/types.ts` (`TranscriptNotice`, `tool_group` type only, tool `startedAtMs`/`endedAtMs`/`diffStat`), `src/lib/transcript/from-agent-events.ts` (notice items, replace and clear by id; sticky notices go to the view model, not the turns), `src/components/transcript/TranscriptItemView.tsx` (`NoticeRow`), `src/lib/protocol-questions.ts` (read `payload.questions` first).
- **Steps:**
  1. Write the types from the spec.
  2. Reducer cases.
  3. Notice rendering: info is muted, warning amber, error red. Action buttons call an `onNoticeAction` prop threaded from `TranscriptView`, a no-op until wired.
  4. Make `questionsFromApproval` map `secret` and `allow_other` (fields carried on `QuestionInfo` as extra optional props).
- **Tests:**
  - reducer and `fromAgentEventEnvelopes` handle each new type;
  - a notice with the same id replaces, and `cleared` removes;
  - `questionsFromApproval` with payload and with legacy detail;
  - `transcript-no-raw-json.test.tsx` still passes.
- **Done when:** the commands are green. Live: none (no producer yet besides A1's Usage fields).
- **Size:** M · **Deps:** none (spec-fixed shapes). Merge after A1 if both are ready. · **Executor:** SONNET

### A3. Epoch reset, replayed flag and contract fixture (spec 2.1, contradictions 4 and 5)
- **Goal:** re-registration never drops events, and replayed history never notifies or animates.
- **Files:** `src/hooks/useAgentSession.ts`, `src/lib/agent-session.ts` (`mergeEnvelopeLog` keyed by `(epoch, seq)`), `src/lib/session-notify-decision.ts` (skip replayed), `src-tauri/tests/fixtures/agent_event_sequences.json` (add sequences with `notice`, `plan_updated`), `src/lib/agent-contract.test.ts`, `src-tauri/tests/protocol_transcript_test.rs`.
- **Steps:**
  1. In the event listener: if `envelope.epoch > currentEpoch`, set `currentEpoch`, clear the envelope log and the view model, and call `refreshCapabilities()`, which re-fetches history.
  2. `mergeAgentEventEnvelopes`: compare `(epoch, seq)`.
  3. Replayed envelopes: `streaming=false`, no notification.
  4. Extend the fixture and both contract tests.
- **Tests:** a hook test (`useAgentSession.test.tsx`) where epoch 1 has seq 1 to 5, then epoch 2 seq 1 to 3, and all epoch-2 events show while epoch 1 is gone. Merge-log key tests. Fixture parity in Rust and TS.
- **Done when:** live, a Claude chat with 2 turns. Open in terminal, type a prompt in the terminal, and the reply appears in the chat. Back to chat, send again: no duplicate or missing bubbles. Repeat twice.
- **Size:** S · **Deps:** A1, A2 · **Executor:** SONNET

### A4. Local notices and `session_post_notice` (spec 2.5)
- **Files:** `src/lib/local-notices.ts` (NEW), `src/lib/transcript/use-transcript-view-model.ts` (merge local notices after `afterTurnId`), `src-tauri/src/commands.rs` (`session_post_notice(pane_id, level, text)` calls `hub.emit_local`), `src-tauri/src/lib.rs`, `src/lib/agent-session.ts` (`sessionPostNotice`).
- **Tests:** store push and subscribe; merge position after a given turn; an OpenCode transcript shows a local notice.
- **Done when:** live, from devtools (`cdp.mjs eval`) `sessionPostNotice(pane,'info','hi')` shows a row in a Claude pane, and `pushLocalNotice` shows one in an OpenCode pane.
- **Size:** S · **Deps:** A1, A2 · **Executor:** HAIKU

### A5. Claude approval payloads and replies to unknown control requests (spec 2.3, contradiction 7)
- **Files:** `src-tauri/src/protocol/claude_stream_json.rs`, `src-tauri/src/protocol/codex_ws.rs` (the unsupported-request path also emits a `Notice`).
- **Steps:**
  1. `map_control_request` builds `payload` per the spec 2.3 table: command, edit (Edit, MultiEdit, Write), questions, plan.
  2. A `control_request` with an unknown subtype is answered with `{"type":"control_response","response":{"subtype":"error","request_id":…,"error":"not supported by Loomria"}}` and emits `Notice{level:Warning, id:"claude-unsupported-<subtype>"}`. Writing needs stdin, so the mapper returns a `MapperReply` list that the reader thread writes. Add a `stdin` handle `Arc<Mutex<ChildStdin>>` shared with the session.
  3. In `codex_ws.rs` `handle_value`: when events are empty for a server request, also send a `Notice{level:Warning, id:"codex-unsupported-<method>"}` on `events_tx`.
- **Tests:** a payload per tool (Edit, MultiEdit, Write, Bash, AskUserQuestion, ExitPlanMode); the unknown subtype produces both a reply and a notice; the Codex unknown request produces a notice (extend `unknown_server_request_is_answered_over_the_socket`).
- **Done when:** live, a Claude Edit approval still works (Allow once), with no regression.
- **Size:** S · **Deps:** A1 · **Executor:** SONNET

---

## Phase B: identity, composer, layout (P0)

### B1. Agent mark (spec 3.1)
- **Files:** `src/components/agent/AgentMark.tsx` (NEW), `src/lib/shell-data.ts` (`ShellSession.agentFamily`), `src/lib/sessions/merge-sessions.ts`, `src/components/sessions/SessionRow.tsx`, `src/components/agent/AgentView.tsx` (mark before `agentLabel` only).
- **Steps:**
  1. Component per the spec table: `C` `#D97757`, `X` `#8B5CF6`, `O` `#3B82F6`.
  2. Set `agentFamily` via `agentFamily()` from `lib/agent-capabilities.ts` in `buildPaneShellSessions` and `buildOpenCodeShellSessions`; past Claude rows get `'claude'`.
  3. Render it in the row before the status dot.
- **Tests:** `AgentMark` letter and colour per family; `merge-sessions.test.ts` asserts `agentFamily`.
- **Done when:** live, a screenshot with Claude, Codex and OpenCode rows and headers shows three distinct marks.
- **Size:** S · **Deps:** none · **Executor:** HAIKU

### B2. Pane header: status, project, branch, chips, confirm bar (spec 3.1)
- **Files:** `src/components/agent/AgentPaneHeader.tsx` (NEW), `src/components/agent/ConfirmBar.tsx` (NEW), `src/components/agent/AgentView.tsx` (use both; replace `window.confirm` in `toggleClaudeTui`), `src/hooks/useGitSummary.ts` (from B3).
- **Steps:**
  1. Move the header JSX out of `AgentView` into `AgentPaneHeader`.
  2. Add the status label, cwd basename, branch, `±N` and chips (from `useAgentControls`, B5). The owner chip comes from `useTuiCompanions`.
  3. Show the inline `ConfirmBar` for stop-and-hand-over, in both directions.
  4. Disable the chips while the terminal owns the session, with a tooltip.
- **Tests:** `ConfirmBar` keyboard (Esc cancels, Enter confirms); the header renders chips per family; the owner chip text.
- **Done when:** live:
  1. Start a Claude turn and click Open in terminal: the inline confirm appears, and Cancel keeps the turn running.
  2. Confirm: the turn stops and the terminal opens.
  3. The branch shows the e2e repo branch.
- **Size:** M · **Deps:** B1, B3, B5 · **Executor:** SONNET

### B3. `git_info.rs` (spec 3.1, 3.5)
- **Files:** `src-tauri/src/git_info.rs` (NEW: `git_status_summary`, `git_diff_files`), `src-tauri/src/lib.rs` (mod + handlers), `src/lib/tauri.ts` (wrappers and types), `src/hooks/useGitSummary.ts` (NEW).
- **Steps:**
  1. Run `git` via `std::process::Command` with `CREATE_NO_WINDOW` on Windows (follow the existing pattern in `process/` or `shell_env.rs`) and a 2 s timeout. Parse porcelain v1 `-z`.
  2. `git_diff_files`: run `git status --porcelain=v1 -z`; for each path, `git show HEAD:<path>` (empty on error) and read from disk. Cap 200 files and 1 MB.
  3. The hook polls every 10 s while visible.
- **Tests:** a porcelain parser on fixture strings (renames, untracked, deleted); a temp-repo integration test gated on `git` being available.
- **Done when:** live, editing a file in the e2e repo shows `±1` in the header within 10 s (after B2), or `useGitSummary` returns `changed: 1` via `cdp.mjs eval` before B2.
- **Size:** S · **Deps:** none · **Executor:** SONNET

### B4. Composer draft persistence (spec 3.2)
- **Files:** `src/lib/composer-drafts.ts` (NEW), `src/components/composer/AgentComposerPanel.tsx`.
- **Steps:**
  1. `getDraft(paneId)` and `setDraft(paneId, text)` keep a module Map and mirror it to `sessionStorage` (`loomria-draft:<paneId>`), inside try/catch, debounced 300 ms.
  2. Initialise `draft` from `getDraft(paneId)`, write on change, and clear on a successful submit.
  3. When `paneId` changes, reload the draft.
- **Tests:** round trip, cleared on send, and the composer remount keeps the text (Vitest with two mounts).
- **Done when:** live, type in pane A, switch to B and back, and the text is there.
- **Size:** S · **Deps:** none · **Executor:** HAIKU

### B5. Composer toolbar regroup, `useAgentControls`, context bar, cost (spec 3.2)
- **Files:** `src/hooks/useAgentControls.ts` (NEW), `src/components/composer/ContextBar.tsx` (NEW), `src/lib/session-cost.ts` (NEW), `src/lib/model-context.ts` (NEW), `src/components/composer/AgentComposerPanel.tsx`, `src/components/agent/ClaudeControlBar.tsx` (remove the mode, model and commands buttons; keep the file only if something remains, else delete it with its test), `src/components/agent/AgentView.tsx`.
- **Steps:**
  1. Build `useAgentControls` for Claude (from `useClaudeInfo` and `changeClaudeOption`) and for OpenCode (existing composer state lifted). Codex returns empty until D3.
  2. Add a generic model pill and mode pill driven by it. The OpenCode agent pill stays.
  3. Context bar from the latest `usage` with `context_tokens`, using the window from the event or `model-context.ts`.
  4. Cost through `session-cost.ts`.
  5. The textarea is disabled only while `busy`.
- **Tests:** context-bar thresholds; the session-cost restart rule; the model-context table; pills render per family; the textarea is enabled while `showStop`.
- **Done when:** live:
  1. Claude: switch model from the pill (the header chip follows after B2).
  2. After one turn the context % and the cost show.
  3. OpenCode model picking is unchanged.
- **Size:** M · **Deps:** A2, B4 · **Executor:** SONNET

### B6. Split and explorer on terminal open (spec 3.1)
- **Files:** `src/hooks/useAgentChatSplit.ts`, `src/components/shell/AppShell.tsx`, `src/components/agent/AgentView.tsx` (drop the inline `'0 0 60%'` default).
- **Steps:**
  1. Without a saved value: default 40 when `innerWidth < 1600`, else 50.
  2. On `showTui` going from false to true, if the explorer is open, collapse it (`patchLayout({explorerCollapsed:true})`) and remember that this code collapsed it. On true to false, restore it only if this code collapsed it and the user has not toggled it since.
  3. Save only on drag (unchanged).
- **Tests:** the hook default with mocked `innerWidth` and storage; collapse and restore logic as a pure helper.
- **Done when:** live at width 1400, Open in terminal makes the chat about 40 % and collapses the explorer. Drag to 55 %, reopen, and it is still 55 %.
- **Size:** S · **Deps:** none (after B1 for the `AgentView` file order) · **Executor:** SONNET

---

## Phase C: slash commands (P0)

### C1. Command model and capability fields (spec 2.4, 2.6)
- **Files:** `src/lib/commands/command-model.ts` (NEW) and its test, `src/lib/agent-capabilities.ts` and its test.
- **Steps:**
  1. Write the types, `buildCommandList`, `parseSlashInput` and `resolveSubmit` exactly as in spec 2.4, with the `CLAUDE_TUI_ONLY` and `CLAUDE_VERIFIED_PASSTHROUGH` constants.
  2. Add `commands`, `effort` and `contextBar` to `AgentCapabilities` with the initial values from spec 2.6.
  3. Set `CLAUDE_CAPABILITIES.questions = true`.
  4. Keep `slashCommands` as before for callers.
- **Tests:**

| Input | Expected |
|---|---|
| `"/"` | `{name:"", args:""}` |
| `"/model opus"` | `{name:"model", args:"opus"}` |
| `"//x"` | plain `"/x"` |
| `"a /b"` | null, plain |
| `"/unknownzz"` | unknown |
| Claude list containing `compact` and `cost` | Loomria actions win |
| `doctor` | terminal |
| OpenCode | no terminal rows when `terminalFallback` is false |

- **Done when:** the commands are green (pure library, no live check).
- **Size:** M · **Deps:** none · **Executor:** SONNET

### C2. Slash menu and composer wiring (spec 3.3)
- **Files:** `src/components/composer/SlashMenu.tsx` (NEW) and its test, `src/hooks/useAgentCommands.ts` (NEW: Claude from `useClaudeInfo`, OpenCode `opencodeClient.listCommands` moved here), `src/components/composer/AgentComposerPanel.tsx` (replace the `picker === 'slash'` popover and the `/` keydown trigger, route submit through `resolveSubmit`, inline error line), `src/components/agent/ClaudeControlBar.tsx` (remove the commands popover if B5 left it), `src/components/agent/AgentView.tsx` (pass `family` and an `onOpenInTerminal(commandName)` handler).
- **Steps:**
  1. The open condition is the regex in spec 3.3, evaluated on change and caret move.
  2. Keyboard handling as specified.
  3. Kind tags, and loading, empty and error states.
  4. Terminal rows: the button runs the owner handover and then types `/name` into the terminal via `write_pane_input`.
  5. The second list for `choices` comes from `useAgentControls` (B5).
  6. Unknown commands show an inline error and the draft is kept.
- **Tests:**
  - keyboard navigation and wrap; Enter and Tab pick; Esc closes; the second list and its back row;
  - the terminal row is not executable by Enter;
  - mid-sentence `/` does not open the menu;
  - unknown `/foo` never calls `onSendProtocol`.
- **Done when:** live, the Claude checks 1, 2 and 4 of spec 3.3 pass, and OpenCode `/` lists its commands.
- **Size:** M · **Deps:** C1, B5 · **Executor:** SONNET

### C3. Spike S7: Claude built-ins over stream-json
- **Goal:** decide `prompt`, `action` or `terminal` for `/compact`, `/cost`, `/context` and `/clear` in headless mode.
- **Steps:** in a Claude pane, send each one as a user message, one per fresh chat. Record the stdout lines (a `system` `compact_boundary`? a text reply? nothing?) and whether the session file changes. Put the findings in `docs/agent-gui-fix-plan.md` Progress and fill `CLAUDE_VERIFIED_PASSTHROUGH` or `compact` in `commands.actions`.
- **Tests:** update the C1 table test for the verified set.
- **Done when:** the findings are written down, and `/compact` is either a working action (with notice) or a terminal row.
- **Size:** S · **Deps:** C1 · **Executor:** SONNET

### C4. Loomria actions executor: Claude and OpenCode (spec 3.3 action table)
- **Files:**
  - `src/lib/commands/execute-command.ts` (NEW);
  - `src-tauri/src/commands.rs` (`session_claude_new(pane_id)`: new uuid, update `PaneState.claude_session_id`, unregister, re-register via `register_claude_headless_protocol`);
  - `src-tauri/src/session/claude_headless.rs` (setter for the session id);
  - `src-tauri/src/lib.rs`, `src/lib/agent-session.ts`;
  - `src/components/composer/AgentComposerPanel.tsx` (call the executor).
- **Steps:** implement model, mode, cost, context, clear, new, resume (second list = Claude past chats from `useClaudePastSessions` for Claude, the session list for OpenCode) and compact (per C3). Each posts a notice (A4). Actions that need the chat process show an error while the terminal owns the session.
- **Tests:** a dispatcher table test with mocked invokes; notice text formats; `session_claude_new` updates the session id (Rust unit test on the registry helper).
- **Done when:** live:
  1. Claude `/cost` and `/context` notices appear with no model call (the hub log shows no new turn).
  2. `/clear` starts an empty chat, and the old one appears in Past chats.
  3. `/resume` lists past chats and opens one.
- **Size:** M · **Deps:** C2, A4, C3 · **Executor:** SONNET

### C5. Prompt-command chip in the user bubble, live and replay (spec 3.3)
- **Files:** `src/components/transcript/TurnRows.tsx` (`UserTurnRow`: a leading `/name` becomes a chip), `src-tauri/src/protocol/claude_session_file.rs` (map `<command-name>`/`<command-args>` records to a user prompt `"/name args"` instead of dropping them; `title_from_head` keeps skipping them).
- **Tests:** chip rendering; the replay mapping from a fixture line; the title is still the first real prompt.
- **Done when:** live, run a skill, restart the app, open the past chat, and the chip shows.
- **Size:** S · **Deps:** A2 · **Executor:** SONNET

### C6. Codex commands: actions and the skills source (spec 3.3)
- **Files:** `src/lib/commands/execute-command.ts`, `src/hooks/useAgentCommands.ts`, `src-tauri/src/commands.rs` (`session_codex_new_thread`), `src-tauri/src/lib.rs`, `src/lib/agent-capabilities.ts`.
- **Steps:**
  1. Codex model, mode and effort via `set_option` (D3).
  2. `/clear` creates a new thread on the same server: a new `CodexWsClient` with `start_thread_blocking`, re-registered under the same pane id. Store the new thread id in `CodexLink`, and note that the attached TUI keeps the old thread (tooltip).
  3. Live-check whether a skill is invoked by `$name` or `/name` in `turn/start` text. Then set `commands.prompt` for Codex.
- **Tests:** dispatcher for Codex; skills list mapping.
- **Done when:** live, Codex `/model` changes the model on the next turn (visible in the meta line), and `/` shows skills if any exist.
- **Size:** S · **Deps:** C4, D3 · **Executor:** SONNET

---

## Phase D: Codex correctness (P0)

### D1. Fix the Codex question answer path and redact logs (contradictions 1 and 2)
- **Files:** `src-tauri/src/protocol/codex_app_server.rs`, `src-tauri/src/commands.rs` (the `session_respond_approval` log line).
- **Steps:**
  1. In `respond_to_approval`: if the decision starts with `claude_stream_json::ANSWER_PREFIX`, call `respond_approval_rpc(id, decision)` directly and emit `ApprovalResolved{AllowOnce}`. Otherwise parse as today.
  2. Log a `decision_kind` (`answer` for an answer) instead of `decision`.
- **Tests:** a session-level test with a fake `CodexWsClient` stand-in: put `respond_approval_rpc` behind a small trait, or test the decision-routing helper `route_decision(&str) -> Routed` as a pure function. A `tracing` capture asserts the answer text is not logged.
- **Done when:** live, ask Codex (tiny) to ask the user to pick a colour with the request-user-input tool. Pick one in the dock, and Codex continues using it.
- **Size:** S · **Deps:** none · **Executor:** SONNET

### D2. Codex approval payloads and question dock fields (spec 2.3, 3.7.1)
- **Files:** `src-tauri/src/protocol/codex_notifications.rs` (payload for command, fileChange, permissions, legacy and requestUserInput, with `allow_other`/`secret`/`auto_resolution_ms`), `src/lib/protocol-questions.ts`, `src/components/opencode/QuestionDock.tsx` (password input for `secret`, countdown line), `src/components/agent/AgentView.tsx` (pass the receive time).
- **Tests:** a Rust payload per method; dock renders a password input; the countdown text with fake timers; a secret value never appears in `answerDecision` logs (no console calls).
- **Done when:** live checks 1 to 3 of spec 3.7.
- **Size:** M · **Deps:** A1, A2, D1 · **Executor:** SONNET

### D3. Codex presets, model, effort, `agent_info`, `thread_ready` (spec 3.7.3, contradiction 10)
- **Files:**
  - `src-tauri/src/protocol/types.rs` (`CodexPreset`);
  - `protocol/codex_ws.rs` (after the handshake: `model/list` stored; per-turn `model`/`effort`/policy from mutable options; `thread_ready()`);
  - `codex_ws_stub.rs`, `protocol/codex_app_server.rs` (`agent_info`, `set_option` for `preset`, `model`, `effort`);
  - `codex/dual.rs` (pass the preset to `start_thread_blocking`), `codex/protocol.rs` (`codex: Some(...)`);
  - `src/hooks/useAgentControls.ts` (Codex branch), `src/components/agent/ConfirmBar.tsx` (Full access warning), `src/components/composer/AgentComposerPanel.tsx` (Send disabled until `thread_ready`).
- **Steps:**
  1. Map the presets as in the spec, and write the sandbox tagged form as in the existing `send_turn_with_policy`.
  2. The `localStorage` default preset.
  3. Keep `LOOMRIA_CODEX_TURN_APPROVAL`.
- **Tests:** preset to thread and turn params (extend `start_thread_blocking_persists_thread_before_returning` to assert `thread/start` carries `approvalPolicy` and `sandbox`); `set_option` changes the next `turn/start` params (socket test); the `agent_info` shape.
- **Done when:** live check 8 of spec 3.7 (Read only refuses an edit), and the model pill lists the `model/list` entries. Flip `CODEX_CAPABILITIES.models`/`permissionModes` in the same commit.
- **Size:** M · **Deps:** A1, B5 · **Executor:** SONNET

### D4. Codex Stop cancels pending requests (spec 3.7.5)
- **Files:** `src-tauri/src/protocol/codex_ws.rs` (`interrupt` first drains `pending_requests` with the method-specific cancel reply), `protocol/codex_app_server.rs` (emit `ApprovalResolved{Deny}` per drained id; no active turn returns Ok).
- **Tests:** a socket test asserting the order (cancel reply, then `turn/interrupt`); a reply shape per method; the no-turn case returns Ok.
- **Done when:** live checks 6 and 7 of spec 3.7.
- **Size:** S · **Deps:** D3 · **Executor:** SONNET

### D5. Visible Codex fallback with Retry (spec 3.7.4)
- **Files:** `src-tauri/src/pty/registry.rs` (`PaneInfo.fallback_error: Option<String>`, `#[serde(default, skip_serializing_if)]`), `src-tauri/src/codex/dual.rs` (set it in `fallback_pty`, and route a `thread/start` failure to the fallback), `src-tauri/src/commands.rs` (`codex_retry_app_server(pane_id)`), `src-tauri/src/lib.rs`, `src/lib/tauri.ts`, `src/hooks/usePaneRegistry.ts` (type), `src/components/agent/AgentView.tsx` (banner and Retry; use `PaneInfo` for the selected pane).
- **Tests:** a Rust test that `fallback_pty` sets the field (helper extracted); a banner render test.
- **Done when:** live check 9 of spec 3.7 (set `PATH` without codex for the app-server only, or point the manifest at a bad port in a test config). The banner shows; Retry with codex back on `PATH` gives a chat.
- **Size:** M · **Deps:** D3 · **Executor:** SONNET

### D6. Codex notices, plan, live output, file-change input (spec 2.2 producers, 3.4.1)
- **Files:** `src-tauri/src/protocol/codex_notifications.rs`.
- **Steps:**
  1. Map `warning`, `configWarning`, `guardianWarning`, `deprecationNotice`, `model/rerouted` and `thread/compacted` to `Notice` (id = method, plus the item or turn id). Take the text from `params.message`, else `params.summary`, else compact JSON. Confirm the field names in the S5 schema dir.
  2. Map `turn/plan/updated` to `PlanUpdated` (status `inProgress` becomes `in_progress`, `completed` becomes `done`).
  3. Map `item/commandExecution/outputDelta` to `ToolOutputDelta{tool_id: itemId}`.
  4. `fileChange` `ToolStarted.input_summary` becomes `{"changes":[{path,kind,diff}]}` JSON.
  5. Make `map_item_completed` `pub` and add a `userMessage` arm (user text from `content[].text`); it is used by D8 only, because live user messages are emitted by `codex_ws.rs` `emit_user_message`, so the live path must skip `userMessage` to avoid duplicates. Add a flag argument `replay: bool`.
- **Tests:** a mapping test per method using fixture lines (outputDelta is from `codex_raw_turns.jsonl`); `userMessage` mapped only in replay.
- **Done when:** live, Codex `ping -n 5 127.0.0.1` streams output (needs E3 for rendering; before E3, check the envelopes via `cdp.mjs eval`), and a plan appears in the rail after F2.
- **Size:** M · **Deps:** A1, D2 · **Executor:** SONNET

### D7. Codex MCP elicitation (spec 3.7.2)
- **Files:** `src-tauri/src/protocol/codex_notifications.rs` (classifier and payload), `src-tauri/src/protocol/codex_ws.rs` (`approval_reply` for `mcpServer/elicitation/request`: accept, decline and cancel), `src/lib/protocol-questions.ts`, `src/components/opencode/QuestionDock.tsx` (field kinds: enum, boolean, text, number), `src/components/opencode/PermissionDock.tsx` (Accept/Decline labels for the elicitation payload).
- **Tests:** classifier table (simple and complex schemas); reply builders; dock field rendering.
- **Done when:** if an MCP server with elicitation is available locally, a live accept and decline. Otherwise mark it "unit-only, not seen live" in Progress (a known gap, like `item/permissions/requestApproval`).
- **Size:** M · **Deps:** D2, D6 · **Executor:** SONNET

### D8. Codex resume and history replay (spec 3.6)
- **Files:** `src-tauri/src/codex/dual.rs` (use `args.resume_session_id` as the thread id; skip `start_thread_blocking`), `src-tauri/src/codex/protocol.rs` (after register: `thread/read` then `seed_history`), `src-tauri/src/protocol/codex_ws.rs` (`request_once(ws_url, method, params, timeout)` NEW helper), `codex_ws_stub.rs`, `src-tauri/src/protocol/codex_notifications.rs` (`map_thread_turns(turns) -> Vec<AgentEvent>`), `src-tauri/tests/fixtures/codex_thread_read.json` (NEW; capture live, remove personal data).
- **Steps:**
  1. Confirm the `thread/read` params and reply in the schema.
  2. Wrap each turn in `TurnStarted` and `TurnCompleted` (status from `turn.status`).
- **Tests:** turns to events from the fixture; the `dual.rs` thread-id choice as a pure helper.
- **Done when:** live, Codex chat with 2 turns, close the pane, reopen via `spawn_pane` with `resume_session_id` (devtools until D9): the full transcript is there and the next prompt has memory.
- **Size:** M · **Deps:** D5, D6, A3 · **Executor:** SONNET

### D9. Codex past chats list, archive and delete (spec 3.6)
- **Files:** `src-tauri/src/codex/catalog.rs` (NEW), `src-tauri/src/codex/mod.rs`, `src-tauri/src/commands.rs` (`codex_list_threads`, `codex_archive_thread`, `codex_delete_thread`), `src-tauri/src/lib.rs`, `src-tauri/src/app_lifecycle.rs` (kill the catalog server on exit), `src/lib/tauri.ts`, `src/hooks/useCodexPastSessions.ts` (NEW), `src/lib/shell-data.ts` (`codexResumeId` rows), `src/components/sessions/SessionsSidebar.tsx` and `src/components/shell/SidebarPanel.tsx` and `src/components/shell/AppShell.tsx` (`onResumeCodexSession`), `src/components/sessions/SessionRow.tsx` and `SessionContextMenu.tsx` (Archive and Delete for Codex rows, Delete confirm).
- **Steps:**
  1. Start the catalog server lazily: spawn via `spawn_manifest_server` with the Codex manifest; register the port; cache 30 s.
  2. Exclude threads open in panes (`PaneState.codex.thread_id`).
  3. Title rule from spec 3.6.
- **Tests:** the reply to `PastThread` mapping; the exclusion of open threads; the menu shows only for Codex rows; the hook refetch key.
- **Done when:** spec 3.6 live check (restart, Codex past row, click, full transcript, archive hides the row). Kill the app and verify no orphan `codex app-server` stays (Task Manager or `Get-Process codex`).
- **Size:** L · **Deps:** D8 · **Executor:** SONNET

### D10. Codex live verification sweep
- **Steps:** run spec 3.7 live checks 1 to 10 in one session, including S6 (a GUI turn visible in Show TUI and the reverse). Write the results into `docs/agent-gui-fix-plan.md` Progress and the S6 result into `docs/codex-protocol-notes.md`. Flip any remaining Codex flags.
- **Done when:** every check is recorded as pass, or as fail with a follow-up task.
- **Size:** S · **Deps:** D2, D3, D4, D5, D7 · **Executor:** SONNET

---

## Phase E: transcript (P0)

### E1. Compact tool rows, duration, diff stat (spec 3.4.1)
- **Files:** `src/components/transcript/ToolCard.tsx`, `src/components/transcript/tool-render.ts`, `src/lib/transcript/from-agent-events.ts` (record `ts_ms` into `startedAtMs`/`endedAtMs`; skip when replayed), `src/lib/transcript/diff-stat.ts` (NEW), `src/lib/transcript/tool-mapping.ts` (parse the Codex fileChange JSON input).
- **Tests:** `diffStat` for Claude Edit, MultiEdit and Write and a Codex diff; duration hidden under 500 ms and for replayed tools; header order snapshot.
- **Done when:** live, a Claude edit shows `+N −M` and a duration on its row.
- **Size:** M · **Deps:** A2, A3 · **Executor:** SONNET

### E2. Tool-call grouping (spec 3.4.2)
- **Files:** `src/lib/transcript/group-tools.ts` (NEW), `src/components/transcript/TurnRows.tsx` (`AssistantTurnBlock` maps items through the grouper), `src/components/transcript/TranscriptItemView.tsx` (`ToolGroupRow`).
- **Tests:** the table in spec 3.4 acceptance; stable group id while appending.
- **Done when:** live check 2 of spec 3.4. OpenCode turns with several tools also group.
- **Size:** M · **Deps:** E1 · **Executor:** SONNET

### E3. Live command output (spec 3.4.3)
- **Files:** `src/lib/transcript/live-output.ts` (NEW, with `stripAnsi`), `src/hooks/useAgentSession.ts` (route `tool_output_delta` to the live-output store and not to the envelope log), `src/components/transcript/ToolCard.tsx` (live box while running).
- **Tests:** ring cap, `\r`, ANSI stripping, discard on complete, a delta before start.
- **Done when:** live check 1 of spec 3.4.
- **Size:** S · **Deps:** E1, D6 · **Executor:** SONNET

### E4. Diffs in edit approvals (spec 3.4.4)
- **Files:** `src/components/transcript/InlineDiff.tsx` (NEW), `src/components/opencode/PermissionDock.tsx` (`PermissionDockItem.diff?: {path, before?, after?, patch?}` built from the payload; render `InlineDiff`; the "Show full diff" modal with the lazy Monaco `DiffEditor` as in `ReviewPanel.tsx`), `src/lib/editor/read-before.ts` (NEW: `fs_read_file` wrapper for Write).
- **Tests:** line diff correctness; the card renders a diff for each payload variant; a missing file means "New file".
- **Done when:** live check 3 of spec 3.4 (Claude). For Codex, after D2, a file-change approval shows the patch.
- **Size:** M · **Deps:** A2, A5 (and after G3 if both are in flight, same file) · **Executor:** SONNET

### E5. Claude notices and the sticky-chip UI (spec 2.2, 3.4.5)
- **Files:** `src-tauri/src/protocol/claude_stream_json.rs` (`system/init` `claude_code_version` against a process-wide `Mutex<HashMap<session_id, version>>` gives the "Claude updated to X" notice; `system` `compact_boundary` gives the "Context compacted" notice), `src/components/agent/StickyNotices.tsx` (NEW, above the composer), `src/components/agent/AgentView.tsx`, `src/components/transcript/TranscriptView.tsx` (wire `onNoticeAction`).
- **Tests:** a mapper test with two init lines of different versions; compact_boundary; StickyNotices add and clear.
- **Done when:** live, after C3's `/compact` (if verified) the "Context compacted" row shows. The version notice is unit-tested only unless Claude updates during testing.
- **Size:** S · **Deps:** A1, A2, A5 · **Executor:** SONNET

### E6. Reasoning collapsed by default (contradiction 13)
- **Files:** `src/components/transcript/TranscriptItemView.tsx` (remove `defaultOpen` in `case 'reasoning'`; label "Thinking…" while streaming), `TranscriptItemView.test.tsx`.
- **Tests:** a reasoning item renders collapsed and expands on click.
- **Done when:** live, a Codex or Claude reasoning block is collapsed.
- **Size:** S · **Deps:** none · **Executor:** HAIKU

### E7. Profile and fix smoothness (spec 3.4.7)
- **Files:** `src/lib/transcript/from-agent-events.ts` (incremental builder), `src/lib/transcript/use-transcript-view-model.ts`, `src/hooks/useAgentSession.ts`, `src/components/transcript/TranscriptView.tsx` (ResizeObserver stick-to-bottom), `TurnRows.tsx` and `TranscriptItemView.tsx` and `ToolCard.tsx` (`React.memo`), `src/components/transcript/MarkdownBody.tsx` (stable prefix).
- **Steps:**
  1. Record the baseline (Profiler and trace via `cdp.mjs`, for the two scenarios in the spec), and save the numbers in Progress.
  2. Apply fixes (a) to (d) only where the profile points.
  3. Record the results.
- **Tests:** the incremental builder equals the full rebuild on the contract fixture and on randomised sequences; untouched turn references are stable; a scroll test (jsdom: no scroll when not stuck).
- **Done when:** the acceptance numbers in spec 3.4 hold live.
- **Size:** L · **Deps:** E1, E2, E3, A3 · **Executor:** OPUS

---

## Phase F: right rail and info (P1)

### F1. Claude TodoWrite to `PlanUpdated`, live and replay
- **Files:** `src-tauri/src/protocol/claude_stream_json.rs` (`tool_started`: if the name is `TodoWrite`, also push `PlanUpdated`), `src-tauri/src/protocol/claude_session_file.rs` (same in `map_assistant`).
- **Tests:** status mapping (`completed` becomes `done`), live and replay.
- **Done when:** unit only. The live check is in F2.
- **Size:** S · **Deps:** A1, A5 · **Executor:** HAIKU

### F2. Right rail for protocol panes (spec 3.5)
- **Files:** `src/lib/agent-envelope-store.ts` (NEW: per-pane envelopes published by `useAgentSession`), `src/lib/protocol-summary.ts` (NEW), `src/hooks/useAgentSession.ts`, `src/lib/shell-data.ts` (`useSessionSummary` protocol branch), `src/components/shell/RightRail.tsx` (Todo, Files changed, Usage and Agent sections; account moved here).
- **Tests:** `selectProtocolSummary` fixture; the rail renders the sections; it is hidden when empty.
- **Done when:** spec 3.5 live check 1, and the Codex plan shows (D6).
- **Size:** M · **Deps:** A3, F1, D6, B5 · **Executor:** SONNET

### F3. Review panel for Claude and Codex panes (spec 3.5, contradiction 3)
- **Files:** `src/components/review/ReviewPanel.tsx` (use `git_diff_files` when the pane is not `opencode_native`; `initialPath` prop), `src/lib/editor/git-diff.ts` (NEW wrapper), `src/components/shell/RightRail.tsx` (file click opens Review).
- **Tests:** ReviewPanel picks the source by pane type (mock both); `initialPath` selects the index.
- **Done when:** spec 3.5 live check 2.
- **Size:** S · **Deps:** B3, F2 · **Executor:** SONNET

### F4. Codex rate limits on open
- **Files:** `src-tauri/src/protocol/codex_ws.rs` (send `account/rateLimits/read` after the handshake; map the reply through the `account/rateLimits/updated` logic, made a shared helper in `codex_notifications.rs`).
- **Tests:** reply mapping (limited and not limited).
- **Done when:** unit plus a live smoke test (no error notice on open).
- **Size:** S · **Deps:** D3, D9 (same file order) · **Executor:** HAIKU

### F5. Subagents and MCP status
- **Files:** `src/lib/protocol-summary.ts`, `src/components/shell/RightRail.tsx`, `src/lib/claude-info.ts` (parse `agents`).
- **Tests:** parse and render.
- **Done when:** live, the Claude rail lists agents from `initialize`.
- **Size:** S · **Deps:** F2 · **Executor:** SONNET

---

## Phase G: Claude extras (P1)

### G1. Effort and fast mode (spec 3.8.1, spike S4)
- **Files:** `src-tauri/src/protocol/claude_stream_json.rs` (control request or spawn flag), `src-tauri/src/commands.rs` (restart helper reusing `register_claude_headless_protocol`), `src/hooks/useAgentControls.ts`, `src/lib/claude-info.ts` (`supportedEffortLevels`), `src/lib/agent-capabilities.ts`.
- **Steps:** run S4 and write the result in Progress. Implement the path S4 supports.
- **Tests:** option mapping; the effort list is filtered by model.
- **Done when:** live, set effort, and the next turn carries it (from the init line or the result). Flip `effort`.
- **Size:** M · **Deps:** B5, A3, C4 · **Executor:** SONNET

### G2. Waiting-in-terminal chip (spec 3.8.2)
- **Files:** `src-tauri/src/protocol/claude_mirror.rs` (open tool tracking, a `last_output` closure argument, and the sticky notice emit and clear), `src-tauri/src/commands.rs` (`start_claude_mirror` passes a closure that reads `PaneState.last_output` of the TUI pane), `src/terminal/terminal-session-registry.ts` (`focusTerminalSession`), `src/components/agent/StickyNotices.tsx` (FocusTerminal action).
- **Tests:** the pure timer function; the mirror emits on the tick (temp-file test like `tailer_emits_records_appended_after_start`).
- **Done when:** spec 3.8 live check 2.
- **Size:** M · **Deps:** E5 · **Executor:** SONNET

### G3. "Always allow" caption (spec 3.8.3)
- **Files:** `src/components/opencode/PermissionDock.tsx` (`alwaysCaption` field and render), `PermissionDock.test.tsx`, `src/components/agent/AgentView.tsx` (pass the family into `buildPermissionDockItems`).
- **Tests:** the caption is shown for Claude only.
- **Done when:** live, a Claude permission dock shows the caption.
- **Size:** S · **Deps:** none · **Executor:** HAIKU

### G4. Claude attachments (spec 3.8.4)
- **Files:** `src-tauri/src/protocol/types.rs` (`PromptAttachment`; `send_prompt_with` default method), `session/protocol_hub.rs` and `protocol_hub_stub.rs` (`send_prompt_with`), `protocol/claude_stream_json.rs`, `protocol/claude_session_file.rs` (image chips on replay), `src-tauri/src/commands.rs` (`SessionSendPromptArgs.attachments`), `src/lib/agent-session.ts`, `src/components/composer/AgentComposerPanel.tsx` (base64 encode via the existing `lib/opencode/encode-attachment.ts` helpers), `src/lib/agent-capabilities.ts`.
- **Tests:** content block builder; size and type limits; hub stub `send_prompt_with`; the TS payload.
- **Done when:** spec 3.8 live check 3. Flip `attachments` and `fileMentions` for Claude.
- **Size:** M · **Deps:** B5, A1 · **Executor:** SONNET

### G5. Claude question live checks
- **Steps:** live checks for a multi-select question, the free-text "Other" path, and plan "Keep planning". Fix small issues found in `protocol-questions.ts` or `QuestionDock.tsx`, or file a task.
- **Done when:** results recorded in Progress.
- **Size:** S · **Deps:** D2 · **Executor:** SONNET

---

## Phase H: advanced (P2, spec 3.9; write a short spec addendum per task first)

| Id | Title | Size | Deps | Executor |
|---|---|---|---|---|
| H1 | Fork: Claude `--fork-session` in a new pane, Codex `thread/fork`, "Fork from here" on user rows | L | C4, D8 | SONNET |
| H2 | Rewind: Codex `thread/revert`, Claude spike, "Rewind to here" | M | H1 | OPUS (design of state across owner handover) |
| H3 | Codex compact and review: `thread/compact/start`, `review/start` | M | D8, E5 | SONNET |
| H4 | Steer: send while running (Codex `turn/steer`, Claude spike) | M | B5, D4 | SONNET |

---

## Task count and lanes

There are 48 tasks: A1 to A5, B1 to B6, C1 to C6, D1 to D10, E1 to E7, F1 to F5, G1 to G5 and H1 to H4. 44 are P0 or P1 (A to G); 4 are P2 (H).

Suggested parallel lanes after the first sprint:
- **Rust Claude lane:** A5 → F1 → E5 → G2 → G1 → G4.
- **Rust Codex lane:** D2 → D3 → D4 → D6 → D5 → D7 → D8 → D9 → F4 → D10.
- **UI lane 1:** B6 → B5 → B2 → C2 → C3 → C4 → C6.
- **UI lane 2:** C5 → E1 → E2 → E3 → E4 → E7.
- **Rail:** F2 → F3 → F5.
- **Small HAIKU fillers:** G3, F1, F4.

Cross-lane file conflicts are listed in the files table above. When two lanes need the same file, the earlier task in that table goes first.
