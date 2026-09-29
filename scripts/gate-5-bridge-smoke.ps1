# Spawn fake-agent via the live embedded bridge (debug token file required).
$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$AppData = Join-Path $env:APPDATA 'com.loomria.app'
$PortFile = Join-Path $AppData 'loomria.bridge.port'
$TokenFile = Join-Path $AppData 'loomria.bridge.token'

if (-not (Test-Path $PortFile)) {
  Write-Error "Bridge not running (missing $PortFile). Start: npm run dev"
  exit 2
}
if (-not (Test-Path $TokenFile)) {
  Write-Error "Missing debug token file $TokenFile — restart the app after a debug build."
  exit 2
}

$hostPort = (Get-Content $PortFile -Raw).Trim()
$token = (Get-Content $TokenFile -Raw).Trim()
$base = "http://$hostPort"
$headers = @{
  Host          = $hostPort
  Authorization = "Bearer $token"
  Origin        = 'http://127.0.0.1:1420'
  'Content-Type' = 'application/json'
}

Write-Host "GET $base/agents"
$agents = Invoke-RestMethod -Uri "$base/agents" -Headers $headers -Method Get
$fake = $agents.agents | Where-Object { $_.id -eq 'fake-agent' }
if (-not $fake) {
  Write-Error "fake-agent not in catalog: $($agents.agents | ForEach-Object { $_.id })"
  exit 1
}
Write-Host "fake-agent in launcher: show_in_new_pane_menu=$($fake.show_in_new_pane_menu)"

if ($agents.report.errors.Count -lt 1) {
  Write-Error "expected broken-agent.toml error in report"
  exit 1
}
Write-Host "manifest errors (expected): $($agents.report.errors | ConvertTo-Json -Compress)"

$spawnBody = @{ agent_type = 'fake-agent'; cols = 100; rows = 24 } | ConvertTo-Json
Write-Host "POST $base/panes (fake-agent)"
$spawn = Invoke-RestMethod -Uri "$base/panes" -Headers $headers -Method Post -Body $spawnBody
$paneId = $spawn.pane_id
Write-Host "pane_id=$paneId"

Start-Sleep -Seconds 3
$inputBody = @{ text = 'approve'; append_newline = $true } | ConvertTo-Json
Invoke-RestMethod -Uri "$base/panes/$paneId/input" -Headers $headers -Method Post -Body $inputBody | Out-Null
Start-Sleep -Seconds 2
$buf = Invoke-RestMethod -Uri "$base/panes/$paneId/buffer?lines=80" -Headers $headers -Method Get
$tail = if ($buf.content) { $buf.content } else { $buf.buffer_tail }
if ($tail -notmatch 'Allow once') {
  $snap = Invoke-RestMethod -Uri "$base/panes/$paneId/snapshot" -Headers $headers -Method Get
  $tail = $snap.content
}
if ($tail -notmatch 'Allow once') {
  Write-Error "buffer missing approval menu: $tail"
  exit 1
}
Write-Host 'fake-agent pane + approve attention OK'

Invoke-RestMethod -Uri "$base/panes/$paneId" -Headers $headers -Method Delete | Out-Null
Write-Host "killed pane $paneId"
Write-Host 'Bridge smoke passed.'
