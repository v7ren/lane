# Agent GUI: specification

Date: 2026-10-01. Branch `rebuild/main`. Input: `docs/agent-gui-product-brief.md` (what), `docs/agent-gui-fix-plan.md` (progress), `docs/agent-gui-handoff.md` (file maps, test gotchas), `docs/codex-protocol-notes.md` (Codex reply shapes). Implementation order and task split: `docs/agent-gui-plan.md`.

Paths below are relative to `packages/app/` unless they start with `docs/`. `NEW` marks a file or symbol that does not exist yet. Everything else was checked in the code on this date.

---

## 0. Decisions taken (brief section 6)

| # | Decision | Taken | Note |
|---|---|---|---|
| 1 | Agent mark | Letter in a coloured square | Claude `C` coral `#D97757`, Codex `X` purple `#8B5CF6`, OpenCode `O` blue `#3B82F6`. Codex uses `X` (manifest icon `CX`) so it never collides with Claude's `C`. No trademark artwork. |
| 2 | Built-ins the agent expands itself (`/compact`, ...) | Intercept as a Loomria action with a visible result | The action may still forward to the agent (Claude `/compact`), but the transcript shows a notice, not a user bubble, and nothing goes to the model unless the action says so. |
| 3 | Terminal-only commands | Greyed row with "Open in terminal"; hand over only on click | Never automatic. |
| 4 | Codex default policy | Auto (`workspace-write` + `on-request`) | Already the turn-level default in `protocol/codex_app_server.rs` `connect()`; the thread-level default is missing (see 3.7). |
| 5 | Tool-call grouping | All agents | Grouping runs on `TranscriptItem[]`, which OpenCode (`lib/transcript/from-opencode.ts`) and protocol panes (`lib/transcript/from-agent-events.ts`) both produce. |

## 1. Contradictions between the brief/fix plan and the code

Each one has a fix task in the plan.

1. **Codex questions cannot be answered.** `protocol/codex_app_server.rs` `CodexAppServerSession::respond_to_approval` runs `ApprovalDecision::parse(decision)`, which rejects the `answer:{...}` string the question dock sends. `codex_ws.rs` `question_reply` handles it, but the request never gets there. The fix plan marks 3.2 done; it only works in unit tests. Also `lib/protocol-questions.ts` drops `isSecret`, and `codex_notifications.rs` never forwards `isOther` or `autoResolutionMs`.
2. **Secret answers would be logged.** `commands.rs` `session_respond_approval` logs `decision = %args.decision`, which contains the answer text.
3. **Review panel shows nothing real for Claude/Codex.** `components/review/ReviewPanel.tsx` only calls OpenCode HTTP (`/vcs/diff`, `/session/:id/diff` in `lib/editor/opencode-file-actions.ts`). For other panes those calls fail and it falls back to the demo diff. Fix plan 3.7 ("Review panel shows Codex diffs") is not true.
4. **Re-registration breaks the frontend log.** `ProtocolHub::register` starts each new registration at `seq = 0`. Re-registration happens on "Open in terminal", "Back to chat" and Retry. `useAgentSession` dedups by `seq` (`mergeEnvelopeLog`, `mergeAgentEventEnvelopes` skips `seq <= maxSeq`), so events from the new registration are silently dropped until their seq passes the old maximum. The live check passed only because the replay is similar in size. Fix: envelope `epoch` (section 2.1).
5. **History replay is truncated and not marked.** `seed_history` pushes into the same `HISTORY_CAP = 2000` ring as live events, so a long session loses its beginning. Nothing marks replayed events (brief section 4 asks for `replayed: true`).
6. **The stub hub merges deltas differently.** `session/protocol_hub_stub.rs` `ingest` replaces a pending `Append` delta instead of concatenating it (`protocol_hub.rs` `merge_delta`). Tests built on the stub can pass while the real hub differs.
7. **Claude can hang on unknown control requests.** `ClaudeStreamMapper::map_control_request` ignores every subtype except `can_use_tool` and never replies. This breaks the "never hang" principle.
8. **`/` opens the picker anywhere.** `AgentComposerPanel.tsx` `onKeyDown` opens it on any `/` keypress. The brief says mid-sentence `/` is plain text.
9. **Drafts are lost on pane switch.** `draft` is local `useState` in `AgentComposerPanel`.
10. **Thread-level Codex policy follows the user config.** `codex/dual.rs` calls `start_thread_blocking(..., CodexThreadOptions::default())`, so `thread/start` carries no policy. Turns do carry it, because `codex/protocol.rs` passes `codex: None` and `codex_app_server.rs` fills `on-request`/`workspace-write`. The fallback PTY uses the manifest args `--sandbox read-only --ask-for-approval never` (`src-tauri/manifests/codex.toml`).
11. **Codex past threads cannot be resumed.** `spawn_dual_pane` ignores `SpawnPaneArgs.resume_session_id` and always starts a new thread.
12. **Slash commands vanish from Claude replays.** `claude_session_file.rs` `is_harness_text` drops `<command-name>` records, so commands disappear from the replayed transcript.
13. **Reasoning starts expanded.** `TranscriptItemView.tsx` renders it with `defaultOpen` (brief: collapsed).
14. **Claude questions flag is wrong.** `CLAUDE_CAPABILITIES.questions` is `false`, yet Claude questions work (verified live). The flag must be `true` so 3.3 gating stays honest.
15. **There is no pane tab strip.** Brief 3.1 asks for the mark on "every sidebar session row and tab". Panes are chosen from the sidebar only. The mark goes on `SessionRow`, the pane header and the new-agent menu.
16. **The session state stays "Needs approval" after an answer.** `session/state.rs` `apply_agent_event` ignores `ApprovalResolved`, so the state only changes when the next delta arrives.

---

## 2. Shared data model

### 2.1 Envelope (Rust `protocol/types.rs` `AgentEventEnvelope`, TS `lib/agent-events.ts`)

```rust
pub struct AgentEventEnvelope {
    pub pane_id: String,
    pub seq: u64,
    pub event: AgentEvent,
    /// Hub registration this event belongs to (PaneProtocol.generation). Changes on re-register.
    #[serde(default)] pub epoch: u64,                                      // NEW
    /// Event came from history replay (session file / thread/read), not the live stream.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")] pub replayed: bool, // NEW
    /// Wall-clock ms when the hub committed it (live) or the record timestamp (replay, if known).
    #[serde(default)] pub ts_ms: i64,                                      // NEW
}
```

Hub rules (`session/protocol_hub.rs` and `protocol_hub_stub.rs`, same API in the same commit):

