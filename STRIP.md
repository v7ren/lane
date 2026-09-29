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

- **Manual (operator):** launch Claude, Codex, OpenCode, PowerShell panes — type, resize, kill each. Record: _pending operator run at gate 0._
- **Fake-agent smoke:** use `scripts/fixtures/fake-agent.mjs` via manifest after Phase 5.

### orphan check (`scripts/orphan-check.ps1`)

- **Before smoke:** baseline snapshot recorded via `before` mode.
- **After smoke:** _pending — expected non-zero delta at Phase 0 (Phase 2 target: zero delta)._
