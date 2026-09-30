# Gap audit: Phases 3–5 (B1)

Audit method: read source/tests in `loomria-ui` on branch `rebuild/main` (includes commit `c713063`). Status per line: **BUILT**, **PARTIAL**, or **MISSING**.

---

## Phase 3 — composer / transcript

| Item | Status | Evidence | Note |
|------|--------|----------|------|
| Agent picker | **BUILT** | `packages/app/src/components/composer/AgentComposerPanel.tsx:447-539` (`picker === 'agent'`, `setAgent`, passed as `agent` in `sendOpenCodePrompt` at `:287-292`) | OpenCode composer only (`composerFeaturesOpenCode`). |
| Model picker (explicit sends `model`, default sends none) | **BUILT** | `AgentComposerPanel.tsx:285-295` uses `getUserPickedSessionModel` only; `packages/app/src/lib/commands/agent.ts:14-28` omits `model` when undefined | Pill may show session model (`:365-368`) without sending until user picks. |
| Permission-mode picker | **BUILT** | `lib/commands/agent.ts` `sendOpenCodePrompt` PATCHes the session `permission` ruleset when the user explicitly picks (commit `fc5bb61`) | Verified live in the A12 gate (Ask mode raises permission docks). |
| `@file` mentions (`/find/file`) | **BUILT** | `AgentComposerPanel.tsx:243-258,587-600`; `packages/app/src/lib/commands/agent.ts:75-80` → `findProjectFiles` / `client.ts:108-118` `GET /find/file` | @-picker also inserts `file://` file parts. |
| Slash commands (`/command`, `/session/:id/command`) | **BUILT** | List: `AgentComposerPanel.tsx` loads commands + `PickerPopover` `:602-610`; send: `:276-283` → `sendOpenCodeSlashCommand` → `agent.ts:39-48` → `client.ts:83-84` | Raw `/name args` path on submit. |
| Shell mode (`/session/:id/shell`) | **BUILT** | `AgentComposerPanel.tsx:273-275,621-623`; `agent.ts:31-36` → `client.ts:85-86` | `!` prefix or shell mode toggle. |
| Image attachments (file parts) | **BUILT** | Attachments are read to data URLs before `prompt_async` (commit `c502077`, 10 MB cap) | Not exercised live yet. |
| Send via `prompt_async` | **BUILT** | `agent.ts:22-28` → `client.ts:81-82`; store marks busy `agent.ts:22` | — |
| Stop via abort | **BUILT** | `AgentComposerPanel.tsx:498`; `agent.ts:51-52` → `client.ts:87-88`; `AgentView.tsx:255-256` | Composer stop + header cancel for OpenCode pane. |
| Markdown + code highlight | **BUILT** | `packages/app/src/components/transcript/MarkdownBody.tsx:2-51` (`react-markdown`, `highlight.js`) | Used from transcript item rendering. |

---

## Phase 4 — sessions

| Item | Status | Evidence | Note |
|------|--------|----------|------|
| List | **BUILT** | `packages/app/src/components/sessions/SessionsSidebar.tsx`; `merge-sessions.ts:54-107` `buildOpenCodeShellSessions` | OpenCode sessions from store + protocol panes. |
| Search | **BUILT** | `SessionsSidebar.tsx:63-69`; `filter-sort.ts:6-13` `filterSessions` | Client-side title/agent filter. |
| Create | **BUILT** | `SessionsSidebar.tsx:49-57`; `session-actions-context.tsx:51-67` → `opencode-session-actions.ts:42+` | — |
| Rename | **BUILT** | `SessionRow.tsx:50-68`; `session-actions-context.tsx:78-87` | Inline rename + patch title API. |
| Delete | **BUILT** | `SessionContextMenu.tsx`; `session-actions-context.tsx:89-97` → `deleteSession` | — |
| Fork at a message | **BUILT** | `AgentView.tsx:396-400`; `opencode-session-actions.ts:138-144`; tests `opencode-session-actions.test.ts:40-67` | Transcript context action. |
| Revert / unrevert | **BUILT** | `session-actions-context.tsx:123-137`; `opencode-session-actions.ts:64-76`; live test `live-opencode-sessions.test.ts:201-211` | — |
| Summarize / compact | **BUILT** | `SessionContextMenu.tsx:49-51`; `session-actions-context.tsx:145-153` → `POST .../summarize` | — |
| Share link | **BUILT** | `SessionContextMenu.tsx:56-66`; `session-actions-context.tsx:161-182`; `RightRail.tsx:66-67` displays `shareUrl` | Copy + unshare. |
| Export transcript | **BUILT** | `session-actions-context.tsx:190-214`; `export-transcript.ts` | — |
| Child sessions | **BUILT** | `merge-sessions.ts:93` `parentSessionId`; `nestChildSessions` `:153-186`; `SessionRow.tsx:34` depth padding | Nested list UI. |
| Fork from menu without message | **BUILT** | `lib/sessions/session-actions-context.tsx` `forkFromHere` -> `forkAtLatestAssistant` (commit `5833ee5`) | Reads the real `[{ info, parts }]` message shape (fixed in `ef09d83`). Not exercised live yet. |
| Concurrent sessions | **BUILT** | Multiple `sessionOrder` per pane; selection `AppShell.tsx:170-177`; live test creates A+B `live-opencode-sessions.test.ts:175-176` | One active selection per pane. |
| Unread markers | **BUILT** | `merge-sessions.ts:81-87`; `SessionRow.tsx:92+`; `markSessionRead` in `SessionsSidebar.tsx:142` | Heuristic from status + `session-read-state`. |
| TUI sync (`/tui/select-session`) | **BUILT** | `use-tui-sync.ts:19-21` → `client.ts:50-51` `opencode_select_tui_session`; wired `AppShell.tsx:179-183`; allowlist `src-tauri/opencode_allowlist.json` + `proxy.rs:127` | Debounced on selection when TUI visible. |

