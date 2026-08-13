[CmdletBinding()]
param(
  [string]$RecoveryPath = (Join-Path (Split-Path $PSScriptRoot -Parent) '..\Spararama')
)

$ErrorActionPreference = 'Stop'
$appPath = Split-Path $PSScriptRoot -Parent
$RecoveryPath = [IO.Path]::GetFullPath($RecoveryPath)
$logPath = Join-Path $appPath '.local\logs'
New-Item -ItemType Directory -Force -Path $logPath | Out-Null

function Test-Http([string]$Url) {
  # The recovery bridge can take several seconds to report a disconnected tub;
  # that is still a healthy bridge process rather than a failed service.
  try { return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 $Url).StatusCode -eq 200 } catch { return $false }
}
function Wait-Http([string]$Url) {
  foreach ($attempt in 1..10) {
    if (Test-Http $Url) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}
function Get-Listener([int]$Port) {
  Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
}

if (-not (Test-Path (Join-Path $RecoveryPath 'src\server.js'))) {
  throw "Recovery bridge was not found at $RecoveryPath. Supply -RecoveryPath with its checkout path."
}

if (-not (Test-Http 'http://127.0.0.1:8787/api/status')) {
  if (Get-Listener 8787) { throw 'Port 8787 is occupied but is not serving the recovery bridge.' }
  $bridgeLog = Join-Path $logPath 'recovery-bridge.log'
  $bridgeErrorLog = Join-Path $logPath 'recovery-bridge-error.log'
  Start-Process -FilePath node.exe -ArgumentList 'src/server.js' -WorkingDirectory $RecoveryPath -RedirectStandardOutput $bridgeLog -RedirectStandardError $bridgeErrorLog -WindowStyle Hidden
  if (-not (Wait-Http 'http://127.0.0.1:8787/api/status')) { throw "Recovery bridge did not become healthy. See $bridgeLog" }
}

$appRunning = Test-Http 'http://127.0.0.1:3000/api/health'
if (-not $appRunning) {
  if (Get-Listener 3000) { throw 'Port 3000 is occupied but is not serving Spararama.' }
  if (-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) {
    throw 'pnpm is required to build Spararama. Install it once with: npx get-pnpm'
  }

  # A frozen install is cheap when nothing changed and guarantees that a newly
  # pulled lockfile/package change is reflected before we build the local app.
  & pnpm.cmd install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'Spararama dependency install failed.' }

  & pnpm.cmd build
  if ($LASTEXITCODE -ne 0) { throw 'Spararama build failed.' }

  $appLog = Join-Path $logPath 'spararama.log'
  $appErrorLog = Join-Path $logPath 'spararama-error.log'
  Start-Process -FilePath cmd.exe -ArgumentList '/c', 'set "NODE_ENV=production" && node dist/server.cjs' -WorkingDirectory $appPath -RedirectStandardOutput $appLog -RedirectStandardError $appErrorLog -WindowStyle Hidden
  if (-not (Wait-Http 'http://127.0.0.1:3000/api/health')) { throw "Spararama did not become healthy. See $appLog" }
} else {
  Write-Warning 'Spararama is already running. Changes to .env or pulled source require stop-local.ps1 followed by start-local.ps1.'
}

$lanIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' -and $_.AddressState -eq 'Preferred' } | Select-Object -First 1 -ExpandProperty IPAddress)
$telemetry = Invoke-RestMethod 'http://127.0.0.1:3000/api/telemetry/status'
Write-Host "Laptop UI: http://127.0.0.1:3000"
Write-Host "Phone UI:  http://${lanIp}:3000"
Write-Host "Telemetry running: $($telemetry.running); Firebase upload enabled: $($telemetry.firebaseEnabled)"
Write-Host "Firebase project: $($telemetry.firebaseProjectId)"
Write-Host "Firestore database: $($telemetry.firestoreDatabaseId)"
Write-Host "Credential source: $($telemetry.firebaseCredentialSource)"