- `epoch = generation` of the registration. `seed_history` sets `replayed = true`.
- Seeded events go into `PaneProtocol.seed: Vec<AgentEventEnvelope>` (NEW, uncapped). Live events go into the capped ring. `history()` returns `seed ++ ring`.
- `ToolOutputDelta` is emitted but never stored in `seed` or the ring (it is ephemeral). It is coalesced per `tool_id` (append) on the same 32 ms timer as `MessageDelta`.
- New `pub fn emit_local(&self, pane_id: &str, event: AgentEvent)` (NEW) commits an event the hub itself creates, for example a Notice from a command handler.
- Stub: the `Append` merge must match the real hub.
- Frontend (`hooks/useAgentSession.ts`): when an envelope arrives whose `epoch` is greater than the current one, drop the envelope log and view model, re-fetch `session_history`, and continue. `mergeEnvelopeLog` dedups by `(epoch, seq)`.
- Replayed envelopes never trigger notifications, sounds or "unread", and render with `streaming: false` and no animation.

### 2.2 New and changed `AgentEvent` variants

The same names must appear in `types.rs`, `event_contract.rs` (`event_type`, `turn_id_of`), `agent-events.ts`, `agent-timeline-reducer.ts` (exhaustive `never` switch), `lib/transcript/from-agent-events.ts`, `session/state.rs`, and the contract fixture `src-tauri/tests/fixtures/agent_event_sequences.json`.

```rust
Notice {
    id: String,                 // stable; a later Notice with the same id replaces the earlier one
    level: NoticeLevel,         // info | warning | error
    text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")] source: Option<String>, // "codex" | "claude" | "loomria"
    #[serde(default, skip_serializing_if = "Option::is_none")] action: Option<NoticeAction>,
    /// Sticky notices render as a chip above the composer, not as a transcript row.
    #[serde(default)] sticky: bool,
    /// Removes the notice with this id (text ignored).
    #[serde(default)] cleared: bool,
},
PlanUpdated {
    #[serde(default, skip_serializing_if = "Option::is_none")] turn_id: Option<String>,
    items: Vec<PlanItem>,       // full list each time (replace, not merge)
    #[serde(default, skip_serializing_if = "Option::is_none")] explanation: Option<String>,
},
ToolOutputDelta { turn_id: String, tool_id: String, chunk: String },
```

```rust
#[serde(rename_all = "snake_case")] pub enum NoticeLevel { Info, Warning, Error }
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum NoticeAction { RetryChat, OpenTerminal, FocusTerminal, BackToChat }
pub struct PlanItem { pub text: String, pub status: PlanStatus }   // serde snake_case
#[serde(rename_all = "snake_case")] pub enum PlanStatus { Pending, InProgress, Done }
```

Changed variants:

- `ApprovalRequested` gains `#[serde(default, skip_serializing_if = "Option::is_none")] payload: Option<serde_json::Value>` (section 2.3). `detail` stays: a one-line summary, and for `Question` the legacy JSON until every consumer reads `payload`.
- `Usage` gains `context_tokens: Option<u64>` and `context_window: Option<u64>`, both `skip_serializing_if = "Option::is_none"`.

State mapping (`session/state.rs` `apply_agent_event`):

- `ApprovalResolved` maps to `Working`.
- `Notice` with level `Error` and no `turn_id` maps to `Error` with the text as detail.
- `PlanUpdated` and `ToolOutputDelta` map to nothing.

Producers:

| Event | Claude (`claude_stream_json.rs`, `claude_session_file.rs`) | Codex (`codex_notifications.rs`, `codex_ws.rs`, `codex/dual.rs`) | OpenCode |
|---|---|---|---|
| `Notice` | `system/init` `claude_code_version` changed since the last spawn for this pane ("Claude updated to X"); `system` `compact_boundary` ("Context compacted"); unknown `control_request` (warning); waiting-in-terminal chip (sticky) | `warning`, `configWarning`, `guardianWarning`, `deprecationNotice`, `model/rerouted`, `thread/compacted`; unsupported server request (warning, "Codex asked for `<method>`, which Loomria does not support yet"); app-server fallback (error, action `RetryChat`) | none in Rust; Loomria command results use local notices (2.5) |
| `PlanUpdated` | `tool_use` named `TodoWrite`, `input.todos[]` `{content, status: pending\|in_progress\|completed}`, live and replay | `turn/plan/updated` `params.plan[] {step, status: pending\|inProgress\|completed}`, `params.explanation` | existing store `todos` (unchanged) |
| `ToolOutputDelta` | none | `item/commandExecution/outputDelta` `params {itemId, delta: string}` (fixture `codex_raw_turns.jsonl`) | none |
| `Usage.context_*` | `result.usage`: context = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`; window from the model table (2.6) | `thread/tokenUsage/updated`: context = `tokenUsage.last.inputTokens`, window = `tokenUsage.modelContextWindow` | existing |

### 2.3 Approval payload (`ApprovalRequested.payload`)

A JSON object tagged by `type`. The TS type is `ApprovalPayload` (NEW) in `lib/agent-events.ts`.

```ts
type ApprovalPayload =
  | { type: 'command'; command: string; cwd?: string; reason?: string }
  | { type: 'edit'; path: string;
      edits?: { old_text: string; new_text: string }[];  // Claude Edit (1), MultiEdit (n)
      content?: string;                                   // Claude Write: full new file
      patch?: string }                                    // Codex: unified diff
  | { type: 'questions'; questions: ProtocolQuestion[]; auto_resolution_ms?: number }
  | { type: 'plan'; plan: string; plan_file_path?: string }
  | { type: 'elicitation'; server_name: string; message: string;
      fields?: ElicitationField[] }                       // absent = complex schema: Accept/Decline only
  | { type: 'permissions'; permissions: unknown; reason?: string };

type ProtocolQuestion = { id?: string; header: string; question: string;
  options: { label: string; description?: string }[];
  multi_select: boolean; allow_other: boolean; secret: boolean };
type ElicitationField = { name: string; title?: string; kind: 'string' | 'enum' | 'boolean' | 'number';
  options?: string[]; required: boolean; secret?: boolean };
```

Builders (Rust; each one gets a unit test):

- Claude `map_control_request`:
  - `Bash`/`PowerShell` produce `command`.
  - `Edit`/`MultiEdit`/`Write` produce `edit`. `file_path`, `old_string`/`new_string`, `edits[].old_string/new_string` and `content` map to the fields above.
  - `AskUserQuestion` produces `questions`, with `multiSelect` mapped to `multi_select`, `allow_other: true` and `secret: false`.
  - `ExitPlanMode` produces `plan`.
- Codex `map_codex_server_request`:
  - `item/commandExecution/requestApproval` and `execCommandApproval` produce `command`.
  - `item/fileChange/requestApproval` produces `edit`, with `patch` taken from the item's changes if present, else from `params.changes[].diff`. `applyPatchApproval` also produces `edit`, built from `params.fileChanges`.
  - `item/permissions/requestApproval` produces `permissions`.
  - `item/tool/requestUserInput` produces `questions`, with `isOther` mapped to `allow_other`, `isSecret` to `secret`, and `autoResolutionMs` to `auto_resolution_ms`.
  - `mcpServer/elicitation/request` produces `elicitation`.

Consumers: `lib/protocol-questions.ts` `questionsFromApproval` reads `payload.questions` first and falls back to `detail`. `PermissionDock` renders `edit` as a diff (3.4) and `command` as before.

Answer encoding stays `answer:{"<question text>": "<label or free text>"}` (`ANSWER_PREFIX`). Multi-select answers are joined with `", "`, as today. Elicitation uses `answer:{"<field name>": value}`. Decline is `deny`.

### 2.4 Command model (TS, `lib/commands/command-model.ts`, NEW)

```ts
export type CommandKind = 'prompt' | 'action' | 'terminal';
export type LoomriaActionId =
  'model' | 'mode' | 'effort' | 'clear' | 'compact' | 'cost' | 'context' | 'new' | 'resume' | 'fork';