---

## Phase 5 — editor

| Item | Status | Evidence | Note |
|------|--------|----------|------|
| Explorer tree + `/file/status` badges | **BUILT** | `ExplorerPanel.tsx:25-34` `fileGitStatus`; `opencode-file-actions.ts:41-48` `GET /file/status`; `FileTreeNode.tsx` `gitStatus` prop | Tree via scoped `fsListDir`. |
| Ctrl+P fuzzy open | **BUILT** | `useShellKeyboard.ts:55-58`; `AppShell.tsx` opens palette file mode; `opencode-file-actions.ts:18-20` `/find/file` | Command palette file mode. |
| Text search (`/find`) | **BUILT** | `ExplorerSearchView` (panel toggle `ExplorerPanel.tsx:42-64`); `findInFiles` `opencode-file-actions.ts:25-38` `GET /find` | — |
| Monaco tabs, dirty state, scoped save | **BUILT** | `EditorTabsBar.tsx:36`; `tabs.ts:63-71`; `EditorContext.tsx:177-182` `fsWriteFile` | Tauri scoped fs commands. |
| Conflict when `file.edited` on dirty buffer | **BUILT** | `lib/editor/file-edited-bus.ts` + `decideFileEdited` in `conflict.ts`, handled in `EditorContext.tsx` (commit `36409f7`) | Unit-tested; not exercised live yet. |
| Review panel (Monaco diff) | **BUILT** | `ReviewPanel.tsx:36-43` `sessionDiff` `/session/:id/diff`, `vcsWorkingDiff` `/vcs/diff`; Monaco `DiffEditor` | — |
| Add to chat | **BUILT** | `MonacoEditorPane.tsx:56-65`; `ExplorerContextMenu.tsx:37`; `add-to-composer.ts`; listener `AgentComposerPanel.tsx:135-148` | — |
| Fs root-escape tests (`..`, absolute) | **BUILT** | `packages/app/src-tauri/src/fs_scoped.rs:530-541` `rejects_parent_traversal`, `rejects_absolute_path` | — |
| Fs symlink escape test | **BUILT** | `fs_scoped.rs` tests `rejects_junction_escape`, `rejects_symlink_dir_escape` (+ unix variants) (commit `640dd65`) | The tests found and fixed two real escapes (`walk_dir` followed links; dangling-link writes). Unix variants compile but were not run on Windows. |

---

## Phase 1 / 6 leftovers

| Item | Status | Evidence | Note |
|------|--------|----------|------|
| Ctrl+K palette | **BUILT** | `useShellKeyboard.ts:50-53` | Opens command palette. |
| Ctrl+Shift+L | **BUILT** | `useShellKeyboard.ts:70-73` → `onNewAgent` | New agent session. |
| Ctrl+J bottom panel | **BUILT** | `useShellKeyboard.ts:60-63` | Toggle bottom panel. |
| Ctrl+P files | **BUILT** | `useShellKeyboard.ts:55-58` | File palette. |
| Ctrl+` | **BUILT** | `useAppKeyboard.ts:35-38` via `useShellKeyboard.ts:35-43` (`onSwitchTerminalTab`) | Switches toward terminal tab. |
| Panel sizes persisted | **BUILT** | `useShellLayout.ts:21-45` localStorage `loomria-shell-layout-v2`; `:99-152` merges into settings `shell_layout` | Sidebar/explorer/rail/bottom ratio. |

---

## Suggested B2 order

Group by primary file ownership so parallel executors do not touch the same paths.

### 1) Composer files (`AgentComposerPanel.tsx`, `commands/agent.ts`, `session-model-prefs.ts`)

| # | Gap | Size | Files |
|---|-----|------|-------|
| 1.1 | Wire permission-mode picker into OpenCode send/config (today UI-only) | **M** | `AgentComposerPanel.tsx`, possibly `agent.ts`, `opencode-session-actions.ts` |
| 1.2 | Image attachments: read files to API-safe parts (base64/data URL) before `prompt_async` | **M** | `AgentComposerPanel.tsx`, `agent.ts` |
| 1.3 | (Optional) Mention file parts: same encoding as images for non-text assets | **S** | `AgentComposerPanel.tsx` |

### 2) Session list / store files (`session-actions-context.tsx`, `SessionContextMenu.tsx`, `store.ts`)

| # | Gap | Size | Files |
|---|-----|------|-------|
| 2.1 | Implement `forkFromHere` (pick message or use latest assistant message) instead of toast stub | **M** | `session-actions-context.tsx`, `SessionContextMenu.tsx` |
| 2.2 | Bridge OpenCode `file.edited` to editor conflict when path matches open dirty tab | **L** | `store.ts`, `EditorContext.tsx`, small hook or bus |

### 3) Explorer / Monaco / Rust fs (`fs_scoped.rs`, editor conflict)

| # | Gap | Size | Files |
|---|-----|------|-------|
| 3.1 | Add symlink/junction root-escape tests (+ fix if canonicalize escapes) | **M** | `packages/app/src-tauri/src/fs_scoped.rs` only |

---

## Summary counts (updated after B2)

| Status | Count |
|--------|------:|
| BUILT | 44 |
| PARTIAL | 0 |
| MISSING | 0 |

Remaining optional item: encode `@`-mention `file://` parts like uploads (B2 1.3). Not needed for any audited line.
