# Agent-first Loomria, with an IDE-mode switch

## Goal

Loomria opens as an **agent app**, in the spirit of Claude Desktop and the Codex app. The conversation with the agent is the main surface. The full workspace (explorer, Monaco editor, review, bottom panel with user shells) is still there, one click away, as **IDE mode**.

Today the chat lives in the bottom panel's AGENT tab, under the editor and launcher (`AppShell.tsx`, bottom-panel host). Agent-first therefore means **promoting the existing `AgentView` into the centre column**. We are not writing a new chat component.

## Modes

`UiMode = 'agent' | 'ide'`. It is a new type. Do **not** reuse `AppMode` from `hooks/useWorkspaceMode.ts`, which gates the approval shortcuts and is unrelated.

| Region | Agent mode (default) | IDE mode (today's layout, unchanged) |
|---|---|---|
| Title bar | yes, with the Agent / IDE switch | yes, with the Agent / IDE switch |
| Activity rail | yes | yes |
| Sessions sidebar column | yes | yes |
| Explorer panel | hidden | shown |
| Centre | `AgentView` at full height, not embedded, plus RevertBanner and the TUI column when `showTui`; `AgentHome` when no pane is selected | `EditorWorkspace` with the bottom panel (AGENT / TERMINAL tabs) |
| Bottom panel | hidden | shown |
| Right rail | same responsive rule as today | same as today |
| TerminalPark / TerminalLifecycle / overlays | always mounted | always mounted |

IDE mode must render exactly what renders today. Every existing test seeded with `ui_mode: 'ide'` must keep passing unchanged.

## Switching

- **Persisted** as `ui_mode` in `Settings` (zod `SettingsSchema` in `packages/shared/src/schemas.ts`, default `'agent'`). Also add it to `DEFAULT_SETTINGS` in `packages/app/src/lib/settings.ts`. It is not exported to the bridge.
- `hooks/useUiMode.ts` returns `{ uiMode, setUiMode, toggleUiMode }`.
  - Initial state comes from the localStorage cache `loomria-ui-mode`, so the first paint shows the right mode, falling back to `'agent'`.
  - It then hydrates from `loadSettings()`.
  - The setter writes both the cache and `updateSettings({ ui_mode })`. Every localStorage access goes in try/catch.
- Ways to switch:
  1. A segmented **Agent | IDE** control in `ShellTitleBar` (`data-testid="ui-mode-switch"`, buttons with `aria-pressed`).
  2. A rebindable keybind action `uiMode`, labelled "Toggle Agent / IDE mode", default `Ctrl+Shift+M`. Check it collides with nothing in `KEYBIND_ACTIONS` / `FIXED_SHORTCUTS`. It is handled in `useShellKeyboard`.
  3. A palette command `toggle-ui-mode` in section View, labelled "Switch to IDE mode" or "Switch to Agent mode" according to the current mode.
  4. An "Interface" radio in Settings → General, with "Agent-first" and "IDE".
- Automatic switch to IDE mode while in agent mode:
  - Anything that needs the editor area switches the mode first:
    - opening a file into the editor (quick open with Ctrl+P, a file link in the transcript or right rail, explorer reveal)
    - opening the Review view
    - the `bottom` (Ctrl+J) and `terminal` (Ctrl+`) actions
  - Implement this in one place where possible. For example, an effect in AppShell watches the editor's tab count and `mainView`, and calls `setUiMode('ide')` when either changes while in agent mode. The explicit keyboard actions call it directly.
  - Never switch back automatically.

## AgentHome (agent-mode empty centre)

`components/shell/AgentHome.tsx` (`data-testid="agent-home"`), centred and calm, matching the existing tailwind tokens:

- LoomMark and a heading: "What should we work on?"
- The project line shows the current `projectPath` basename, with full path as a tooltip, and a "Change folder" button that uses the same open-folder flow as the Workspaces sidebar.
- One card per agent in `agentCatalog` (AgentMark, name, short description if the catalog has one). Clicking a card calls `onNewSession(agentId)`.
- Up to 5 recent sessions for this project from the existing session list. Clicking one selects or resumes it the same way the sidebar row does. Reuse the sidebar's action, don't duplicate the logic.
- A small hint row: `Ctrl+Shift+L` new agent · `Ctrl+K` palette · `Ctrl+Shift+M` IDE mode. Read the real combos from keybinds, don't hard-code them.

`AgentPanelEmpty` stays as the bottom-panel empty state in IDE mode.

## Out of scope for this pass

- Changing `ShellLayout` or its collapsed flags.
- Changing `BottomPanel` internals or the Claude/Codex/OpenCode protocol code.
- Deleting `useWorkspaceMode`.

## Work breakdown

The tasks in Phase A touch disjoint files and can run in parallel. Phase B is the risky integration.

- **A1 Settings + hook**: `shared/src/schemas.ts`, `app/src/lib/settings.ts`, new `app/src/hooks/useUiMode.ts`, plus tests (schema default, hook cache/hydrate/persist). Rebuild shared afterwards.
- **A2 Keybind + palette**: `lib/keybinds.ts` (action `uiMode`), `hooks/useShellKeyboard.ts` (new optional `onToggleUiMode` param), `lib/commands/sessions.ts` (deps `uiMode?` and `onToggleUiMode?`, command `toggle-ui-mode`), plus updates to keybinds, sessions-command and KeybindsSection tests.
- **A3 AgentHome**: the new component and its test. Props are passed in, so there is no AppShell coupling.
- **A4 Title-bar switch**: `ShellTitleBar.tsx` gets optional props `uiMode` and `onUiModeChange` (it renders nothing when they are absent), plus a test.
- **A5 Settings UI**: an "Interface" radio in the General tab (`components/settings/settings-tab-panels.tsx`, wired like the other General controls) and its test.
- **B Integration** (`AppShell.tsx`):
  - Call `useUiMode`.
  - Branch the centre-column JSX by mode, keeping the IDE branch byte-for-byte the same in behaviour.
  - Hide Explorer in agent mode.
  - Wire the switch, keybind, palette, auto-switch and AgentHome.
  - Make sure the Claude TUI companion terminal still mounts in agent mode, through `PaneTerminalHost` / `TerminalPark` reparenting.
  - Seed `ui_mode: 'ide'` (or the `loomria-ui-mode` cache) in `app-shell-idle.test.tsx` and `panel-error-boundary.test.tsx`.
  - Add `app-shell-mode.test.tsx` with these cases:
    - The default is agent mode: agent-home shown; no explorer, editor or bottom panel.
    - Clicking IDE shows the explorer and bottom panel.
    - The keybind toggles the mode.
    - Opening a file in agent mode switches to IDE.
- **C Verify**:
  - `npm run typecheck`, full `npx vitest run` in `packages/app`, and shared tests.
  - Vite dev + Playwright screenshots, using the demo URL flags (`lib/demo-mode.ts`):
    - agent mode, empty
    - agent mode with a demo pane
    - IDE mode