export type CommandRun =
  | { type: 'send' }                              // prompt: send "/name args" as a user message
  | { type: 'action'; action: LoomriaActionId }   // Loomria handles it; no model call unless the action says so
  | { type: 'terminal' };                         // needs the TUI; offer "Open in terminal"
export type Command = {
  id: string;            // `${source}:${name}`
  name: string;          // without leading slash
  description?: string;
  argumentHint?: string;
  kind: CommandKind;
  source: 'agent' | 'loomria';
  choices?: 'model' | 'mode' | 'effort' | 'past_chats';  // opens a second list instead of free text
  run: CommandRun;
};
export function buildCommandList(input: {
  family: AgentFamily; caps: AgentCapabilities['commands'];
  agentCommands: { name: string; description?: string; argumentHint?: string }[];
}): Command[];
export function parseSlashInput(text: string): { name: string; args: string } | null; // null unless text starts with "/" (not "//")
export function resolveSubmit(text: string, commands: Command[]):
  | { kind: 'plain'; text: string }               // includes "//foo" which sends "/foo"
  | { kind: 'command'; command: Command; args: string }
  | { kind: 'unknown'; name: string };
```

The brief's `run` is data, not a function. `executeCommand(cmd, args, ctx)` (NEW, `lib/commands/execute-command.ts`) dispatches it, which keeps `buildCommandList` pure and testable.

Merge rules in `buildCommandList`:

1. Loomria actions allowed by `caps.actions` come first.
2. Agent commands follow. An agent command whose name equals a Loomria action id is dropped, because the action wins.
3. Claude built-ins in `CLAUDE_TUI_ONLY` (NEW constant) become `terminal`. The list: `config`, `login`, `logout`, `doctor`, `ide`, `terminal-setup`, `vim`, `permissions`, `agents`, `mcp`, `hooks`, `memory`, `status`, `upgrade`, `bug`, `release-notes`, `export`, `add-dir`, `statusline`, `output-style`, `install-github-app`, `privacy-settings`.
4. Any name in `CLAUDE_VERIFIED_PASSTHROUGH` (NEW, initially empty, filled by spike S7) stays `prompt`. Everything else from Claude `initialize.commands` is `prompt` (custom commands and skills, verified live).
5. If `caps.terminalFallback` is false, `terminal` rows are hidden.

### 2.5 Local notices (TS, `lib/local-notices.ts`, NEW)

These are notices for panes whose transcript does not come from hub envelopes (OpenCode store panes) and for results computed in the browser (`/cost`, `/context`).

- API: `pushLocalNotice(paneId, {level, text})`, `useLocalNotices(paneId)`. In-memory only (`useSyncExternalStore` pattern as in `lib/tui-companions.ts`).
- Each notice records `afterTurnId`, the last turn id at creation, and renders after that turn.
- Protocol panes prefer `ProtocolHub::emit_local` through `session_post_notice` (NEW Tauri command) so the notice survives remounts. OpenCode panes use the local store.

### 2.6 Agent capabilities (`lib/agent-capabilities.ts`)

`AgentCapabilities` gains the fields below. `slashCommands: boolean` stays as a derived alias (`commands.prompt || commands.actions.length > 0`) until all callers migrate.

```ts
commands: { prompt: boolean; actions: readonly LoomriaActionId[]; terminalFallback: boolean };
effort: boolean;        // effort / fast-mode picker
contextBar: boolean;    // usage reports context tokens
```

Initial values. Flip a flag only after its live check (plan tasks).

| | Claude | Codex | OpenCode |
|---|---|---|---|
| `commands.prompt` | true (initialize.commands verified) | false until skills/list live check (C7) | true |
| `commands.actions` | model, mode, cost, context, new, resume, clear; `compact` after S7; `effort` after G1 | model, mode, context, new, resume, clear; `effort` after D3 live; `compact` P2 | model, cost, context, new, resume |
| `commands.terminalFallback` | true | true | true |
| `questions` | true (fix: currently false) | true | true |
| `models` / `permissionModes` | true (already shown via `ClaudeControlBar`) | true after D3 live | true |
| `attachments` / `fileMentions` | after G4 live | false (P2) | true |

Model context windows (`lib/model-context.ts`, NEW): a Claude model id ending in `[1m]` has 1,000,000 tokens; other Claude models have 200,000. Codex uses `modelContextWindow` from the server. OpenCode uses the existing provider catalog `limit.context` if present. If the window is unknown, the bar is hidden.

---

## 3. Features

Each feature lists: purpose, behaviour, UI, contracts, per-agent differences, edge cases, and acceptance criteria. Every acceptance criterion has a unit check (U) and a live check (L). Live checks run through the e2e harness (handoff section 6, `C:\Users\Ren-pc\Desktop\work2\loomria-e2e`, `node cdp.mjs eval|click|type|shot`) in `%TEMP%\loomria-e2e-repo`, using one tiny prompt each.

### 3.1 Agent identity and layout (P0)

**Purpose.** You can tell at a glance which agent a pane runs, what it is doing, and who owns the session.

**UI.**
- `components/agent/AgentMark.tsx` (NEW): a `<span>` square, 20 px in the header and 14 px in rows, with a rounded 4 px corner, white letter and background colour from decision 1. Props: `{ family: AgentFamily; size?: 'sm'|'md' }`. The `other` family renders a grey `·`. `aria-label` is the agent name.
- Pane header (in `components/agent/AgentView.tsx`, extracted to `components/agent/AgentPaneHeader.tsx`, NEW), left to right:
  - mark, then agent name (`agentLabel`);
  - status dot plus label (`DisplayStatusDot`, label from `DISPLAY_STATUS_LABEL`: Idle, Working, Needs approval, Error, Rate limited);
  - project basename (`paneCwd`), then git branch, then changed-file count `±N` (hidden when 0), from `git_status_summary`;
  - chips: model, mode, owner;
  - buttons: "Open in terminal"/"Back to chat" (Claude), "Show TUI" (Codex, OpenCode), mute, Workspace.
- Chips (pill, `text-meta`, 22 px high, clicking opens the same picker as the composer pill):
  - Claude: model (`ClaudeInfo.model` display name), mode (`CLAUDE_PERMISSION_MODES` label), owner `Chat` or `Terminal` (from `useTuiCompanions`).
  - Codex: model; preset (`Read only` / `Auto` / `Full access`), with a warning colour when Full access; no owner chip, because Codex shares one server.
  - OpenCode: provider, then model.
- `components/sessions/SessionRow.tsx`: the mark goes before the title. `ShellSession` gains `agentFamily: AgentFamily` (NEW field), set in `buildPaneShellSessions`, `buildOpenCodeShellSessions` and the past-chat rows in `lib/shell-data.ts`.
- Owner toggle: reuse `toggleClaudeTui` in `AgentView`. Replace `window.confirm` with an inline confirm bar under the header ("Claude is still working. Stop it and open the terminal?" with Stop and open / Cancel). Esc means Cancel. The bar is a testable component (`components/agent/ConfirmBar.tsx`, NEW).
- Layout (`hooks/useAgentChatSplit.ts`, `components/shell/AppShell.tsx`):
  - When the companion terminal opens for a pane (`showTui` goes from false to true), and the user has no saved split (`loomria-agent-chat-percent` absent) and `window.innerWidth < 1600`, use a 40 % chat share. Otherwise use the saved value or 50.
  - Collapse the explorer (`patchLayout({ explorerCollapsed: true })`) and restore it when the terminal closes, unless the user toggled it meanwhile.
  - `AgentView`'s inline default of `'0 0 60%'` is removed; the hook is the single source.

**Contracts.**
- `#[tauri::command] git_status_summary(cwd: String) -> Result<GitSummary, String>` (NEW, `src-tauri/src/git_info.rs`) with `GitSummary { branch: Option<String>, changed: u32 }`. It runs `git rev-parse --abbrev-ref HEAD` and `git status --porcelain=v1 -z`, with a 2 s timeout and no window on Windows. It returns `{None, 0}` outside a repo.
- Frontend hook `useGitSummary(cwd)` (NEW, `hooks/useGitSummary.ts`) polls every 10 s while the pane is visible, and again on `files_changed`.

