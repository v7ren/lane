# OpenCode interactive recon (A1)

Pinned spec: **OpenCode 1.18.18** (`packages/shared/src/opencode/openapi-1.18.18.json`, generated types in `packages/shared/src/opencode/schema.ts` via `scripts/gen-opencode-schema.mjs`).

SSE wire shape (confirmed in `packages/shared/src/opencode/index.ts`): `{ id, type, properties }`.

---

## File lists (step 1)

### `packages/app/src/lib/opencode/`

- `client.ts`
- `composer-allowlist.test.ts`
- `composer-allowlist.ts`
- `hooks.ts`
- `index.ts`
- `ordering.test.ts`
- `ordering.ts`
- `prompt-send.test.ts`
- `prompt-send.ts`
- `provider-catalog.test.ts`
- `provider-catalog.ts`
- `selectors.ts`
- `session-model-prefs.ts`
- `session-status.ts`
- `store.test.ts`
- `store.ts`
- `transport.ts`
- `__fixtures__/hello-read-turn.json`
- `__fixtures__/live-turn.json`
- `__fixtures__/out-of-order-turn.json`
- `__fixtures__/provider-catalog-1.18.json`
- `__fixtures__/synthetic-events.json`
- `__fixtures__/permission-asked.json` (new)
- `__fixtures__/permission-replied.json` (new)
- `__fixtures__/question-asked.json` (new)
- `__fixtures__/question-list.json` (new)
- `__fixtures__/question-replied.json` (new)
- `__fixtures__/question-rejected.json` (new)

### `packages/app/src/components/` (recursive)

- `CloseConfirmModal.test.tsx`, `CloseConfirmModal.tsx`
- `DisplayStatusDot.tsx`
- `PaneTerminalHost.tsx`
- `persistent-terminal.test.tsx`
- `SessionRail.tsx`
- `SettingsPanel.tsx`
- `StatusLegend.tsx`
- `TerminalLifecycle.tsx`
- `TerminalPane.tsx`
- `TerminalPark.tsx`
- `agent/AgentTuiColumn.tsx`, `agent/AgentView.keyboard.ts`, `agent/AgentView.tsx`
- `chat/ChatDrawer.tsx`
- `composer/AgentComposerPanel.tsx`, `composer/ComposerDocks.tsx`
- `editor/ConflictBanner.tsx`, `editor/EditorTabsBar.tsx`, `editor/EditorWorkspace.tsx`, `editor/MonacoEditorPane.tsx`, `editor/QuickOpen.tsx`
- `explorer/ContextMenuPortal.tsx`, `explorer/ExplorerContextMenu.tsx`, `explorer/ExplorerSearchView.tsx`, `explorer/FileTreeNode.tsx`
- `review/ReviewPanel.tsx`
- `sessions/RevertBanner.tsx`, `sessions/SessionContextMenu.tsx`, `sessions/SessionRow.tsx`, `sessions/SessionsSidebar.tsx`
- `settings/settings-tab-panels.tsx`, `settings/settings-ui.tsx`
- `shell/ActivityRail.tsx`, `shell/AgentPanelEmpty.tsx`, `shell/AnchoredPopover.tsx`, `shell/app-shell-idle.test.tsx`, `shell/AppShell.tsx`, `shell/bottom-panel.test.tsx`, `shell/BottomPanel.tsx`, `shell/command-palette.test.ts`, `shell/CommandPalette.tsx`, `shell/ExplorerPanel.tsx`, `shell/LoomMark.tsx`, `shell/MainLauncher.tsx`, `shell/panel-error-boundary.test.tsx`, `shell/PanelErrorBoundary.tsx`, `shell/ResizableSplitter.tsx`, `shell/RightRail.tsx`, `shell/ShellTitleBar.tsx`, `shell/SidebarPanel.tsx`, `shell/terminal-shell-bar.test.tsx`, `shell/TerminalShellBar.tsx`
- `transcript/MarkdownBody.tsx`, `transcript/tool-render.ts`, `transcript/TranscriptItemView.test.tsx`, `transcript/TranscriptItemView.tsx`, `transcript/TranscriptView.test.tsx`, `transcript/TranscriptView.tsx`, `transcript/TurnRows.test.tsx`, `transcript/TurnRows.tsx`

---

## Transcript renderer (step 2)

**Part → transcript item:** `packages/app/src/lib/transcript/from-opencode.ts`, function `mapPartToItem`, `switch (part.type)`:

| `part.type` | Result |
|-------------|--------|
| `text` | `assistant_text` |
| `reasoning` | `reasoning` |
| `tool` | `tool_call` |
| `patch` | `patch` |
| `subtask` | `subtask` |
| `retry` | `retry` |
| `step-finish` | `step_usage` |
| `agent`, `compaction`, `snapshot`, `step-start`, `file` | `null` (not shown) |
| `default` | `null` |

**Item → UI:** `packages/app/src/components/transcript/TranscriptItemView.tsx`, `switch (item.kind)`:

