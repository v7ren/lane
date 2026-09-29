# Loomria

Desktop universal agent surface: run multiple coding-agent TUIs in one window, driven by manifest files instead of a hard-coded agent list.

Derived from [Puppet Master](https://github.com/Potato-dev-inc/puppet-master) by Potato-dev-inc (MIT). See [LICENSE](LICENSE) for the original copyright notice.

## Development

- Node.js 22+
- Rust toolchain (`cargo` on PATH)

```bash
npm install
npm run typecheck
npm run test
cargo check --manifest-path packages/app/src-tauri/Cargo.toml
```

Custom agents: drop TOML manifests into the user agents directory (see [docs/example-agent.toml](docs/example-agent.toml)).

## Workspaces

- `packages/app` — Tauri 2 + React terminal UI
- `packages/shared` — shared TypeScript types and schemas