**Edge cases.**
- No cwd: hide project, branch and count.
- Detached HEAD: show the short sha.
- Git missing: hide them.
- A Claude pane while the terminal owns it: the model and mode chips are disabled with the tooltip "Switch back to chat to change this".

**Acceptance.**
- U: `AgentMark` renders the right letter and colour per family. `buildPaneShellSessions` sets `agentFamily`. The `useAgentChatSplit` default is 40 under 1600 px with no saved value and the saved value otherwise. `ConfirmBar` Esc cancels. `git_info` parses porcelain output (Rust unit test on fixture strings).
- L:
  1. Open Claude, Codex and OpenCode panes. Each header and sidebar row shows its own mark. Screenshot.
  2. Window width 1400: "Open in terminal" collapses the explorer and the chat column measures 40 % ± 2 of the split row. `cdp.mjs eval` reads `getBoundingClientRect`.
  3. Drag the split, close and reopen the terminal: the dragged value is kept.
  4. Edit a file in the test repo: `±1` appears within 10 s.

### 3.2 Composer (P0)

**Purpose.** One composer for all agents, holding every per-turn control.

**Behaviour.**
- Pinned to the bottom of the agent pane (already the case in `AgentView`).
- Enter sends, Shift+Enter inserts a newline. While a turn runs, Stop replaces Send (already done).
- The textarea is never disabled during a running turn, only while a send is in flight (`busy`). Typing is allowed; Send is disabled until the turn ends (steering is P2).
- While the Claude terminal owns the session, Send writes into the PTY (already done through `ClaudeMirrorSession`). The placeholder reads "Type into the Claude terminal…".
- Codex: Send is disabled until the thread exists. `agent_info().thread_ready` (3.7) drives this, with the reason "Starting Codex…".
- The draft survives pane switches and app reload within the session: `lib/composer-drafts.ts` (NEW) holds a module `Map<paneId, string>` mirrored to `sessionStorage` key `loomria-draft:<paneId>`, inside try/catch. It is written on change (debounced 300 ms) and cleared on a successful send.

**UI.** One toolbar row inside the composer box (`components/composer/AgentComposerPanel.tsx`), left to right:
- `+` attach (`features.attach`);
- `@` mention button (`features.mentions`; opens the existing mention picker);
- model pill;
- mode pill;
- spacer;
- context bar (`components/composer/ContextBar.tsx`, NEW): a 48×4 px bar plus `NN%`, tooltip "N of M tokens", amber at 80 % or more, red at 95 % or more, hidden when `contextBar` is false or the window is unknown;
- session cost `$0.12` (hidden when unknown);
- Send or Stop.

The toolbar collapses pills to icons below 420 px (existing `toolbarCompact`).

`ClaudeControlBar` loses its three buttons. Mode and model move into the toolbar through a per-agent controls adapter. The "/ Commands" button is replaced by the slash menu (3.3). `account` moves to the right rail.

**Contracts.** `hooks/useAgentControls.ts` (NEW) returns:

```ts
{ models: {id,label,detail?}[]; currentModel?: string;
  modes: {id,label,detail?,warning?:boolean}[]; currentMode?: string;
  efforts?: {id,label}[]; currentEffort?: string;
  setModel(id): Promise<void>; setMode(id): Promise<void>; setEffort?(id): Promise<void>;
  disabledReason?: string }
```

- Claude: built from `useClaudeInfo` and `sessionSetOption`.
- Codex: built from `session_agent_info` (3.7) and `sessionSetOption` with keys `model`, `preset`, `effort`.
- OpenCode: the existing provider catalog and permission prefs.

Cost: Claude `result.total_cost_usd` is cumulative per process (fixture: 0.1035 then 0.1180). `lib/session-cost.ts` (NEW) keeps `base + latest`, and when a new value is lower than the previous one (process restarted) it adds the previous value to `base`. Codex has no cost, so the cost is hidden.

**Edge cases.**
- Pane closed: delete its draft key.
- Very long draft: the textarea grows to 160 px, then scrolls (existing).
- Attach while unsupported: the button is hidden, not disabled.

**Acceptance.**
- U: draft store round-trip and clear on send. The context bar thresholds. The `session-cost` restart rule. The textarea is not disabled while `showStop` is true and `busy` is false.
- L:
  1. Type "hello" in pane A, select pane B, back to A: "hello" is still there.
  2. During a running Claude turn, typing in the composer works and Stop is visible.
  3. After one Claude turn the context bar shows a percentage and the cost shows `$…`.
  4. A Codex pane right after spawn shows "Starting Codex…" until the thread is ready.

### 3.3 Slash commands (P0)

**Purpose.** One searchable menu for agent commands, Loomria actions and terminal-only commands, for all three agents.

**Behaviour.**
- The menu opens when the draft matches `^/[^\s/]*$` and the caret is inside that first token. It closes when a space is typed, on Esc, on blur, or when the draft no longer matches. A `/` anywhere else is text.
- Filtering: case-insensitive prefix match on `name` first, then substring match on name and description. At most 80 rows.
- Keyboard:
  - Up/Down move the highlight (wrapping), PageUp/PageDown move by 8.
  - Enter or Tab picks the highlighted row.
  - Esc closes the menu and keeps the text.
  - Mouse click picks.
