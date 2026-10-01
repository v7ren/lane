# Agent GUI: product brief (for spec and planning)

Audience: the model that will write the specs and the implementation plan. Read `docs/agent-gui-fix-plan.md` (implementation-level plan and progress), `docs/agent-gui-handoff.md` (file maps, test gotchas) and `docs/codex-protocol-notes.md` (Codex reply shapes) first. This brief says what the product should be; those say what exists.

## 1. Goal

Loomria turns three terminal agents (Claude Code, Codex, OpenCode) into desktop-app experiences in one shared look, in the spirit of Claude Desktop and the OpenCode desktop app. Nobody needs the terminal to get work done, and the terminal is always one click away for anything the GUI cannot do. Simple, not clever: one conversation per pane, one process owning it at a time, no state that can drift.

Principles:
- One owner at a time. A session is driven by the chat process or by the terminal, never both.
- The session file/thread on disk is the source of truth; the GUI replays it.
- A turn must never hang on something the GUI cannot answer; unsupported requests get an error reply and a visible notice.
- Show summaries, not dumps. Detail is one click away.
- Same look for all three agents; agent-specific controls only where the agent really has them.
- Every claim is verified live in the running app, not only by unit tests.

## 2. Already built (do not redo; extend)

- Claude headless chat (stream-json): streaming, permission approvals, AskUserQuestion dock, plan approval card, Stop, model and permission-mode control, process-exit handling.
- Past Claude chats: listed in the sidebar per project (from `~/.claude/projects`), click resumes with the full transcript (`protocol/claude_session_file.rs`, `--resume`).
- Claude single owner: "Open in terminal" stops the chat process, resumes the session in a terminal, the chat pane mirrors the session file and the composer types into the terminal; "Back to chat" resumes the chat process and replays the terminal's turns (`protocol/claude_mirror.rs`, `session_open_in_tui`, `session_claude_to_chat`).
- Codex: per-method approval replies, legacy exec/patch approvals, `requestUserInput` mapped to the question dock, unknown server requests answered with an error, first send waits for the thread, `file_changes` capability on.
- Tool cards start collapsed with the command on the header line; previews capped at 12 lines.
- Hygiene fixes: nested-Claude env vars scrubbed, stale events from replaced sessions dropped, fresh chats start Idle.

## 3. Features wanted

Priority: P0 = core of the product, P1 = expected parity, P2 = later.

### 3.1 Agent identity and layout (P0)
- Pane header with agent mark (letter in a coloured square: Claude coral, Codex purple, OpenCode blue), agent name, live status dot (Idle, Working, Needs approval, Error, Rate limited), project, git branch, changed-file count.
- Header chips: model, mode, and an owner chip. Claude: Chat or Terminal. Codex: sandbox and approval policy. OpenCode: provider and model.
- Same agent mark on every sidebar session row and tab.
- "Open in terminal" / "Back to chat" lives in the header. Confirm before stopping a running turn.
- When the terminal opens, collapse the explorer and use about a 40/60 chat/terminal split on windows narrower than 1600 px; remember the user's own split.

### 3.2 Composer (P0)
- Text area pinned to the bottom of the agent pane. Enter sends, Shift+Enter newline. Stop replaces Send while a turn runs. Composer stays usable while the terminal owns the session (it types into the terminal).
- Toolbar inside the composer: `+` attach, `@` file mention, model pill, mode pill, context-used bar, session cost, Send/Stop.
- Draft text survives pane switches.

### 3.3 Slash commands (P0)
- Typing `/` at the start opens one searchable menu above the composer, for all three agents. Enter/Tab picks, Esc closes. `/` mid-sentence is plain text.
- Three kinds of command, tagged on each row:
  - prompt: expanded by the agent (Claude custom commands and skills, OpenCode commands, Codex skills); sent as a normal message and rendered as a chip in the user bubble.
  - action: done by Loomria (`/model`, `/mode`, `/effort`, `/clear`, `/compact`, `/cost`, `/context`, `/new`, `/resume`, `/fork`); result shown as a notice in the transcript, no model call.
  - terminal-only: greyed out with "Open in terminal"; user clicks to hand over (never automatic).
- Commands with a choice (`/model`, `/mode`, `/effort`) open a second list instead of free text. Model and mode pills are shortcuts to the same actions.
- Sources: Claude `initialize.commands` plus a verified allowlist of built-ins (verify `/compact`, `/cost`, `/context`, `/clear` over stream-json; anything unverified is terminal-only); OpenCode `listCommands`; Codex `skills/list`; plus Loomria's own actions for every agent.
- Unknown or failed commands stay in the composer with an inline error; they are never sent to the model by accident.
- `AgentCapabilities` gets a `commands` field so the menu shows only what an agent can do.

### 3.4 Transcript (P0)
- Compact tool rows: icon, tool name, target, duration, status; edits show `+N −M`. Click to expand. Shell, read, write and unknown tools start collapsed; expanded output is a short preview with "Show more". Never render a whole file or log by default. (Done for the card; extend to the rest below.)
- Group runs of consecutive tool calls under one line ("Explored 3 files, ran 2 commands") that expands.
- Live command output while a command runs (last ~200 lines, collapses when finished).
- Edit and write approvals show a diff (Claude `old_string`/`new_string`, `content`, `edits`; Codex file-change patch).
- Banners/notices in the transcript for: Codex warnings and model reroutes, compaction, Claude self-update, fallback errors, unsupported requests, command results.
- Reasoning/thinking blocks collapsed by default.
- Smooth: no whole-transcript re-render per event; stick to bottom only while already at the bottom; do not re-parse whole Markdown messages per delta. Profile before optimizing.

