# Agent GUI handoff: Claude and Codex (state on 2026-10-01)

For the next agent. Read this first. Branch `rebuild/main`. **All work from this session is uncommitted** (see "Working tree").
Related docs: `docs/ux-features-plan.md` (prioritized feature plan), `docs/gap-audit.md` (OpenCode audit), `docs/phase7-recon.md`.

Goal from the user: the GUI should feel like Claude Desktop. Nobody should need "Show TUI" to get work done. Simple, not clever.

## 1. How each agent is wired today

| | OpenCode | Codex | Claude |
|---|---|---|---|
| Processes | one `opencode serve`; GUI and TUI both attach | one `codex app-server` (WebSocket); the GUI client and the TUI (`codex --remote ws://... resume <thread>`) share it and one thread | TWO separate processes: a headless `claude -p` for the chat, and (only after Show TUI) a second `claude --resume` in a terminal |
| Source of truth | server | server | nothing shared live; they share only the saved session file |
| GUI data | OpenCode HTTP + SSE | Codex JSON-RPC over WebSocket | Claude stream-json on stdin/stdout |

Because Claude has no server, the chat and the terminal drift apart. That is the root cause of most Claude complaints.

### Claude (files)
- Rust: `src-tauri/src/protocol/claude_stream_json.rs` (spawns `claude -p --input-format stream-json --output-format stream-json --include-partial-messages --verbose --permission-prompt-tool stdio --permission-mode <mode>`; the mapper turns lines into `AgentEvent`s), `session/claude_headless.rs` (the placeholder pane), `commands.rs` (`session_open_in_tui`, `session_agent_info`, `session_set_option`), `session/protocol_hub.rs` and `protocol_hub_stub.rs` (keep both in sync).
- Frontend: `components/agent/AgentView.tsx` (toggle behind `SHOW_CLAUDE_TUI_TOGGLE`, sync and trust banners, plan and question wiring), `ClaudeControlBar.tsx` (mode, model, commands), `PlanApprovalCard.tsx`, `lib/claude-info.ts`, `lib/claude-trust-prompt.ts`, `lib/protocol-questions.ts`, `lib/tui-companions.ts`, `lib/agent-capabilities.ts`, `hooks/useAgentSession.ts`, `terminal/terminal-session.ts` (`readVisibleText`).
- Protocol facts verified live with claude 2.1.286: `initialize` control request returns `commands`, `models`, `agents`, `current_permission_mode`, `account`; `set_model`, `set_permission_mode`, `interrupt` work; permission and question requests arrive as `control_request` `can_use_tool`, answered with `control_response` (allow needs `updatedInput`; questions answered via `updatedInput.answers = {questionText: label}`; `ExitPlanMode` carries `{plan, planFilePath}`).

### Codex (files)
- Rust: `src-tauri/src/codex/dual.rs` (starts app-server, creates the thread, spawns the attached TUI; if the server fails it silently falls back to a PTY-only pane), `codex/link.rs`, `codex/protocol.rs`, `protocol/codex_ws.rs` (WebSocket loop, `turn/start`, `turn/interrupt`, approval replies), `protocol/codex_app_server.rs` (session + capabilities), `protocol/codex_notifications.rs` (maps server messages to `AgentEvent`), `manifests/codex.toml`.
- Frontend: same `AgentView.tsx`, `PermissionDock.tsx`, `lib/agent-capabilities.ts` (`CODEX_CAPABILITIES`).
- Codex on this machine is 0.159.2. To get the exact protocol: `codex app-server generate-json-schema --out <dir>` (this is how the facts below were checked).