- Picking a row:
  - `prompt` without an `argumentHint`: the draft becomes `/name ` and the menu closes. The next Enter sends.
  - `prompt` with an `argumentHint`: same, and the hint shows as ghost text after the caret.
  - `action` without choices: runs at once and the draft clears.
  - `action` with choices: the menu switches to a second list (models, modes, efforts or past chats) with a back row "‹ /model". Enter on an item runs it. Esc returns to the first list, and a second Esc closes.
  - `terminal`: the row is greyed with an "Open in terminal" button. Enter does nothing except focus that button, and the hint reads "Press Enter on the button to hand over". Clicking it runs the owner handover (Claude) or Show TUI (Codex, OpenCode) and then types `/name` into the terminal. It never sends to the chat.
- Submitting text that starts with `/` (Enter with the menu closed) goes through `resolveSubmit`:
  - `plain`: sent as is (`//x` sends `/x`).
  - `command` `prompt`: sent as a user message (Claude: stream-json user text `/name args`; OpenCode: `sendOpenCodeSlashCommand`; Codex: `$name args` per the skills convention, verified in C7).
  - `command` `action`: executed with `args`, for example `/model opus`.
  - `command` `terminal`: inline error "This command only works in the terminal" with the button.
  - `unknown`: inline error under the textarea, "Unknown command /foo. Use // to send text starting with /". The draft is kept and nothing is sent.
- Prompt commands render in the user bubble as a chip `/name` followed by the args text (`TurnRows.tsx` `UserTurnRow`). This holds live and on replay: `claude_session_file.rs` turns `<command-name>/x</command-name>` plus `<command-args>…</command-args>` user records into a user prompt `"/x …"` instead of dropping them.
- Actions:

| Id | Claude | Codex | OpenCode | Result |
|---|---|---|---|---|
| model | `set_model` (existing) | `set_option("model")` (3.7) | session model prefs | notice "Model set to X" |
| mode | `set_permission_mode`, choices `CLAUDE_PERMISSION_MODES` | preset (3.7) | Allow/Ask | notice |
| effort | G1 | `set_option("effort")` | hidden | notice |
| cost | from `session-cost` | tokens in/out only | store | notice "Session cost $0.12 · 12k in / 1k out" |
| context | from the last Usage | same | same | notice "Context 34% (68k of 200k)" |
| clear | restart chat process with a new session id in the same pane (NEW `session_claude_new(pane_id)`) | new thread on the same app-server (NEW `session_codex_new_thread`) | new session | notice "Started a new chat"; the old one stays in Past chats |
| new | spawn a new pane of the same agent in the project | same | same | selects the new pane |
| resume | second list = past chats of this agent and project | same (3.6) | session list | opens or selects |
| compact | after S7: write `/compact` over stream-json, show notice "Compacting…", replaced by "Context compacted" on `compact_boundary`; before S7: terminal kind | P2 `thread/compact/start` | `session.summarize` | notice |
| fork | P2 (3.9) | P2 | existing fork | hidden until P2 |

**UI.**
- `components/composer/SlashMenu.tsx` (NEW) is anchored above the composer box at full composer width, `max-h-72`, `role="listbox"`, with rows `role="option"` and `aria-selected`.
- Each row shows: `/name`, then the `argumentHint` muted, then the description on a second line, then a right-aligned kind tag (`prompt` neutral, `action` accent, `terminal` muted with a terminal icon).
- States:
  - loading: "Loading commands…" (Claude before initialize, OpenCode before `listCommands`);
  - empty after filter: "No command matches /xyz";
  - error: "Commands could not load: <msg>" with Retry.
- The menu replaces the `picker === 'slash'` `PickerPopover` in `AgentComposerPanel`. `ClaudeControlBar`'s commands popover is removed.

**Contracts.**
- `useAgentCommands(paneId, family)` (NEW, `hooks/useAgentCommands.ts`) returns `{commands, loading, error, reload}`. Its sources are Claude `useClaudeInfo().commands`, OpenCode `opencodeClient.listCommands` (moved out of `AgentComposerPanel`), and Codex `session_agent_info().skills`.
- New Tauri commands: `session_post_notice(pane_id, level, text)`, `session_claude_new(pane_id)` and `session_codex_new_thread(pane_id)` (NEW). Each must exist in `lib.rs` `generate_handler!`, and the hub methods used must exist in both hub files.

**Per agent.** Covered in the action table and 2.4. Codex prompt commands stay hidden until C7 confirms how skills are invoked.

**Edge cases.**
- Commands not loaded yet when Enter is pressed on `/foo`: treat as unknown with "Commands are still loading", and keep the draft.
- Duplicate names from the agent: first wins.
- The terminal owns the Claude session: `prompt` commands are typed into the PTY (same as text); actions that need the chat process (model, mode, effort, clear, compact) show "Switch back to chat to use /x".
- An action fails: an inline error, and the draft is restored.

**Acceptance.**
- U:
  - `parseSlashInput` and `resolveSubmit` table tests, including `//`, mid-sentence `/`, unknown and args.
  - `buildCommandList` merge and override rules per family.
  - `SlashMenu` keyboard: arrows, Enter, Tab, Esc, second-list back, terminal row not executable by Enter.
  - The composer never calls `onSendProtocol` for unknown commands.
- L, Claude:
  1. Type `/` and the menu lists skills and actions. Type `/mod` and Enter, the second list shows models; pick one and the notice appears and the header chip updates.
  2. `/foo` + Enter: an inline error, nothing sent (no new user bubble, no hub event).
  3. A custom command or skill: the user bubble shows a chip.
  4. `/doctor`: greyed; clicking "Open in terminal" hands over and types `/doctor`.
- L, OpenCode: `/` lists server commands.
- L, Codex: `/model` works after D3.

### 3.4 Transcript (P0)

**Purpose.** Summaries, not dumps, and smooth streaming.

**Behaviour and UI.**
1. **Compact tool row** (`components/transcript/ToolCard.tsx` header):
   - Left to right: status icon (spinner while running, check, cross, clock for pending), tool icon by category (read, search, shell, edit, web, task, other), tool name, target, `+N −M` for edits (green and red), duration, chevron.
   - Target comes from the existing `toolPathHeader`.
   - Duration: `completed.ts_ms − started.ts_ms`, shown when 500 ms or more, live only (replayed tools have no reliable times).
   - `+N −M`:
     - Claude `Edit`: the line counts of `new_string`/`old_string`, after removing common lines through a line diff.
     - `MultiEdit`: the sum over edits.
     - `Write`: `+lines(content)`.
     - Codex `fileChange`: counts of `+` and `-` lines in each `changes[].diff`.
   - The Codex mapper puts `{"changes":[{path,kind,diff}]}` JSON in `ToolStarted.input_summary` for `fileChange` instead of the joined paths.
   - Expand behaviour is unchanged (12-line preview, Show more).
