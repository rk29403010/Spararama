[CmdletBinding()]
param(
  [string]$RecoveryPath = (Join-Path (Split-Path $PSScriptRoot -Parent) '..\spararama-cleverspa-recovery')
)

$ErrorActionPreference = 'Stop'

Write-Host 'Syncing Spararama chatgpt-dev…' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'sync-dev.ps1')
if ($LASTEXITCODE -ne 0) {
  throw "Spararama sync failed with exit code $LASTEXITCODE. No restart was attempted."
}

Write-Host 'Stopping local services…' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'stop-local.ps1')

Write-Host 'Installing/building latest source and restarting…' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'start-local.ps1') -RecoveryPath $RecoveryPath

Write-Host 'Local Spararama update complete.' -ForegroundColor Green
