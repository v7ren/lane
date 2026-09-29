# Snapshots processes that commonly leak when panes are killed without a job object.
# Usage:
#   ./scripts/orphan-check.ps1 before   # save baseline
#   ./scripts/orphan-check.ps1 after    # save after snapshot
#   ./scripts/orphan-check.ps1 diff     # compare after vs before (exit 1 if new PIDs)
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('before', 'after', 'diff')]
  [string]$Mode
)

$ErrorActionPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $PSScriptRoot
$StateDir = Join-Path $Root '.orphan-check'
$BeforeFile = Join-Path $StateDir 'before.json'
$AfterFile = Join-Path $StateDir 'after.json'

$ProcessNames = @('node', 'codex', 'claude', 'opencode', 'cmd')

function Get-ProcessSnapshot {
  $rows = @()
  foreach ($name in $ProcessNames) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object {
      $rows += [ordered]@{
        name = $_.ProcessName
        id   = $_.Id
        path = try { $_.Path } catch { $null }
      }
    }
  }
  return @{
    capturedAt = (Get-Date).ToUniversalTime().ToString('o')
    processes  = $rows
  }
}

function Write-Snapshot([string]$Path) {
  New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
  $snap = Get-ProcessSnapshot
  $snap | ConvertTo-Json -Depth 5 | Set-Content -Path $Path -Encoding utf8
  Write-Host "Wrote $($snap.processes.Count) process row(s) to $Path"
}

function Compare-Snapshots {
  if (-not (Test-Path $BeforeFile)) {
    Write-Error "Missing before snapshot. Run: ./scripts/orphan-check.ps1 before"
    exit 2
  }
  if (-not (Test-Path $AfterFile)) {
    Write-Error "Missing after snapshot. Run: ./scripts/orphan-check.ps1 after"
    exit 2
  }
  $before = (Get-Content $BeforeFile -Raw | ConvertFrom-Json).processes
  $after = (Get-Content $AfterFile -Raw | ConvertFrom-Json).processes
  $beforeIds = [System.Collections.Generic.HashSet[int]]::new()
  foreach ($p in $before) { $beforeIds.Add([int]$p.id) | Out-Null }
  $leaked = @($after | Where-Object { -not $beforeIds.Contains([int]$_.id) })
  if ($leaked.Count -eq 0) {
    Write-Host 'Orphan check OK: no new PIDs.'
    exit 0
  }
  Write-Host "Orphan check FAILED: $($leaked.Count) new process(es):"
  $leaked | ForEach-Object { Write-Host "  $($_.name) pid=$($_.id) $($_.path)" }
  exit 1
}

switch ($Mode) {
  'before' { Write-Snapshot $BeforeFile }
  'after' { Write-Snapshot $AfterFile }
  'diff' { Compare-Snapshots }
}