### 3.5 Right rail and info (P1)
- Todo list (Claude TodoWrite, Codex `turn/plan/updated`).
- Files changed this session, clickable into the Review panel (Codex diffs via `turn/diff/updated`).
- Model, tokens in/out, session cost, context percentage, rate-limit reset time.
- Subagents and MCP status where the agent exposes them.

### 3.6 Sessions (P0/P1)
- Past chats for Codex (`thread/list`) alongside Claude's, in one list per project. Archive/delete for Codex only (Claude has no API).
- Codex history replay on open (`thread/read` through the existing item mapper) so reopening shows the full transcript.
- Sidebar shows the status of every session, including past ones (idle), with the agent mark.

### 3.7 Codex correctness (P0)
- Questions (`requestUserInput`) verified live, including free-text "other" and secret inputs (never logged), and `autoResolutionMs` countdown.
- MCP elicitation: simple schemas (strings, enums, booleans) in the question dock, otherwise Accept/Decline with the message.
- Pass the approval policy and sandbox explicitly on `thread/start` and `turn/start` from the GUI's chosen preset, defaulting to Auto (`workspace-write` + `on-request`); presets: Read only, Auto, Full access (with a warning). Do not silently follow the user's global config.
- Visible fallback: if app-server fails, show a notice with the error and a Retry, instead of silently becoming a terminal-only pane.
- Stop during a command and during an approval (sends `cancel`).
- Verify GUI and attached TUI agree on a shared thread.

### 3.8 Claude extras (P1)
- Effort and fast mode (control request if one exists, else restart the chat process with the flag; resume is cheap).
- "Waiting in terminal" chip when the terminal owns the session and Claude is blocked on a prompt (tool_use with no result and quiet PTY for about 1 s); chip focuses the terminal.
- Caption under "Always allow": "Saved to .claude/settings.local.json in this project".
- Attachments: image content blocks and `@path` mentions.

### 3.9 Advanced (P2)
- Fork, rewind ("Rewind to here" on user messages), compact, review, steer (send while running).
- Claude fork via `--resume <id> --fork-session`; Codex `thread/fork`, `thread/revert`, `thread/compact/start`, `review/start`, `turn/steer`.
- Light theme (out of scope until the layout work is done).

## 4. Shared infrastructure the features need

- New events (Rust `protocol/types.rs`, `event_contract.rs`, TS `agent-events.ts`, reducer): `PlanUpdated {items}`, `ToolOutputDelta {tool_id, chunk}`, `Notice {level, text, id}`, and `ApprovalRequested.payload` for structured data (questions, proposed edit as old/new text, plan text).
- History replay marked `replayed: true` so the UI neither animates nor notifies for it.
- A `Command` model shared by all agents: `{id, name, description, kind: prompt|action|terminal, run}`.
- Per-agent capability flags remain the single source of what the UI offers; flip a flag only after a live check.
- Keep `protocol_hub.rs` and `protocol_hub_stub.rs` API-compatible in the same commit.

## 5. Known issues and risks

- Claude TUI does not save its transcript if it inherits `CLAUDE_CODE_CHILD_SESSION` (scrubbed now); any new spawn path must scrub too.
- Session-file layout and `--resume` behaviour are Claude-version dependent; keep fixtures and re-check after Claude updates.
- Codex `item/permissions/requestApproval` reply shape follows the generated schema but has not been seen live.
- The TUI paints permission prompts on screen only; the chat cannot answer them while the terminal owns the session (hence the chip in 3.8).
- Sending to Codex right after spawn used to fail with "thread not ready" (now waits up to 10 s); check the composer does not offer Send before the thread exists.
- Past-chat list reads the head of each Claude session file; very large projects may need caching.
- Dev-environment: launching the app from inside a Claude Code session inherits env vars that change child behaviour.

## 6. Decisions still open (recommendation first)

1. Agent mark: letter in a coloured square (recommended; no trademark artwork) vs real logos.
2. Built-in commands that agents expand themselves (e.g. `/compact`): intercept as an action with a visible result (recommended) vs pass through.
3. Terminal-only commands: show "Open in terminal" and wait for a click (recommended) vs open automatically.
4. Codex default policy: Auto (recommended).
5. Whether tool-call grouping applies to all agents or only Codex-style event streams (recommended: all).

## 7. Acceptance and test rules

- Each feature has a "done when" checked live in the real app through the e2e harness (`C:\Users\Ren-pc\Desktop\work2\loomria-e2e`, see handoff section 6); a render loop once passed typecheck and was found only live.
- Unit tests for every mapper, reply builder and reducer; Vitest for docks and components.
- Run `npm run typecheck`, `npm test`, `cargo test --no-default-features --features codex-ws`, and `cargo check --no-default-features` before each commit.
- Tiny prompts only in live checks; each costs money.
- Never kill processes the session did not start; close the test app with `close-app.ps1`.

## 8. Suggested order

1. Shared events (`PlanUpdated`, `ToolOutputDelta`, `Notice`, approval payload) and the `Command` model.
2. Header and sidebar identity; composer regroup (pills and info into the composer toolbar).
3. Slash menu: Claude and OpenCode first, then actions and the terminal-only fallback.
4. Transcript: compact rows, grouping, live output, diffs in approvals, notices.
5. Codex: policy presets, elicitation, fallback banner, history and past chats, live question checks.
6. Right rail, Claude extras, attachments.
7. Smoothness profiling and layout.
8. Advanced features.
