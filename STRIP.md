# Loomria strip log

Carved from `puppet-master` @ `release/0.1.4-opencode-native`, remote renamed to `upstream`, branch `loomria/strip`.

## Phase 0 baseline (2026-09-29)

### Bootstrap (not in upstream clone alone)

Fresh `git clone` + `npm install` alone is **not** sufficient for green verification:

1. `npm run build --workspace=@puppet-master/shared` — `@puppet-master/shared` has no `dist/` until built; typecheck and vitest fail without it.
2. `node scripts/ensure-tauri-resources.mjs` — creates dev-stub `resources/pwa-dist/` and `resources/bin/cloudflared.exe`.
3. `node scripts/bundle-mcp.mjs` — writes `resources/mcp-stdio.bundle.cjs` (not carried from dirty upstream checkout).
4. `npx vite build` in `packages/app` — Tauri `generate_context!` requires `packages/app/dist/` for `cargo check`.

### typecheck (`npm run typecheck`)

- **Before shared build:** exit 2 — cannot find module `@puppet-master/shared` across app/cli/mcp workspaces.
- **After shared build:** exit 0 (all workspaces).

### unit (`npm run test`)

- **Before shared build:** exit 1 — 5 vitest suites failed to resolve `@puppet-master/shared` (22 passed, 129 tests).
- **After shared build:** exit 0 — `@puppet-master/app` 27 files, 188 tests passed.

### rustcheck (`cargo check --manifest-path packages/app/src-tauri/Cargo.toml`)

- **Before resources + dist:** exit 101 — `glob pattern resources/pwa-dist/* path not found` or missing `mcp-stdio.bundle.cjs`; later missing `frontendDist` `../dist`.
- **After bootstrap above:** exit 0 — finished with 6 warnings (dead code in coordination modules).

### app / four-pane smoke

- **Manual (operator):** launch Claude, Codex, OpenCode, PowerShell panes — type, resize, kill each. Record: _not automated in CI; run before release gates on a dev machine with agents installed._
- **Fake-agent smoke:** use `scripts/fixtures/fake-agent.mjs` via manifest after Phase 5.

### orphan check (`scripts/orphan-check.ps1`)

- **Before smoke:** baseline snapshot recorded via `before` mode.
- **After smoke:** _pending — expected non-zero delta at Phase 0 (Phase 2 target: zero delta)._

## Phase 3 frontend strip (2026-09-29)

- Removed orchestrator/PWA/pairing UI, detached panes, and slimmed settings to General + Developer.
- Dropped `vite-plugin-pwa`, `html5-qrcode`, `qrcode`; removed root `@ngrok/ngrok` and `cloudflared` devDeps.
- `App.tsx` full-width terminal grid; `TerminalApp.tsx` dev console only (no detached/worker-host).
- Minimal stubs kept for `bridge-ngrok`, `mobile-pairing-auth`, and mirror terminal helpers so `terminal-session.ts` still typechecks (desktop path uses `isMobileInputDevice() === false`).

**Gate 3:** `npm run typecheck` exit 0; `npm run test` 12 files / 46 tests pass.

## Phase 5 manifest registry (2026-09-29)

- Added `agents/` Rust module: TOML schema (`schema_version = 1`), `ProtocolKind`, built-ins under `src-tauri/manifests/`, user overrides in `%APPDATA%/com.loomria.app/agents/*.toml`.
- Replaced `pty/agents.rs` enum + `agent_adapters/` with manifest-driven `resolve_tui_command` and `observe_agent_output`.
- `GET /agents` (token-protected) and Tauri `list_agents` return summaries + per-file load errors.
- `@loomria/shared` agents API is catalog-driven; UI loads catalog via `useAgentCatalog`.
- Golden fixture `resolve_command.*.json` still passes against built-in manifests.

**New-agent proof (manual):** copy `scripts/fixtures/fake-agent.toml` into the user agents dir (adjust `node` path to `fake-agent.mjs` if needed), restart app — should appear in New pane menu. Drop a malformed `.toml` — error should appear in `list_agents` report.

