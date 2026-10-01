# Agent GUI fix plan: Claude and Codex

Date: 2026-10-01. Branch `rebuild/main`. Builds on `docs/agent-gui-handoff.md` (read that first for file maps and test gotchas).
Goal: the GUI feels like Claude Desktop. Nobody needs the terminal to get work done. Simple, not clever.

---

## 0. Summary

| Area | Proposed fix | Size |
|---|---|---|
| Claude drift (two processes) | **One owner at a time.** Only one `claude` process ever holds the session. The chat process by default; "Open in terminal" stops it and resumes the same session in a PTY; "Back to chat" does the reverse. The saved session file is the only source of truth. | L |
| Claude history after restart | Parse `~/.claude/projects/<cwd>/<id>.jsonl` in Rust and replay it into the hub on open. The handoff above needs the same parser. | M |
| Past conversations (both agents) | Claude: scan the projects folder. Codex: `thread/list`. One shared "Past chats" list in the sidebar. | M |
| Codex hangs (questions, elicitation, unknown requests) | Map `item/tool/requestUserInput` to the existing question dock, map elicitation, and **always answer any server request we don't understand** with a JSON-RPC error so a turn can never hang. | S |
| Codex wrong reply shapes | Remember each request's method; build the reply for that method. | S |
| Codex silent fallback | Show a banner with the error and a "Retry" button instead of quietly becoming a terminal. | S |
| Not smooth | Live command output, then profile. The hub already coalesces deltas; suspect React re-render of the whole transcript. | M |
| Parity features | Todo list, edit diffs in approvals, model/effort/mode pickers, `/` in composer, attachments, banners, usage | M each |
| Advanced | Fork, rewind, compact, review, steer | later |

Recommended order: **Phase 0 (commit + spikes), 1 (shared plumbing), 2 (Claude single owner), 3 (Codex correctness), 4 (parity), 5 (smoothness and layout), 6 (advanced).** Phases 2 and 3 are independent and can run in parallel.

---

## 1. The Claude problem and the fix

### 1.1 Why it breaks
The chat is a headless `claude -p` process. "Show TUI" starts a second `claude --resume` in a terminal. Both are live and both write the same session. Neither sees what the other does, so they drift. The current "Sync terminal" banner restarts the terminal after each chat reply; it only covers one direction and it makes the user do the work.

### 1.2 Options

