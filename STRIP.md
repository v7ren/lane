# Loomria strip log

Carved from `puppet-master` @ `release/0.1.4-opencode-native`, remote renamed to `upstream`, branch `loomria/strip`.

## Phase 0 baseline (2026-09-29)

### Bootstrap (not in upstream clone alone)

Fresh `git clone` + `npm install` alone is **not** sufficient for green verification:

1. `npm run build --workspace=@loomria/shared` — `@loomria/shared` has no `dist/` until built; typecheck and vitest fail without it.
2. `npx vite build` in `packages/app` — Tauri `generate_context!` requires `packages/app/dist/` for `cargo check`.

### typecheck (`npm run typecheck`)

- **After shared build:** exit 0 (all workspaces).

### unit (`npm run test`)

- **After shared build:** exit 0 — app + shared vitest suites.

### rustcheck (`cargo check --manifest-path packages/app/src-tauri/Cargo.toml`)

- **After shared build + app `dist/`:** exit 0.

### app / four-pane smoke

- **Manual (operator):** see Gate 6 below.

### orphan check (`scripts/orphan-check.ps1`)

- **Usage:** `powershell -File scripts/orphan-check.ps1 before` → four-pane smoke → `powershell -File scripts/orphan-check.ps1 after` → `powershell -File scripts/orphan-check.ps1 diff` (exit 1 if new node/codex/claude/opencode PIDs).

## Phase 3 frontend strip (2026-09-29)

- Removed orchestrator/PWA/pairing UI; slimmed settings to General + Developer.
- `App.tsx` full-width terminal grid; desktop-only terminal path.

## Phase 5 manifest registry (2026-09-29)

- Rust `agents/` module + user overrides in `%APPDATA%/com.loomria.app/agents/*.toml`.
- Automated: `cargo test --test gate5_user_manifests`.

## Phases 6–8 (2026-09-29)

- `protocol/`, `session/` persistence, session rail, agent mode UI.

## Stream A gate cleanup (2026-09-29)

- Deleted mobile/mirror/orchestrator orphans; `docs/example-agent.toml` for custom agents.

---

## Gate 0–8 checklist (`loomria/polish`, 2026-09-29)

| Gate | Criterion | Status | Evidence / manual steps |
|------|-----------|--------|-------------------------|
| **0** | Clone installs; shared builds | **PASS (auto)** | `npm install`; `npm run build --workspace=@loomria/shared` |
| **1** | Strip grep: no orchestrator/mobile/PWA Rust orphans | **PASS (auto)** | `rg -n "mcp_\|mobile_\|pwa_server\|context_pack\|projections\|pane_wait" packages/app/src-tauri/src` → only `tauri::mobile_entry_point` attr |
| **2** | `npm run typecheck` | **PASS (auto)** | Run after shared build |
| **3** | Loomria branding (no stray `puppet` except LICENSE/README/CHANGELOG/STRIP/legacy fallbacks) | **PASS (auto)** | `rg -i puppet --glob "!node_modules" --glob "!STRIP.md" --glob "!target" --glob "!CHANGELOG.md" -l` |
| **4** | `npm run test` | **PASS (auto)** | Vitest app + shared |
| **5** | Rust unit + integration tests | **PASS (auto)** | `cargo test --manifest-path packages/app/src-tauri/Cargo.toml` incl. `process_tree_job`, `gate5_user_manifests`, `resolve_command_golden` |
| **6** | Four-pane smoke (real Tauri app) | **MANUAL** | Launch **Loomria** (not vite-only). New pane ×4: **Claude**, **Codex**, **OpenCode**, **PowerShell**. In each: type, resize split, kill pane. Expect no hung PTYs. |
| **7** | Orphan check after smoke | **MANUAL** | `powershell -File scripts/orphan-check.ps1 before` → Gate 6 → `after` → `diff` (expect exit 0). |
| **8** | Ten-session resume cap | **MANUAL** | In desktop app, spawn/resume **10** agent sessions (mix types), quit app, relaunch; confirm rail shows ≤10 resumable entries and oldest drops on 11th. |

### `process_tree_job`

- **PASS (auto):** `cargo test --manifest-path packages/app/src-tauri/Cargo.toml --test process_tree_job` (Windows Job Object + explicit PID terminate on drop).

### Tauri `gen/schemas`

- **Committed** — `capabilities/default.json` references `../gen/schemas/desktop-schema.json`; `cargo check` does not dirty these files on this branch (regenerated at build when needed).

### Verification bundle (release candidate)

```bash
npm run build --workspace=@loomria/shared
npm run typecheck
npm run test
cargo check --manifest-path packages/app/src-tauri/Cargo.toml
cargo test --manifest-path packages/app/src-tauri/Cargo.toml
cd packages/app && npx vite build
```