## 2. Done and verified live this session
Claude: permission dock (Allow once / Always allow / Reject all work; Always allow persists a rule in the project's `.claude/settings.local.json`), question dock (answer reaches Claude), plan card (Approve plan, then normal Write approval), Stop (ends as cancelled, not error), model switch, plan mode, slash commands via the picker, trust-folder banner, sync banner after every reply, retry and starting states, process-exit error, rate-limit reset time.
Codex: chat works; command approval dock appears and Allow once runs the command. Fixes made: replies echoed the server request id as a string (now numeric ids go back as numbers), socket error 997 on Windows treated as a read timeout, fallback approval policy changed from `never` to `on-request` in `codex_app_server.rs`.
Checks at last run: frontend 462 tests pass, typecheck clean, Rust all pass (`cargo test --no-default-features --features codex-ws`; the feature-less build was already broken before this session in the Codex stubs).

## 3. Claude: current gaps (ordered)
1. **Two processes drift.** Messages sent in the chat never reach the terminal and vice versa. Mitigation today: "Sync terminal" banner (restarts the terminal with `--resume`). Decision pending with the user: keep this, or go terminal-first (one real `claude` in a PTY; GUI reads the saved session file `~/.claude/projects/<encoded cwd>/<id>.jsonl`, types into the PTY, answers on-screen prompts with key presses, using Puppet Master's logic in `C:\Users\Ren-pc\Desktop\work2\puppet-master`). Verified that the interactive terminal does write that file. The user is currently leaning terminal-first ("the gui is basically just turning the tui into a gui").
2. **No history after restart or reopen.** Hub history is in memory only. Needs a parser for the session file (user, assistant, thinking, tool_use, tool_result) feeding the transcript. Also enables a "past conversations" list.
3. **No past conversations list**, no resume from the sidebar.
4. **No image attachments**, no `@file` mentions for Claude (capabilities are `false`).
5. **`/` typed in the composer does not open the picker** (only the "/ Commands" button does). Claude built-in commands (`/context`, `/cost`, `/compact`, `/clear`) are untested over stream-json; skills work.
6. **No effort level / fast mode picker** (models report `supportedEffortLevels`).
7. **No todo list** (TodoWrite), no subagent display, no MCP status (`initialize` also returns `agents`).
8. **No fork / rewind / checkpoints.**
9. **Edit and Write approvals show only a path.** Show a diff of the proposed change.
10. **Question dock gaps**: multi-select and the free-text "Other" path are untested live; "Keep planning" is untested live.
11. **Layout:** the agent column is narrow between the explorer and the right rail, so an open terminal gets about 280px on a 1400px window. Default split is 50/50 and remembered.
12. **Claude updated itself mid-session** (2.1.285 to 2.1.286); nothing tells the user.
13. **Always allow writes into the user's project settings**; the UI does not say so.

## 4. Codex: current GUI, in detail

What the GUI does today
- Chat: streams assistant text, reasoning, command executions, file changes, MCP tool calls, web search as items; turn start and end; diff updates; token usage; errors; rate-limit updates.
- Approvals: `item/commandExecution/requestApproval` and `item/fileChange/requestApproval` show the permission dock; Allow once = `accept`, Always allow = `acceptForSession`, Reject = `decline`. Verified live for Allow once only.
- Stop: `turn/interrupt` (capability `abort: true`; not verified live).
- Composer for Codex: capabilities are all `false` except `abort`, `tuiToggle`, `permissions` (no model picker, permission-mode picker, slash commands, mentions, attachments, fork, revert, questions).
- Show TUI attaches the real Codex TUI to the same server and thread, so the two should agree. **Not verified live that a GUI-sent turn appears in the TUI, or the reverse.**
- Default approval is `on-request` with `workspace-write` when the pane's endpoint has no explicit options (`codex_app_server.rs`); the dual spawn path creates the thread with default options, so it may follow the user's own Codex config instead. Confirm which applies.

Gaps, with the Codex app-server methods to use (names from the generated schema)
1. **Questions hang the turn.** The server asks the user via `item/tool/requestUserInput` (params: `questions[{id, header, question, options[{label, description}], isOther, isSecret}]`, `isBlocking`, `autoResolutionMs`; reply: `{answers: {<questionId>: {answers: [string]}}}`). It is not mapped, so Codex waits for a reply that never comes. Reuse the approval kind `question` and the existing QuestionDock exactly as done for Claude (`protocol-questions.ts`).
2. **MCP elicitation hangs too**: `mcpServer/elicitation/request` is unmapped.
3. **Wrong reply shape for permission approvals.** `item/permissions/requestApproval` is mapped as a command approval but its reply is `{permissions, scope, strictAutoReview}`, not `{decision}`. Legacy `applyPatchApproval` and `execCommandApproval` reply with `ReviewDecision` (`approved`, `approved_for_session`, `denied`, `abort`), not `accept`/`decline`. Today everything gets `{decision: ...}`.
4. **Reject and Always allow are untested live**; `decline` vs `cancel` semantics unconfirmed. Also the richer `acceptWithExecpolicyAmendment` option exists.
5. **Plan and todo**: `turn/plan/updated`, `item/plan/delta` are unmapped. Needs a todo list in the right rail.
6. **Live command output**: `item/commandExecution/outputDelta` and `item/fileChange/patchUpdated` are unmapped, so long commands show nothing until finished. This is likely part of "not smooth".
7. **Model, effort and mode pickers**: `model/list`; `turn/start` accepts `model`, `effort`, `summary`, `approvalPolicy`, `sandboxPolicy`, `personality`, `serviceTier`, `cwd`; `permissionProfile/list`. None are exposed.
8. **Past threads**: `thread/list` (filters `cwd`, `searchTerm`, archived), `thread/read`, `thread/turns/list`, `thread/items/list` for history; `thread/name/set`; `thread/archive`, `thread/delete`, `thread/unarchive`. No Codex history list exists in the sidebar.
9. **Fork, revert, compact, review**: `thread/fork`, `thread/revert` (`beforeTurnId`), `thread/compact/start`, `review/start`.
10. **Steer while running**: `turn/steer` (send a message into a running turn).
11. **Attachments and skills**: `thread/attachment/add|list|remove`, image input in `turn/start.input`; `skills/list` for a `/` or `$` picker.
12. **Banners**: `warning`, `guardianWarning`, `configWarning`, `model/rerouted`, `deprecationNotice`, `thread/compacted`, `item/autoApprovalReview/*` (auto-approved chips) are ignored.
13. **Account and limits**: `account/read`, `account/usage/read`, `account/rateLimits/read` could feed a usage line.
14. **Silent fallback**: if `codex app-server` fails to start, the pane becomes a plain terminal with no chat and no message (`codex/dual.rs`).
15. **File changes capability is `false`** in `codex_app_server.rs` even though `turn/diff/updated` is mapped; the Review panel is not fed.
16. **"Not smooth"** (user report): not diagnosed. Suspects: no live command output (6), per-delta re-render with no throttling, scroll behavior. Profile first.

## 5. Decisions the user still has to make
1. Claude: keep chat plus optional terminal with sync, or terminal-first single process.
2. Show TUI for Claude is currently ON (`SHOW_CLAUDE_TUI_TOGGLE = true`).
3. Codex default approval policy.
4. Light theme in scope or not.

## 6. How to run and test (read the gotchas, they cost hours)
- Harness: `C:\Users\Ren-pc\Desktop\work2\loomria-e2e` (outside the repo). Commands: `node cdp.mjs eval|click|type|press|shot|pages`, `node console-watch.mjs <seconds>`, `close-app.ps1 -AppPid <pid>`. Launch with `npx tauri dev --config <loomria-e2e>\tauri-e2e.json` from `packages/app`, env `CARGO_TARGET_DIR=...\loomria-target-ui`, `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`. See `plan.md` Appendix A.
- **If the user's own Loomria is running** (different target dir), your launch fails with WebView2 error 0x8007139F. Set `WEBVIEW2_USER_DATA_FOLDER` to a private folder. Never kill the user's process.
- Test repo: `%TEMP%\loomria-e2e-repo`. Use tiny prompts; every prompt costs money.
- Git Bash rewrites a leading `/` argument into a Windows path: use `MSYS_NO_PATHCONV=1` when probing slash commands.
- Source files are CRLF. Patch scripts must preserve line endings. The shell is Git Bash; `python3` does not exist, use `python`.
- The user's ECC plugin injects "Fact-Forcing Gate" hooks that block the first Bash/Write/Edit and also fire inside the Claude chats under test (you will see "Fact-Forcing Gate" text in transcripts). Not a bug in the app.
- Verify UI in the real app, not only unit tests; a render loop in `ClaudeControlBar` passed typecheck and was only found live.
- Stop your test app with `close-app.ps1` and click the modal's "Close" button; confirm ports 9333, 3010, 1430 are free.

## 7. Working tree (uncommitted)
Modified: `src-tauri/src/{commands.rs, lib.rs, protocol/{claude_stream_json,codex_app_server,codex_ws,types}.rs, session/protocol_hub{,_stub}.rs}`, `src-tauri/tests/codex_ws_handshake.rs`, and in `packages/app/src`: `App.tsx`, `components/{TerminalLifecycle, agent/AgentView, opencode/PermissionDock, shell/AppShell, transcript/TranscriptView}.tsx`, `hooks/{useAgentChatSplit, useAgentSession}.ts`, `lib/{agent-capabilities, agent-events, agent-session, agent-timeline-reducer, shell-data, tui-companions}.ts`, `lib/sessions/merge-sessions.ts`, `terminal/terminal-session.ts`, plus tests.
New: `components/agent/{ClaudeControlBar, PlanApprovalCard}.tsx` (+ test), `hooks/useAgentSession.test.tsx`, `lib/{claude-info, claude-trust-prompt, composer-insert, protocol-questions}.ts` (+ tests), `docs/ux-features-plan.md`, this file.
Also untracked from before this session: `.claude/`, `.mcp.json`, `.pnpm-store/`, `.puppet-master/`, `plan.md`, `scripts/test-claude-tui.mjs`, `docs/fix-past-session-blank-gui-plan.md`. `package-lock.json` and `src-tauri/Cargo.toml` show line-ending noise; do not commit those blindly.
Suggested commits: (1) Claude approvals, questions, plan, Stop, process-exit, (2) Claude info and controls, (3) Claude terminal sync and trust banner, (4) Codex approval id and socket fixes, (5) session list and split fixes.