| | A. Keep both, sync harder | B. Terminal first (the user's current lean) | C. One owner at a time (recommended) |
|---|---|---|---|
| Processes alive | 2 | 1 (PTY) | 1 (chat **or** PTY) |
| Live token streaming in GUI | yes | no (the session file is written per message, not per token) | yes in chat mode; per message while the terminal drives |
| Permissions, questions, plan approval in GUI | yes (verified) | screen-scrape the TUI and press keys; breaks when Claude updates itself (it did mid-session) | yes in chat mode (all the verified work stays); answered in the terminal while the terminal drives |
| Model, mode, slash commands | control requests (verified) | type slash commands into the PTY | control requests |
| Drift possible | yes | no | **no** |
| Reuses this session's verified work | yes | mostly thrown away | yes |
| New code | sync heuristics forever | screen parser, key driver, file tail | file parser + tail (needed for history anyway), handoff state machine |

Option B gives up the parts that already work (structured approvals, streaming, control requests) and swaps them for screen-scraping, the most fragile approach on the table. Option C keeps the GUI as the default way to work and still gives the full TUI. It removes drift by construction: one writer at a time.

The user's point, "the GUI is basically just turning the TUI into a GUI", still holds under C: the user never thinks about two processes. There is one conversation, and one button decides where to drive it from.

### 1.3 How option C works

State per Claude pane (Rust, `session/claude_headless.rs` grows a small state machine; frontend mirrors it in `useAgentSession`):

```
         open / resume
              │
              ▼
   ┌──────── Chat ◄──────────────┐
   │  claude -p (stream-json)    │  "Back to chat" (terminal idle, or user confirms stop)
   │  owns the session           │  → stop PTY, start claude -p --resume <id>,
   │                             │    replay session file into transcript
   │ "Open in terminal"          │
   │ (chat idle, or user         │
   │  confirms Stop)             │
   ▼                             │
 Handoff ──► Terminal ───────────┘
  stop -p,     claude --resume <id> in PTY owns the session.
  wait exit    GUI tails the session file: new user/assistant/tool
               messages appear in the transcript as they are written.
               Composer types into the PTY. Approvals are answered in the terminal.
```

Details:
1. **Single source of truth.** The session id and the session file. Take the id from each process's `system/init` message every time; do not assume it stays the same across `--resume` (spike S1 checks this).
2. **Chat to terminal.** If a turn is running, the button reads "Stop and open in terminal" and sends `interrupt` first. Then close stdin, wait for exit (2 s, then kill), and spawn `claude --resume <id>` in the companion PTY (the existing `tui-companions.ts` pane, unchanged in layout).
3. **While the terminal drives.**
   - Transcript: the Rust tailer (`notify` watcher on the file, read new lines from the last offset) emits normal `AgentEvent`s through the hub. One code path for history and live mirroring.
   - Composer stays enabled and writes into the PTY: bracketed paste (`ESC[200~ text ESC[201~`) then `\r`, so multi-line text is not sent line by line.
   - Permission and question docks are hidden. If the file shows a `tool_use` with no `tool_result` and the PTY has been quiet for about 1 s, show a chip: "Claude is waiting for you in the terminal" that focuses it.
   - Stop button sends `Esc` to the PTY (the TUI's interrupt key).
   - Model/mode pickers are disabled with a tooltip "Switch back to chat to change this". This is simpler than mirroring slash commands.
4. **Terminal to chat.** Idle means the last assistant entry has `stop_reason: end_turn` and the PTY is quiet. If idle: write `/exit\r`, wait, kill after 2 s. If not idle: confirm "Claude is still working in the terminal. Stop it and go back to chat?" then `Esc`, then `/exit`. Then spawn `claude -p ... --resume <id>`; the transcript already has everything from the file.
5. **What goes away:** the sync banner, `syncedTurns`, `tuiNeedsSync`, `countAssistantTurns` in `tui-companions.ts`, the `fresh` flag on `session_open_in_tui`, and the `SHOW_CLAUDE_TUI_TOGGLE` question (the toggle becomes this handoff and stays on).
6. **Closing the pane** in either state kills whichever process owns it. Reopening resumes in chat mode.

Risks and how to handle them:
- *The `-p --resume` session id changes* (spike S1). If it does, follow the new id from `system/init` and point the tailer at the new file. The plan works either way.
- *The TUI writes the file late.* Verified it writes the file; spike S2 measures the lag per message. If it is more than ~1 s, add a small "terminal is working" indicator driven by PTY output.
- *The user types directly in the terminal while the composer also sends.* Both go to the same PTY, so there is still one writer. No conflict.

### 1.4 If the user still prefers terminal first
Phase 1's parser and tailer are exactly what option B needs, so no work is wasted. The extra work for B is the prompt detector and key driver (port from `C:\Users\Ren-pc\Desktop\work2\puppet-master`). Make this choice before Phase 2, not before Phase 1.

---

## 2. Phases

Each task lists: **What**, **Where**, **Done when** (verified live in the app, not only unit tests).

### Phase 0: Bank the current work and run spikes (half a day)

0.1 **Commit the working tree** in the five commits suggested in the handoff §7. Leave out `package-lock.json` and `Cargo.toml` line-ending noise. Nothing else starts until this is done; the tree is too large to carry uncommitted.

0.2 **Fix the feature-less Rust build** (Codex stubs). Every later phase changes `protocol_hub.rs` and `protocol_hub_stub.rs` together; a broken build hides stub drift.

0.3 **Spikes** (one tiny prompt each, in `%TEMP%\loomria-e2e-repo`):
- S1: does `claude -p --resume <id>` keep `<id>` or start a new one? Does the TUI `--resume` keep it?
- S2: how soon after each message does the TUI write the session file? Are tool results written before or after the permission prompt?
- S3: which jsonl record types appear (`user`, `assistant`, `summary`, `system`, sidechain records with `isSidechain`, `isMeta`)? Save one real file as a test fixture (remove anything personal).
- S4: does `system/init` include the Claude version? Is there a control request for effort (check `initialize` → `models[].supportedEffortLevels`; try `set_effort`/`apply_flag_settings`; check `claude --help` for `--effort`)?
- S5: Codex: run `codex app-server generate-json-schema --out <dir>` and save the reply types for `item/permissions/requestApproval`, `execCommandApproval`, `applyPatchApproval`, `item/tool/requestUserInput`, `mcpServer/elicitation/request` into `docs/codex-protocol-notes.md`.
- S6: Codex: does a GUI-sent turn appear in the attached TUI and the reverse? (Handoff says unverified.)

### Phase 1: Shared plumbing (both agents)

1.1 **New event types** in `protocol/types.rs` (+ `event_contract.rs`, `lib/agent-events.ts`, `agent-timeline-reducer.ts`):
- `PlanUpdated { items: [{ text, status: pending|in_progress|done }] }` (Claude TodoWrite, Codex `turn/plan/updated`).
- `ToolOutputDelta { tool_id, chunk }` (Codex `item/commandExecution/outputDelta`; Claude has no equivalent, fine).
- `Notice { level: info|warning, text, id }` (Codex warnings, reroutes, deprecations, compaction; Claude self-update; fallback errors).
- `ApprovalRequested` gains an optional `payload: Value` with structured data (question list, proposed edit as old/new text, plan text). The question dock already reads Claude questions this way through `protocol-questions.ts`; generalise it.

1.2 **History replay into the hub.** `ProtocolHub::seed_history(pane_id, events)` that pushes events before the live stream starts, marked `replayed: true` so the UI does not animate or notify for them.

1.3 **Claude session file module** `src-tauri/src/claude/session_file.rs`:
- `session_path(cwd, id)`: encoded cwd (every non-alphanumeric char becomes `-`; confirm against S3 on Windows paths like `C:\Users\...`).
- `parse(lines) -> Vec<AgentEvent>`: user text, assistant text, thinking, `tool_use` → `ToolStarted`, `tool_result` → `ToolCompleted`, TodoWrite input → `PlanUpdated`. Skip `isMeta`, sidechains (show later as subagents), and summaries (use as the title).
- `tail(path, from_offset)`: `notify` watcher, read complete lines only (keep a partial-line buffer).
- `list(cwd) -> [{id, title, updated_at, message_count}]`: title = `summary` record, else the first user message, trimmed. Read only the head and tail of each file so the list is fast.
- Tests use the S3 fixture.

1.4 **Codex history**: `thread/read` (with turns) and `thread/items/list` mapped through the existing item mapper in `codex_notifications.rs` (`item/completed` path), so replay and live events share one mapper.

1.5 **Past chats list** in the sidebar, under each project, for both agents (`lib/sessions/merge-sessions.ts` already merges sources; add the two new sources). Click → open a pane that resumes that session: Claude `--resume <id>` in chat mode; Codex `thread/resume`. Archive/delete only for Codex at first (`thread/archive`, `thread/delete`); Claude has no API for this, so leave it out.

Done when: restart the app, reopen a Claude and a Codex conversation, and see the full transcript; the past chats list shows both.

### Phase 2: Claude single owner (option C)

2.1 State machine in `session/claude_headless.rs` (`Chat | HandingOff | Terminal | HandingBack`), exposed through a `session_claude_owner` event and two commands, `session_claude_to_terminal(pane_id)` and `session_claude_to_chat(pane_id, force)`. These replace `session_open_in_tui`'s `fresh` path.
2.2 Stop and restart of the `-p` process with `--resume <id>`, taking the id from `system/init`.
2.3 Tailer bound to the pane while in `Terminal`, feeding the hub (from 1.3).
2.4 Composer → PTY writer (bracketed paste + `\r`), Stop → `Esc`, "waiting in terminal" chip.
2.5 UI in `AgentView.tsx`: one button, "Open in terminal" / "Back to chat", with the confirm dialogs from §1.3. Delete the sync banner and the dead helpers in `tui-companions.ts` (update its tests).
2.6 Show Claude's version from S4; when it changes between spawns, emit a `Notice`: "Claude updated to 2.1.x".

Done when, live: send in chat → open in terminal (shows the chat) → type in the terminal → the reply appears in the GUI → back to chat → send again → Claude remembers what was said in the terminal. Repeat with a turn running at each switch.

### Phase 3: Codex correctness

3.1 **Never hang.** In `codex_ws.rs`, any server request (`id` + `method`) that the mapper returns nothing for gets an immediate JSON-RPC error reply (`-32601`, "not supported by Loomria") and a `Notice`. That guards against future methods too.
3.2 **Questions.** Map `item/tool/requestUserInput` to `ApprovalRequested { kind: Question, payload: questions }`. Reply `{ answers: { <questionId>: { answers: [label or free text] } } }`. Handle `isOther` (free text) and `isSecret` (password input, never logged). Honour `autoResolutionMs` with a visible countdown. Set `questions: true` in `CODEX_CAPABILITIES`.
3.3 **Elicitation.** Map `mcpServer/elicitation/request` to the question dock when its schema is simple (strings, enums, booleans). Otherwise show "Accept / Decline" with the message. Reply `{ action, content }` (confirm the exact shape with S5).
3.4 **Reply shapes.** `codex_ws.rs` keeps `pending: HashMap<request_id, method>`; `respond_approval_rpc` looks the method up:
- `item/commandExecution|fileChange/requestApproval` → `{decision: accept | acceptForSession | decline}`; Stop while an approval is open → `cancel`.
- `execCommandApproval` / `applyPatchApproval` → `{decision: approved | approved_for_session | denied | abort}`.
- `item/permissions/requestApproval` → `{permissions, scope: turn|session, strictAutoReview}`: Allow once echoes the requested permissions with scope turn, Always with scope session, Deny with empty permissions (confirm with S5).
- Add `execCommandApproval` and `applyPatchApproval` to `map_codex_server_request`; today they fall through to `_ => Vec::new()` and hang the turn. Delete the dead approval arm in `map_codex_notification` (`codex_notifications.rs` around line 427): server requests never reach it, because `codex_ws.rs` sends anything with an `id` straight to `map_codex_server_request`.
3.5 **Visible fallback.** In `codex/dual.rs`, when app-server fails, emit a `Notice` with the error and offer "Retry with chat" next to the terminal, instead of silently becoming PTY-only.
3.6 **Approval policy.** The dual path creates the thread with default options and may follow the user's `~/.codex/config.toml`. Pass the GUI's chosen mode explicitly on `thread/start` and `turn/start` (see 4.5), defaulting to `on-request` + `workspace-write`.
3.7 **Review panel.** Set `file_changes: true` in `codex_app_server.rs` now that `turn/diff/updated` is mapped; check the Review panel shows Codex diffs.
3.8 **Live tests:** Reject, Always allow (second identical command runs without asking), Stop during a command and during an approval, a question, and S6 (GUI and TUI agree).

### Phase 4: Parity features (both agents unless noted)

4.1 **Todo list** in the right rail from `PlanUpdated`. Claude: TodoWrite. Codex: `turn/plan/updated`, `item/plan/delta`.
4.2 **Live command output** (Codex): append `ToolOutputDelta` to the running tool card, keep the last ~200 lines, collapse when finished. `item/fileChange/patchUpdated` updates the file-change card.
4.3 **Diffs in Edit/Write approvals** (Claude): `can_use_tool` input already carries `old_string`/`new_string` (Edit), `content` (Write), `edits` (MultiEdit). Render with the existing diff view; for Write, diff against the file on disk. Codex file-change approvals: show the item's patch.
4.4 **`/` in the composer opens the picker** at the start of input (both agents). Claude: the commands list from `initialize`. Codex: `skills/list`. Test Claude built-ins over stream-json (`/compact`, `/cost`, `/context`, `/clear`); hide any that do nothing headless.
4.5 **Pickers.**
- Claude: model (done), mode (done), effort/fast mode per S4: use a control request if one exists, otherwise restart the `-p` process with the flag (the session resumes, so it costs about a second).
- Codex: model and effort from `model/list`; mode picker with three presets that match Codex's own: Read only (`read-only` + `on-request`), Auto (`workspace-write` + `on-request`, default), Full access (`danger-full-access` + `never`, with a warning). Sent on `turn/start`.
4.6 **Attachments and `@file` mentions.** Claude: stream-json user messages accept image content blocks (base64) and plain `@path` text. Codex: image input in `turn/start.input`, `thread/attachment/add`. Turn on the capability flags per agent only after a live check.
4.7 **Banners** from `Notice`: Codex `warning`, `guardianWarning`, `configWarning`, `model/rerouted`, `deprecationNotice`, `thread/compacted`; auto-approved chips from `item/autoApprovalReview/*`.
4.8 **Usage line**: Codex `account/rateLimits/read` on open, then the existing rate-limit notifications; Claude already shows the reset time.
4.9 **Small Claude items:** caption under "Always allow": "Saved to .claude/settings.local.json in this project"; live-test multi-select questions, the free-text "Other" path, and "Keep planning".

### Phase 5: Smoothness and layout

5.1 **Profile before changing anything**: a Codex turn with a long command, React Profiler and a Performance trace through the e2e harness (`cdp.mjs`). Expected suspects: the whole transcript re-rendering per event (fix: memo rows by id, keep the streaming row separate), auto-scroll fighting the user (fix: stick to bottom only while already at the bottom), Markdown re-parsing the full message per delta (fix: parse the stable prefix once).
5.2 **Layout**: when the terminal opens in an agent pane, collapse the explorer by default and set the split to 40% chat / 60% terminal on narrow windows (< 1600 px); keep remembering the user's own split.

### Phase 6: Advanced (after the above is solid)
- Codex: `thread/fork`, `thread/revert` (rewind to before a turn; add a "Rewind to here" item on user messages), `thread/compact/start`, `review/start`, `turn/steer` (send while running: the composer stays enabled during a turn and sends a steer).
- Claude: fork and rewind via `--resume <id> --fork-session` and the session file's message uuids; checkpoints only if Claude exposes them headless (check first).
- Subagents and MCP status: Claude `initialize.agents` and sidechain records; Codex MCP items.

---

## 3. Decisions for the user (with recommendations)

1. **Claude architecture:** recommend **C, one owner at a time** (§1). Phase 1 is needed for every option, so only Phase 2 waits on this.
2. **Show TUI for Claude:** keep it on; it becomes "Open in terminal / Back to chat".
3. **Codex default approval:** recommend **Auto** (`workspace-write` + `on-request`), passed explicitly so the user's global Codex config does not silently change GUI behaviour. Offer Read only and Full access in the picker.
4. **Light theme:** recommend out of scope until Phase 5 is done.

## 4. Testing rules for every phase
- Unit tests in Rust for every mapper and reply builder (fixtures from S3 and S5), and in Vitest for reducer and dock changes.
- Each "Done when" is checked live in the app via the e2e harness (handoff §6). A render loop that passed typecheck was found only live last session.
- Run `pnpm test`, typecheck, `cargo test --no-default-features --features codex-ws`, and the feature-less build (after 0.2) before each commit.
- Keep both `protocol_hub.rs` and `protocol_hub_stub.rs` in sync in the same commit.
- Tiny prompts only; each one costs money.
