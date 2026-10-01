# Codex app-server protocol notes

Source: `codex app-server generate-json-schema` (codex-cli 0.159.2), spike S5 of `agent-gui-fix-plan.md`.
Server requests carry an `id` and a `method`; the client must answer each one with a JSON-RPC response that echoes the id (integers stay integers), or a JSON-RPC error. An unanswered request hangs the turn.

| Server request | Reply `result` |
|---|---|
| `item/commandExecution/requestApproval` | `{ decision: "accept" \| "acceptForSession" \| "decline" \| "cancel" }` (also `acceptWithExecpolicyAmendment`, `applyNetworkPolicyAmendment`) |
| `item/fileChange/requestApproval` | `{ decision: "accept" \| "acceptForSession" \| "decline" \| "cancel" }` |
| `execCommandApproval` (legacy v1) | `{ decision: "approved" \| "approved_for_session" \| "denied" \| "abort" \| "timed_out" }` (`denied` may also be `{ denied: { rejection } }`) |
| `applyPatchApproval` (legacy v1) | same as `execCommandApproval` |
| `item/permissions/requestApproval` | `{ permissions: GrantedPermissionProfile, scope: "turn" \| "session", strictAutoReview?: bool }`. Params carry `permissions` (the requested profile), `reason`, `cwd`, `itemId`. Allow = echo the requested `permissions`; deny = `{ permissions: {} }`. |
| `item/tool/requestUserInput` | `{ answers: { <questionId>: { answers: [string] } } }`. Params: `questions[]`, `isBlocking`, `autoResolutionMs`, `itemId`. |
| `mcpServer/elicitation/request` | `{ action: "accept" \| "decline" \| "cancel", content?: any, _meta?: any }`. Params: `serverName`, `threadId`, `turnId`, plus a schema of primitive fields. |

Unknown server request: reply with JSON-RPC error `-32601` (method not found) so the turn never waits on us.
