[CmdletBinding()]
param(
  [string]$RecoveryPath = (Join-Path (Split-Path $PSScriptRoot -Parent) '..\spararama-cleverspa-recovery')
)

$ErrorActionPreference = 'Stop'

Write-Host 'Stopping local services...' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'stop-local.ps1')

Write-Host 'Building and restarting current checkout...' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'start-local.ps1') -RecoveryPath $RecoveryPath

Write-Host 'Local Spararama restart complete.' -ForegroundColor Green
