# UX features plan: the GUI is the whole product

Goal: nobody has to open "Show TUI" to get work done. The TUI stays as an optional power view.
Baseline: `docs/gap-audit.md` shows the composer, sessions and editor are BUILT for OpenCode. Claude and Codex
are far behind (see `lib/agent-capabilities.ts`: models, permission modes, slash commands, @files,
attachments, fork, revert and questions are all `false` for both). This plan closes that gap and fixes the
rough edges found in live testing on 2026-10-01.

Priorities: P0 = broken or misleading today, P1 = needed for "GUI only", P2 = parity and depth, P3 = polish.
Every item is verified live in the real app through the CDP harness (`loomria-e2e`), not just unit tests.

## Progress (2026-10-01)

P0 is implemented and verified live in the real app, except 0.5 which is partly done.

- 0.1 done: the Sync banner returns after every new chat reply (tracks assistant turns loaded). Live: after two messages and a sync the terminal shows both.
- 0.2 done: Claude AskUserQuestion shows in the question dock; the answer reaches Claude (live: "You picked blue.").
- 0.3 done: composer says it is starting, then shows a Retry banner if the chat never connects.
- 0.4 done: a closed Claude process reports an error and ends the running turn; rate limits show the reset time.
- 0.5 partly done: default split is 50/50 and the dragged width is remembered. The agent column itself is narrow beside the explorer and right rail, so an open terminal still gets about 280px on a 1400px window.
- 0.6 done live: Claude Reject, Always allow (Claude saves the rule in the project .claude/settings.local.json) and Stop. A stopped turn now ends as cancelled, not as an error. Codex Reject is still untested live.

## P0 — fix what is wrong today

| # | Item | Why / evidence | Done when |
|---|------|----------------|-----------|
| 0.1 | Terminal sync after every chat turn | Live bug: Sync works once; a second GUI message never reaches the terminal (user screenshot). Chat and terminal are two Claude processes on one session. | Banner reappears when the chat has newer replies than the terminal last loaded; Sync reloads it. Tracks "assistant turns at last sync". |
| 0.2 | Claude questions render as a question dock | `AskUserQuestion` now arrives as "Allow AskUserQuestion?" through the new approval path, which is wrong. | Claude question requests use the existing QuestionDock; answers are returned in the control response. Same for plan approval (`ExitPlanMode`). |
| 0.3 | Honest "starting" state | Early lookup failure left the composer saying "cannot accept prompts"; retry now hides it but there is no visible state. | Composer shows "Starting Claude…" and is disabled until ready; failure after retries shows an error with Retry. |
| 0.4 | Process failure and rate-limit banners | A crashed `claude`/`codex` process or auth error leaves a silent dead pane. | Banner with the real error and a Restart button; rate limit shows reset time. |
| 0.5 | TUI column sizing | TUI column is ~40 columns wide beside a 60% chat. | Default 50/50, drag handle remembered, terminal cols match the visible width. |
| 0.6 | Live-verify the untested approval paths | Reject and Always allow not exercised live for Claude or Codex; Claude Stop untested. | Each verified live and covered by a test. |

## P1 — what "GUI only" needs for Claude and Codex

| # | Item | Notes |
|---|------|-------|
| 1.1 | Permission mode picker | Claude `--permission-mode` (default / acceptEdits / plan); Codex approval policy and sandbox. Per-session, shown in the composer. |
| 1.2 | Model picker | Claude `--model` / set-model control request; Codex model list. Explicit pick only, default sends nothing. |
| 1.3 | Stop button | Claude interrupt exists in Rust; make sure the composer shows it and state returns to idle. Codex same. |
| 1.4 | Notifications when approval is needed | OS notification with the command text when the window is unfocused; click jumps to the session. |
| 1.5 | Keyboard approvals | Approve / reject from the keyboard, visible shortcut hints. |
| 1.6 | Tool cards for Claude and Codex | Bash, edit, read, grep, todo, task shown as cards (OpenCode already has them in A9). No raw JSON anywhere. |
| 1.7 | Todo list in the right rail | Claude `TodoWrite`, Codex plan items. |
| 1.8 | Changed files and diff review | `FilesChanged` events feed the existing Review panel for Claude and Codex edits. |
| 1.9 | Per-folder trust management | Trust banner exists; add a list of trusted folders and a way to revoke. |

## P2 — sessions and parity

| # | Item | Notes |
|---|------|-------|
| 2.1 | Past sessions for Claude and Codex | Read saved sessions (Claude project history, Codex thread list) into the sidebar; open one resumes in the GUI. |
| 2.2 | Rename, delete, search for those sessions | Same actions OpenCode sessions already have. |
| 2.3 | Fork and revert | Claude fork-session; Codex thread fork. |
| 2.4 | Transcript from the session file | Messages typed in the terminal also appear in the chat. Removes most of 0.1's pain. Alternative: terminal-first single process (large rewrite, decision needed). |
| 2.5 | Slash commands and skills | Claude custom commands and skills, Codex prompts, in the existing `/` picker. |
| 2.6 | `@file` mentions and image attachments | Claude image blocks, Codex image input; paste and drag-drop. |
| 2.7 | Usage and cost | Per-session tokens and cost for all agents, already partly shown for Claude. |
| 2.8 | Project switching | Sessions grouped by project; switching projects keeps agents running. |

## P3 — polish

| # | Item | Notes |
|---|------|-------|
| 3.1 | Streaming smoothness | Batch deltas, throttle re-renders, keep scroll pinned, "jump to latest" pill. This is the Codex "not smooth" feel. |
| 3.2 | Message actions | Copy, copy code, retry, edit and resend. |
| 3.3 | Transcript search | Find within a session. |
| 3.4 | Long sessions | Virtualized transcript. |
| 3.5 | First-run and empty states | Detect installed agents and login status; guided setup; clear empty states. |
| 3.6 | Agent updates | Claude auto-updated mid-session today; show version and a restart prompt. |
| 3.7 | Command palette | Add: new agent per type, switch session, toggle TUI, approve / reject. |
| 3.8 | Accessibility | Focus order, labels, contrast, reduced motion, full keyboard path. |
| 3.9 | Diagnostics | A panel with agent logs and a copyable debug report. |
| 3.10 | Theme | Light theme and accent options beyond today's dark only. |

## Order of work

1. P0 in the listed order (0.1, 0.2, 0.3 first: they are the daily frustrations).
2. P1.1 to 1.5 together (one composer and approval change), then 1.6 to 1.9.
3. P2.4 before the rest of P2: it decides how much of 0.1 and 2.1 is needed.
4. P3 as time allows, 3.1 earliest.

## Decisions needed from you

1. Single Claude process (terminal-first) or keep chat plus terminal as two processes with sync / session-file mirroring (recommended).
2. Is Codex's default approval policy `on-request` right, or should some folders auto-approve?
3. Light theme: in scope or not?
