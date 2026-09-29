# Phase 5 local gate: deploy user manifests, verify catalog, fake-agent CLI smoke, orphan snapshot.
$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$AgentsDir = Join-Path $env:APPDATA 'com.loomria.app\agents'
$FakeMjs = Join-Path $RepoRoot 'scripts\fixtures\fake-agent.mjs'
$Node = (Get-Command node -ErrorAction Stop).Source

New-Item -ItemType Directory -Force -Path $AgentsDir | Out-Null

$fakeToml = @"
schema_version = 1
id = "fake-agent"
label = "Fake Agent (fixture)"
description = "Scripted TUI for smoke tests"
icon = "FA"
is_tui = true
show_in_new_pane_menu = true

[launch.tui.windows]
command = "$($Node.Replace('\', '/'))"
args = ["$($FakeMjs.Replace('\', '/'))"]
powershell_shim = false

[launch.tui.macos]
command = "node"
args = ["$($FakeMjs.Replace('\', '/'))"]

[launch.tui.linux]
command = "node"
args = ["$($FakeMjs.Replace('\', '/'))"]

[[attention]]
pattern = "(?i)allow once|allow always"
means = "needs_approval"
"@

Set-Content -Path (Join-Path $AgentsDir 'fake-agent.toml') -Value $fakeToml -Encoding utf8

$brokenToml = @"
schema_version = 99
id = "broken-agent"
label = "Broken"
[launch.tui.windows]
command = "node"
args = ["{not_allowed}"]
"@
Set-Content -Path (Join-Path $AgentsDir 'broken-agent.toml') -Value $brokenToml -Encoding utf8

Write-Host "Wrote fake-agent.toml and broken-agent.toml to $AgentsDir"

Push-Location $RepoRoot
try {
  Write-Host "`n--- cargo test gate5_user_manifests ---"
  cargo test --manifest-path packages/app/src-tauri/Cargo.toml --test gate5_user_manifests user_agents_dir_fake_agent
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  Write-Host "`n--- fake-agent.mjs approve smoke (no Tauri) ---"
  $input = "approve`nexit`n"
  $out = $input | & $Node $FakeMjs 2>&1 | Out-String
  if ($out -notmatch 'Allow once') {
    throw "fake-agent approve output missing Allow once; got: $out"
  }
  Write-Host 'fake-agent CLI smoke OK'

  Write-Host "`n--- orphan-check before (baseline) ---"
  & (Join-Path $RepoRoot 'scripts\orphan-check.ps1') before
} finally {
  Pop-Location
}

Write-Host "`nGate 5 local automation done. Start the app (npm run dev), open New pane -> Fake Agent, then run:"
Write-Host "  .\scripts\orphan-check.ps1 after"
Write-Host "  .\scripts\orphan-check.ps1 diff"