**Gate 5:** `cargo test resolve_command_matches_golden_fixture`, `npm run typecheck`, `npm run test` (app 46 tests). Tag `phase-5-green` after four-pane + fake-agent smoke.

## Phases 6–8 (2026-09-29, incremental)

**Phase 6:** `protocol/` (`ProtocolAdapter` / `ProtocolSession`, `AgentEvent`), OpenCode HTTP adapter wired to `prompt_async`; Codex app-server + Claude stream-json adapters are stubs (TUI fallback). `session/supervisor.rs` owns port picking; OpenCode native uses it.

**Phase 7:** `session/state.rs` monitor → bridge SSE `session_state`; `sessions.json` persistence (10-session cap); `GET /sessions`; `list_resumable_sessions` command; notifications log-only for now.

**Phase 8:** Session rail UI, chat drawer + `send_session_prompt` for OpenCode API, `safe-agent-text` XSS tests. Full Codex WS + Claude headless/resume + driving-token TUI toggle remain follow-ups.

## Stream A gate cleanup (2026-09-29, branch `loomria/stream-a`)

### Deletions

- Rust orphans: `event_log.rs`, `session_context.rs`, `pane_wait_notify.rs` (long-poll waiters were unused after strip).
- Frontend mobile/mirror stubs: `mobile-input-guard.ts`, `mirror-*.ts`, `bridge-ngrok.ts`, `mobile-pairing-auth.ts`; desktop-only `terminal-session.ts`.
- Obsolete docs: `MCP_HOSTS.md`, `ROUTING.md`, `ROADMAP.md`, `docs/orchestrator/**`.
- Dead scripts: `bundle-mcp.mjs`, `bundle-cloudflared.mjs`, `stage-pwa-dist.mjs`, `dev-tunnel.mjs`, `test-bridge.ps1`, `ensure-tauri-resources.mjs`, `librarian-prompt.md`, `project-indexer.py`, `publish-github-release-assets.mjs`.

### Gate 1 grep (`rg -n "mcp_|mobile_|pwa_server|context_pack|projections|pane_wait" packages/app/src-tauri/src`)

- Only hit: `lib.rs:21` — `#[cfg_attr(mobile, tauri::mobile_entry_point)]` (allowed Tauri attribute).

### Gate 3 branding (`rg -i puppet` excluding STRIP/node_modules/target/package-lock)

- **PARTIAL:** ~30 paths remain (legacy strings in bridge/settings, SVG metadata, scripts, CHANGELOG). README + LICENSE attribution updated; `puppet-master.dev.json` → `loomria.dev.json`; branding SVGs renamed to `loomria-*.svg`.

### Verification (Stream A final)

| Command | Result |
|---------|--------|
| `npm run typecheck` | exit 0 |
| `npm run test` | exit 0 — app 58 tests, shared 4 tests |
| `cargo check` | exit 0 (24 warnings) |
| `cargo test` | 58 lib + 3 integration passed; 1 ignored (`process_tree_job` — nested job under `cargo test`) |
| `npm run build` | not run (Gate 3) |

### Manual gates

- **Four-pane smoke:** needs manual run — launch Claude, Codex, OpenCode, PowerShell; type, resize, kill each.
- **Orphan check:** `powershell -File scripts/orphan-check.ps1 before` → smoke → `after` (expect zero new node/codex/claude/opencode PIDs).

### New-agent proof

- Automated: `cargo test --test gate5_user_manifests` (temp dir + `echo-agent` PTY marker).
- Sample manifest: `docs/example-agent.toml`.

## Frontend minimal shell (pre–Phase 5)

- Boot splash, home dashboard, update banner, and full-screen settings removed.
- App opens directly on workspace: header (project, new pane, settings, kill all) + terminal grid.
- `index.css` reduced to tokens, xterm host, resize, and optional `?terminal` dev styles.