2. **Grouping** (`lib/transcript/group-tools.ts`, NEW, a pure function over an assistant turn's `items`):
   - A run of two or more consecutive `tool_call` items, with no text, reasoning or error between them, becomes one `tool_group` item (NEW `TranscriptToolGroup { kind:'tool_group'; id; tools: TranscriptToolCall[]; summary: string }`).
   - Summary parts, in this order, comma-separated: "Explored N files" (read, glob, grep, ls, list, webfetch, websearch, `webSearch`), "ran N commands" (shell names, `command`), "edited N files" (edit, write, multiedit, `fileChange`, apply_patch), "used N tools" (other). Plurals are correct and the first letter is capitalised.
   - The group is collapsed by default. While any member is running, the header shows that member's compact row as a second line. If any member failed, the header ends with "· 1 failed" in error colour. Expanding lists the compact rows.
   - The `id` is the first member's id, so React keys stay stable while members are appended.
3. **Live command output**:
   - `ToolOutputDelta` chunks go into a per-tool ring of the last 200 lines (`lib/transcript/live-output.ts`, NEW; `\r` overwrites the current line and ANSI CSI/OSC sequences are stripped by a NEW `stripAnsi` helper in that file; `lib/safe-agent-text.ts` only has `escapeAgentText` and `isSafeHttpUrl`).
   - While the tool runs, its row auto-expands and shows the ring in a 12-line scroll box pinned to the bottom.
   - On `ToolCompleted` the ring is discarded, the row collapses back to its default state, and `output_summary` is shown on expand.
   - The live-output state lives outside the envelope log, keyed by `tool_id`, and is lost on remount, which is acceptable.
4. **Diffs in approvals**:
   - `PermissionDock` card for payload `edit`: a unified diff view (`components/transcript/InlineDiff.tsx`, NEW, a pure line diff with no Monaco, max 40 lines, then "Show full diff"; Show full diff opens Monaco's `DiffEditor` in a modal using the existing lazy import from `ReviewPanel`).
   - Claude `Write`: the "before" text comes from `fs_read_file(path)` (existing scoped command), and a missing file means an empty before plus "New file".
   - Codex: render `patch` as is, coloured.
   - The path shows as the header. Buttons are unchanged.
5. **Notices**:
   - A `notice` transcript item (NEW `TranscriptNotice { kind:'notice'; id; level; text; action? }`) renders as a one-line banner row, muted for info, amber for warning, red for error, with an optional action button. Retry calls `codex_retry_app_server`; Open in terminal and Back to chat call the owner toggle.
   - Sticky notices render above the composer as a chip and are removed on `cleared`. The notice id is stable, so a repeat replaces in place.
6. **Reasoning collapsed by default.** Remove `defaultOpen` in `TranscriptItemView.tsx` `case 'reasoning'`. A streaming reasoning block shows "Thinking…" collapsed.
7. **Smoothness** (profile first, then fix). Done when the numbers in the acceptance list hold.
   - Measure: React Profiler commit count and duration, and a Performance trace through `cdp.mjs`, for a Codex turn running `ping -n 20 127.0.0.1` and a Claude turn with about 2k tokens of streamed text.
   - Planned fixes, applied only where the profile shows cost:
     - (a) Make the transcript build incremental. `fromAgentEventEnvelopes` rebuilds every turn from all envelopes on each event (O(n) per event, with new object identities). Keep a builder in a ref and apply only new envelopes, giving changed turns new objects and untouched turns the same reference.
     - (b) `React.memo` on `UserTurnRow`, `AssistantTurnBlock`, `TranscriptItemView` and `ToolCard`, comparing by reference.
     - (c) Stick to bottom: `TranscriptView` today scrolls only when `flatItems.length` changes, so streaming text growth does not follow. Use a `ResizeObserver` on the content, and scroll only when `stuckBottom`.
     - (d) Markdown: split streamed text at the last blank line outside a code fence; render the stable prefix memoized and only the tail per delta (`MarkdownBody.tsx`).

**Contracts.** TS `TranscriptItem` gains `tool_group` and `notice`. `TranscriptToolCall` gains `startedAtMs?`, `endedAtMs?` and `diffStat?: {added:number; removed:number}`. A plan (`PlanUpdated`) goes to the right rail (3.5), not the transcript. `todo_update` items stay for OpenCode.

**Per agent.**
- Claude has no live output.
- Codex has all features.
- OpenCode gets grouping, compact rows, collapsed reasoning and notices (local); its approvals use OpenCode permissions, and a diff appears only when `metadata` carries one (unchanged).

**Edge cases.**
- An output delta for an unknown `tool_id` (arrived before `ToolStarted`): buffer it under that id and attach it when the tool starts.
- A group whose members span an approval: the approval dock is outside the transcript, so no split is needed.
- More than 200 lines: show the "… N earlier lines" marker.
- Binary or garbage output: `stripAnsi`, and control characters other than `\n`/`\t` are dropped.

**Acceptance.**
- U:
  - `group-tools` table tests (counts, plurals, a running member, a failed member, mixed text breaks).
  - `diffStat` for Claude Edit, MultiEdit and Write, and for a Codex diff.
  - The `live-output` ring: 200-line cap, `\r` handling, discard on complete.
  - `InlineDiff` line diff.
  - The reducer handles `notice` replace and clear by id.
  - The reasoning block is collapsed.
  - The incremental builder gives the same result as the full rebuild on the contract fixture, and untouched turns keep their reference.
- L:
  1. Codex `ping -n 5 127.0.0.1` shows lines arriving before completion, then the row collapses.
  2. A Claude turn that reads 3 files and runs 2 commands shows one row, "Explored 3 files, ran 2 commands".
  3. A Claude Edit approval shows a red and green diff.
  4. Profiler: during streaming, commits of unchanged turns are 0 and the median commit is under 8 ms with a 50-turn transcript. While scrolled up, streaming does not move the scroll position.

### 3.5 Right rail and info (P1)

**Purpose.** Session facts at a glance for protocol panes, which today show only "Agent".

**UI** (`components/shell/RightRail.tsx`, Session tab; sections hidden when empty):
- **Todo**: a list from the latest `PlanUpdated` (status glyph `○` pending, `◐` in progress, `●` done; done items are struck through). An explanation, if any, sits above in muted text. The header reads `Todo 2/5`.
- **Files changed**: paths from `files_changed` for the pane, each a button that opens the Review panel focused on that file (`ReviewPanel` gains an `initialPath` prop).
- **Usage**: model, tokens in/out, cost, context %, and rate-limit reset time (`rateLimit.retryAtMs` as local time).
- **Agent**: Claude account (moved from `ClaudeControlBar`), MCP servers, and subagents (Claude `initialize.agents`; Codex MCP from `mcpToolCall` items seen). Hidden until there is data.

**Contracts.**
- `useSessionSummary` (`lib/shell-data.ts`) gains a protocol branch. A new selector `selectProtocolSummary(envelopes)` (NEW, `lib/protocol-summary.ts`) derives plan, files, usage and rate limit from the pane's envelopes, which come from a shared per-pane envelope store `lib/agent-envelope-store.ts` (NEW) that `useAgentSession` writes to, so the rail does not open a second listener.
- Review for non-OpenCode panes uses `git_diff_files(cwd) -> Vec<DiffFile{path,before,after}>` (NEW, `git_info.rs`): `before` from `git show HEAD:<path>` (empty for new files), `after` from disk. It is capped at 200 files and 1 MB per file. `ReviewPanel` uses it when the selected pane is not `opencode_native`.
- Codex: on open, the client sends `account/rateLimits/read` and maps the reply like `account/rateLimits/updated` (only when limited); the reset time is kept for display.

**Acceptance.**
- U: `selectProtocolSummary` on a fixture (TodoWrite and Codex plan, files, usage, rate limit). `git_diff_files` on a temp repo (Rust test, skipped when git is absent).
- L:
  1. Claude: "make a 3-step todo list and mark step 1 done" (tiny) and the rail shows Todo 1/3.
  2. Codex edits a file: Files changed lists it, and clicking opens a Review panel with the real diff, not the demo one.

### 3.6 Sessions (P0/P1)

**Purpose.** Past chats for Claude and Codex in one list per project, resumable with the full transcript.

**Behaviour.**
- The sidebar group per project lists open panes, then past chats (Claude existing, Codex new), sorted by the existing sort mode. Past rows show the mark, the title, the status "Idle" and the relative time.
- Clicking a Codex past row spawns a Codex pane resuming that thread (`spawn_pane` with `agent_type: 'codex'`, `resume_session_id: <threadId>`). `dual.rs` then skips `start_thread_blocking`, attaches the TUI with `resume <threadId>`, and the hub connects with `thread/resume`.
- After the Codex pane registers, Rust calls `thread/read {threadId, includeTurns: true}`. It maps each turn's items through `codex_notifications.rs` `map_item_completed` (made `pub`, plus a new `userMessage` arm that produces user `MessageDelta`/`MessageCompleted` from `content[].text`) with `turn_id = turn.id`, wrapped in `TurnStarted`/`TurnCompleted`, and calls `seed_history`. Param names are confirmed against `codex app-server generate-json-schema` (S5 dir) before coding.
- Codex archive and delete appear in `SessionContextMenu` for Codex past rows only (`thread/archive`, `thread/delete`). Delete asks for confirmation. Claude rows keep having no menu (existing `!session.claudeResumeId`).
- Listing without an open Codex pane: `codex/catalog.rs` (NEW) lazily starts one background `codex app-server` per app run (same manifest `launch.server`, port from the agent range, registered in `ports`, killed in `app_lifecycle` on exit).
  - It serves `codex_list_threads(cwd)`, `codex_archive_thread(id)` and `codex_delete_thread(id)` (NEW Tauri commands) over a short-lived `CodexWsClient`-style request helper. `codex_ws.rs` gets `pub fn request_once(ws_url, method, params, timeout) -> Result<Value>` (NEW), with a stub in `codex_ws_stub.rs`.
  - Results are cached for 30 s and refetched on pane open or close (same key as `useClaudePastSessions`).
  - Threads open in a pane are excluded, as for Claude in `claude_list_sessions`.

**Contracts.**
- `PastThread { id, title, updated_at }`, the same shape as `PastSession`.
- TS `ShellSession` gains `codexResumeId?: string`.
- Hook `useCodexPastSessions` (NEW), mirroring `hooks/useClaudePastSessions.ts`.

**Edge cases.**
- Codex not installed: an empty list with no error row.
- The catalog server fails: one warning in the log and the list is empty.
- A thread with zero turns (only `thread/name/set`): skip it.
- Thread title: `thread.name` if it is not "Loomria", else the first user message trimmed to 80 characters.

**Acceptance.**
- U: the `thread/list` reply mapping; the `thread/read` turns to events (fixture saved from a live call with personal data removed, `src-tauri/tests/fixtures/codex_thread_read.json`, NEW); the `userMessage` mapping; `dual.rs` resume argument selection (pure helper).
- L: restart the app; the Codex past row appears; clicking it opens a pane with the full previous transcript; send "ok?" and Codex answers with memory; archive hides the row.

### 3.7 Codex correctness (P0)

1. **Questions** (`item/tool/requestUserInput`):
   - Fix contradiction 1: `CodexAppServerSession::respond_to_approval` passes any `answer:`-prefixed decision straight to `respond_approval_rpc` and emits `ApprovalResolved{AllowOnce}`. `deny` still parses.
   - `QuestionDock` renders a question with `secret: true` as `<input type="password" autocomplete="off">` with no echo in the transcript.
   - `allow_other` shows the existing custom-text row (`custom: true`).
   - `auto_resolution_ms`: the dock shows "Auto-answers in Ns", counting down from the dock's receive time. At 0 it shows "Codex will continue on its own" and stays answerable; the server decides.
   - Logging: `session_respond_approval` logs `decision_kind` (`allow_once|allow_always|deny|answer`) and never the text. Rust `tracing` never prints `params` of `requestUserInput`.
2. **MCP elicitation** (`mcpServer/elicitation/request`):
   - It is simple if every property in `params.requestedSchema.properties` (confirm the key name in S5) is a string (optionally an enum), boolean or number. Then it maps to `ApprovalKind::Question` with an `elicitation` payload, and the dock renders one field per property (enum as options, boolean as Yes/No, string as text, a `format: password` hint as secret).
   - Otherwise it maps to `ApprovalKind::Other` with options `[AllowOnce, Deny]`, labelled Accept/Decline, with the message as the detail.
   - Replies: accept is `{action:"accept", content:{...}}` (content `{}` for the complex case), decline is `{action:"decline"}`, and Stop is `{action:"cancel"}`.
3. **Policy presets**:
   - `CodexThreadOptions` presets (NEW `CodexPreset` enum in `types.rs`):
     - ReadOnly is `read-only` + `on-request`.
     - Auto (default) is `workspace-write` + `on-request`.
     - FullAccess is `danger-full-access` + `never`.
   - `dual.rs` passes the pane's preset to `start_thread_blocking` instead of `default()`. `codex/protocol.rs` passes `codex: Some(preset options)`.
   - `CodexAppServerSession::set_option("preset", id)` stores it, so the next `turn/start` carries it (resume never carries overrides; see the comment in `codex_ws.rs`).
   - `set_option("model", id)` and `set_option("effort", id)` store values that are added to `turn/start` as `model` and `effort`.
   - `agent_info()` (NEW for Codex) returns `{thread_ready, models (from model/list, fetched once after the handshake), current_model, preset, effort, efforts (from the model entry), skills (from skills/list, if the method exists, else [])}`.
   - The preset is per pane, remembered in `localStorage` key `loomria-codex-preset` as the default for new panes. Full access requires a confirm bar: "Codex can run any command and edit any file without asking."
   - Env override `LOOMRIA_CODEX_TURN_APPROVAL` keeps working for tests.
4. **Visible fallback**:
   - `dual.rs` `fallback_pty` sets `PaneInfo.fallback_error: Option<String>` (NEW, serialized) and emits `pty://panes-changed`.
   - `AgentView` shows an error banner: "Codex chat could not start: <err>. This pane is a read-only terminal." with a Retry button.
   - Retry calls `codex_retry_app_server(pane_id)` (NEW command): it kills the fallback pane and re-runs `spawn_pane` with the same `pane_id`, cwd and preset. On success the banner disappears.
   - `thread/start` failure after the server started (today `Err` returned to the caller) also goes to the fallback with the error.
5. **Stop**:
   - `cancel_turn` for Codex first answers every pending server request: `item/commandExecution|fileChange/requestApproval` with `{decision:"cancel"}`, legacy approvals with `{decision:"abort"}`, `requestUserInput` with `{answers:{}}`, and elicitation with `{action:"cancel"}`. Each one emits `ApprovalResolved{Deny}`.
   - Then it sends `turn/interrupt`.
   - If no turn is active, it is a no-op returning Ok (not an error).
6. **GUI and attached TUI agree**: a live check only (S6). If they disagree, record it in `docs/codex-protocol-notes.md` and show "Show TUI" as read-only in the tooltip.

**Acceptance.**
- U: the answer path through `CodexAppServerSession` (fake client), with a secret not present in log output (capture `tracing` with a test subscriber); the elicitation simple/complex classifier and the reply builders; preset to thread and turn params; the cancel sequence order (pending replies before `turn/interrupt`, using the socket test pattern from `unknown_server_request_is_answered_over_the_socket`); `fallback_error` set on fallback.
- L:
  1. Prompt Codex to ask a question with an "Other" answer, then answer free text, and Codex uses it.
  2. A secret question: the input is masked and the app log has no answer text.
  3. Countdown is visible.
  4. Reject a command: it does not run.
  5. Always allow: a second identical command runs without asking.
  6. Stop during a running command: the turn ends Cancelled.
  7. Stop during an open approval: the dock clears and the turn ends.
  8. Preset Read only: an edit attempt is refused by Codex.
  9. Rename `codex` on PATH in a test env: the banner and Retry appear.
  10. S6: a GUI turn appears in Show TUI.

### 3.8 Claude extras (P1)

1. **Effort and fast mode**:
   - Spike S4 first (`claude --help`, `initialize` `models[].supportedEffortLevels`, try control `set_effort`/`apply_flag_settings`).
   - If a control request works: `set_option("effort", level)`.
   - Else restart the `-p` process with the flag: a new hub registration with `--resume` and the same session id, using the existing `session_claude_to_chat` re-register path. The new epoch rule (2.1) makes this safe.
   - The picker lists only levels the current model supports. Fast mode is a toggle in the same list, shown only if S4 finds a flag.
2. **Waiting-in-terminal chip**:
   - `ClaudeMirrorSession` tracks open `tool_use` ids without a `tool_result`. Every 400 ms tick, if one is open and the companion PTY's `last_output` (from `PaneState.last_output` through a new closure argument to `claude_mirror::start`, like `write`) is older than 1 s, it emits a sticky Notice `{id:"claude-waiting-terminal", level:info, text:"Claude is waiting for you in the terminal", action:FocusTerminal, sticky:true}`.
   - When the result arrives or output resumes, it emits `cleared:true`.
   - The chip focuses the terminal pane: a NEW `focusTerminalSession(paneId)` in `terminal/terminal-session-registry.ts`, using the entry from `getTerminalSessionEntry`.
3. **"Always allow" caption** (`PermissionDock.tsx`):
   - Under the Always allow button, when the pane is Claude: "Saved to .claude/settings.local.json in this project".
   - `PermissionDockItem` gains `alwaysCaption?: string`, set in `buildPermissionDockItems` from the agent family.
4. **Attachments**:
   - `ProtocolSession` gains `fn send_prompt_with(&self, text: String, attachments: Vec<PromptAttachment>) -> Result<(), AgentError>`, with a default that calls `send_prompt` if `attachments` is empty and returns `Unsupported` otherwise.
   - `PromptAttachment { name, mime, data_base64 }` (NEW in `types.rs`).
   - `ProtocolHub::send_prompt_with` goes in both hub files. `SessionSendPromptArgs` gains `#[serde(default)] attachments`.
   - Claude builds `message.content = [{type:"image", source:{type:"base64", media_type, data}}…, {type:"text", text}]`. It accepts png, jpeg, gif and webp, at most 5 MB each.
   - `@path` mentions stay plain text (Claude resolves them). The mention picker uses `fs_walk_files` for Claude panes.
   - The user bubble shows image chips; replay shows "[image]" chips from `image` blocks in `claude_session_file.rs`.

**Acceptance.**
- U: the effort option mapping; the waiting-chip timer logic (pure function: open tools, last output, now → emit/clear); the caption shown only for Claude; the image content-block builder; the hub `send_prompt_with` in the stub.
- L:
  1. Effort switch and the next turn uses it (check `system/init` or the result).
  2. Open in terminal, ask for a Bash command: the chip appears within about 2 s; clicking focuses the terminal; approve there and the chip goes away.
  3. Attach a small png ("what colour is this?"): the answer names the colour.

### 3.9 Advanced (P2)

Only outlined here. Each item gets a full spec before implementation.

- **Fork**:
  - Claude: `--resume <id> --fork-session` in a new pane; the new session id comes from `system/init`.
  - Codex: `thread/fork`, which gives a new pane on the same server.
  - UI: "Fork from here" on user rows (exists for OpenCode in `UserTurnRow`).
- **Rewind** ("Rewind to here" on user rows):
  - Codex: `thread/revert {beforeTurnId}`.
  - Claude: fork at a message uuid if Claude supports it headless (spike).
  - Otherwise hidden.
- **Compact**: Codex `thread/compact/start` behind `/compact`.
- **Review**: Codex `review/start` gives a notice and review items.
- **Steer**: the composer sends during a running turn. Codex: `turn/steer`. Claude: a stream-json user message mid-turn (spike).
- **Light theme**: out of scope until 3.1 and 3.4 are done.

---

## 4. Cross-cutting rules

- `protocol_hub.rs` and `protocol_hub_stub.rs` expose the same public methods and the same merge semantics, in the same commit. The same holds for `codex_ws.rs` and `codex_ws_stub.rs` (`CodexWsClient` methods), and for `lib.rs` `generate_handler!` against the `commands.rs` functions.
- Any new spawn of `claude` uses the existing path that scrubs `shell_env::NESTED_CLAUDE_ENV` (`pty/registry.rs`, `shell_env::apply_path_to_command`).
- Every server request Loomria receives gets an answer: a mapping, an error reply, or a cancel on Stop. This applies to Claude control requests too (2.2 producers).
- A capability flag flips only in the same commit as its live-check note in `docs/agent-gui-fix-plan.md` Progress.
- Tiny prompts only. Never kill processes the session did not start. Close the test app with `close-app.ps1`.