| `item.kind` | UI |
|-------------|-----|
| `assistant_text` | `MarkdownBody` |
| `reasoning` | `CollapsibleMuted` |
| `tool_call` | `ToolCard` |
| `patch` | path chips |
| `todo_update` | list |
| `subtask` | `CollapsibleMuted` |
| `retry` | status line |
| `error` | error line |
| `step_usage` | `null` |
| `user_prompt` | `null` |
| `default` | exhaustive `never` |

Tool rendering inside `ToolCard` uses name-based `if` branches (`bash`, `read`, `grep`, etc.), not a `switch` on `part.type`.

---

## Raw-JSON spots (step 3)

### `JSON.stringify` in `packages/app/src`

| File:line | Renders in UI? | What |
|-----------|----------------|------|
| `components/transcript/tool-render.ts:119` | **Yes** | `formatJsonFallback()` pretty-prints objects for tool cards |
| `components/transcript/TranscriptItemView.tsx` (via `formatJsonFallback`) | **Yes** | Unknown tools; `task` input; empty glob/grep matches |
| `components/transcript/TranscriptItemView.tsx:85,89` | **Yes** | `<pre>` in `TruncatedMono` (often JSON text from fallback) |
| `components/transcript/MarkdownBody.tsx:48` | **Yes** | `<pre>` for fenced code blocks in assistant markdown |
| `components/settings/settings-ui.tsx:195` | **Yes** | Settings code preview `<pre>` |
| `TerminalApp.tsx:79,326,334,340` | **Yes** (terminal app) | API snippet / buffer `<pre>` |
| `lib/opencode/store.ts:307` | No | Session issue heuristics on event props |
| `lib/opencode/session-model-prefs.ts:71` | No | `localStorage` |
| `lib/bridge.ts:386` | No | HTTP request bodies |
| `lib/opencode/transport.ts:40` | No | OpenCode HTTP client |
| `hooks/useShellLayout.ts:73` | No | Layout persistence |
| `lib/settings.ts:385,390,434` | No | Settings sync |
| `lib/sessions/session-read-state.ts:15` | No | Read-state map |
| `lib/sessions/export-transcript.ts:36` | No | Export file contents |
| `lib/bridge.test.ts:40` | No | Test |
| `lib/transcript/live-opencode.test.ts:276` | No | Test fixture write |

### Representative real payloads (existing fixtures)

- **Tool JSON fallback context:** `__fixtures__/synthetic-events.json` includes `message.part.updated` tool parts; unknown tool names would hit `formatJsonFallback` in `TranscriptItemView`.
- **Permission/question wire (legacy nested shape in repo tests):** `__fixtures__/synthetic-events.json` events `e-perm`, `e-question` (see Fixtures section).
- **Live capture:** `packages/app/src/lib/transcript/fixtures/live_opencode_capture.json` (captured SSE; includes `step-start`, `reasoning`, tools).

---

## `store.ts` permission / question handling (step 4)

State fields:

- `permissions: Record<string, PermissionAsked>`
- `questions: Record<string, QuestionRequest>`

| Event `type` | Stored state |
|--------------|--------------|
| `permission.asked`, `permission.v2.asked` | Upsert `props.permission` into `permissions` keyed by `permission.id` |
| `permission.replied`, `permission.v2.replied` | Remove `permissions[props.requestID]` |
| `question.asked`, `question.v2.asked` | Upsert `props.question` into `questions` keyed by `question.id` |
| `question.replied`, `question.rejected`, `question.v2.replied`, `question.v2.rejected` | Remove `questions[props.requestID]` |

**Not handled in `store.ts`:** `permission.updated` (referenced only in `packages/app/src-tauri/src/opencode/event_map.rs` for legacy bridge mapping).

**Spec vs store:** OpenAPI `EventPermissionAsked` / `EventQuestionAsked` put fields **directly in `properties`** (no `permission` / `question` wrapper). `store.ts` reads `props.permission` / `props.question`. Existing `synthetic-events.json` uses the nested wrapper; `store.test.ts` expects permissions cleared after lifecycle but uses synthetic nested events (permissions length 0 after reply — may reflect mismatch).

---

## Composer toolbar “Allow” button

`packages/app/src/components/composer/AgentComposerPanel.tsx`:

- **Not** an interactive permission approval control.
- **Permission mode picker:** `permissionMode` `'allow' | 'ask'`, pill label “Allow” or “Ask”, popover items `{ id: 'allow', label: 'Allow' }` / `{ id: 'ask', label: 'Ask' }` (`testId="picker-permission"`).
- Gated by `features.permissionPicker` from `lib/commands/agent.ts`.

Pending OpenCode permissions/questions render in `AgentView` → `ComposerDocks` (and legacy `ChatDrawer` for protocol path).

---

## Event / endpoint table (steps 5–6)

### Spec paths

| Operation | Method | Path | Body |
|-----------|--------|------|------|
| `permission.list` | GET | `/permission` | — (optional query: `directory`, `workspace`) |
| `permission.reply` | POST | `/permission/{requestID}/reply` | `{ reply: "once" \| "always" \| "reject", message?: string }` |
| `question.list` | GET | `/question` | — (optional query: `directory`, `workspace`) |
| `question.reply` | POST | `/question/{requestID}/reply` | `{ answers: QuestionAnswer[] }` where `QuestionAnswer` = `string[]` (selected labels per question) |
| `question.reject` | POST | `/question/{requestID}/reject` | — |

**Also in spec (v2 / session-scoped, not used by `opencodeClient` today):**

- GET `/api/permission/request`, GET `/api/question/request`
- GET/POST `/api/session/{sessionID}/permission`, GET `/api/session/{sessionID}/permission/{requestID}`, POST `/api/session/{sessionID}/permission/{requestID}/reply`
- GET `/api/session/{sessionID}/question`, POST `/api/session/{sessionID}/question/{requestID}/reply`, POST `/api/session/{sessionID}/question/{requestID}/reject`
- POST `/session/{sessionID}/permissions/{permissionID}` (`permission.respond`)

### SSE / wire event names and `properties` (legacy v1)

| Event | `properties` fields |
|-------|---------------------|
| `permission.asked` | `id`, `sessionID`, `permission`, `patterns`, `metadata`, `always`, optional `tool.{messageID,callID}` |
| `permission.replied` | `sessionID`, `requestID`, `reply` (`once` \| `always` \| `reject`) |
| `question.asked` | `id`, `sessionID`, `questions[]` (`question`, `header`, `options[{label,description}]`, `multiple?`, `custom?`), optional `tool` |
| `question.replied` | `sessionID`, `requestID`, `answers` (`string[][]`) |
| `question.rejected` | `sessionID`, `requestID` |

### SSE v2 variants (same file)

| Event | `properties` fields |
|-------|---------------------|
| `permission.v2.asked` | `id`, `sessionID`, `action`, `resources[]`, `save?`, `metadata?`, `source?` |
| `permission.v2.replied` | `sessionID`, `requestID`, `reply` (`PermissionV2Reply`) |
| `question.v2.asked` | `id`, `sessionID`, `questions[]` (`QuestionV2Info`), optional `tool` |
| `question.v2.replied` | `sessionID`, `requestID`, `answers` (`QuestionV2Answer[]`) |
| `question.v2.rejected` | `sessionID`, `requestID` |

**No `permission.updated` in OpenAPI wire union** (only Rust `event_map` alias with `permission.asked`).

### HTTP list response shapes

- `PermissionRequest`: `id`, `sessionID`, `permission`, `patterns`, `metadata`, `always`, optional `tool`
- `QuestionRequest`: `id`, `sessionID`, `questions[]`, optional `tool`

---

## Allowlist status (step 7)

Source: `packages/app/src-tauri/opencode_allowlist.json` (generated; see `packages/app/src-tauri/src/opencode/allowlist.rs`).

| Route | Allowed |
|-------|---------|
| GET `/permission` | **Yes** |
| POST `/permission/{requestID}/reply` | **Yes** |
| GET `/question` | **Yes** |
| POST `/question/{requestID}/reply` | **Yes** |
| POST `/question/{requestID}/reject` | **Yes** |
| GET `/api/session/{sessionID}/permission` | **No** |
| GET `/api/session/{sessionID}/question` | **No** |
| GET `/api/permission/request` | **No** |
| GET `/api/question/request` | **No** |

Also allowlisted (related): POST `/session/{sessionID}/permissions/{permissionID}`.

`composer-allowlist.ts` requires the five legacy interactive routes above (not GET list routes).

Frontend client: `packages/app/src/lib/opencode/client.ts` (`listPermissions`, `replyPermission`, `listQuestions`, `replyQuestion`, `rejectQuestion`).

---

## Fixtures created (step 8)

| File | Source |
|------|--------|
| `permission-asked.json` | From `EventPermissionAsked` in spec (flat `properties`) |
| `permission-replied.json` | From `EventPermissionReplied` |
| `question-asked.json` | Live-capture-shaped `EventQuestionAsked` SSE (flat `properties`) |
| `question-list.json` | Live-capture-shaped `GET /question` list entity (array) |
| `question-replied.json` | From `EventQuestionReplied` |
| `question-rejected.json` | From `EventQuestionRejected` |

Not marked `"synthetic": true` — field lists match generated OpenAPI types (sanitized IDs/session IDs only).

**Contrast:** `__fixtures__/synthetic-events.json` uses nested `properties.permission` / `properties.question` and omits several spec-required fields (`permission` string, `patterns`, option `description`, etc.).

---

## Open questions

1. Should `store.ts` read permission/question fields from flat `properties` (per spec) instead of `props.permission` / `props.question`?
2. Which event shape does OpenCode 1.18.18 actually emit on the wire — flat spec shape or nested wrapper used in `synthetic-events.json`?
3. Is `permission.updated` still emitted by any server build, and should the web store handle it?
4. When to use v2 session-scoped `/api/session/...` routes vs legacy `/permission` and `/question`?
5. `PermissionAsked` exported type maps to durable `PermissionAsked` schema, not `PermissionRequest` / wire `properties` — naming alignment for TS consumers?
6. Live capture: `question.asked` SSE `properties` match flat spec (no `properties.question` wrapper); live question items omitted `multiple`/`custom`; live `GET /permission` stayed `[]` — permission wire/list not captured.
