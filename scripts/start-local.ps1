[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$appPath = Split-Path $PSScriptRoot -Parent
$cleverSpaPath = Join-Path $appPath 'services\cleverspa'
$logPath = Join-Path $appPath '.local\logs'
New-Item -ItemType Directory -Force -Path $logPath | Out-Null

function Test-Http([string]$Url) {
  try { return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 $Url).StatusCode -eq 200 } catch { return $false }
}
function Wait-Http([string]$Url) {
  foreach ($attempt in 1..10) { if (Test-Http $Url) { return $true }; Start-Sleep -Seconds 1 }
  return $false
}
function Get-Listener([int]$Port) {
  Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
}

if (-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) {
  throw 'pnpm 11.21.0 is required. Install it once with: npm install -g pnpm@11.21.0'
}
if (-not (Test-Path (Join-Path $cleverSpaPath 'src\server.js'))) {
  throw "Bundled CleverSpa service was not found at $cleverSpaPath. Sync chatgpt-dev first."
}

& pnpm.cmd install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'Spararama dependency install failed.' }

if (-not (Test-Http 'http://127.0.0.1:8787/api/status')) {
  if (Get-Listener 8787) { throw 'Port 8787 is occupied but is not serving the Spararama CleverSpa adapter.' }
  $bridgeLog = Join-Path $logPath 'cleverspa-service.log'
  $bridgeErrorLog = Join-Path $logPath 'cleverspa-service-error.log'
  Start-Process -FilePath node.exe -ArgumentList '--env-file-if-exists=.env', 'services/cleverspa/src/server.js' -WorkingDirectory $appPath -RedirectStandardOutput $bridgeLog -RedirectStandardError $bridgeErrorLog -WindowStyle Hidden
  if (-not (Wait-Http 'http://127.0.0.1:8787/api/status')) { throw "CleverSpa service did not become healthy. See $bridgeErrorLog" }
}

$appRunning = Test-Http 'http://127.0.0.1:3000/api/health'
if (-not $appRunning) {
  if (Get-Listener 3000) { throw 'Port 3000 is occupied but is not serving Spararama.' }
  & pnpm.cmd build
  if ($LASTEXITCODE -ne 0) { throw 'Spararama build failed.' }
  $appLog = Join-Path $logPath 'spararama.log'
  $appErrorLog = Join-Path $logPath 'spararama-error.log'
  Start-Process -FilePath cmd.exe -ArgumentList '/c', 'set "NODE_ENV=production" && node dist/server.cjs' -WorkingDirectory $appPath -RedirectStandardOutput $appLog -RedirectStandardError $appErrorLog -WindowStyle Hidden
  if (-not (Wait-Http 'http://127.0.0.1:3000/api/health')) { throw "Spararama did not become healthy. See $appErrorLog" }
} else {
  Write-Warning 'Spararama is already running. Pulled source or .env changes require a restart.'
}

$lanIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' -and $_.AddressState -eq 'Preferred' } | Select-Object -First 1 -ExpandProperty IPAddress)
$telemetry = Invoke-RestMethod 'http://127.0.0.1:3000/api/telemetry/status'
Write-Host "Laptop UI: http://127.0.0.1:3000"
Write-Host "Phone UI:  http://${lanIp}:3000"
Write-Host "CleverSpa adapter: http://127.0.0.1:8787"
Write-Host "Telemetry running: $($telemetry.running); Firebase upload enabled: $($telemetry.firebaseEnabled)"
Write-Host "Firebase project: $($telemetry.firebaseProjectId)"
Write-Host "Firestore database: $($telemetry.firestoreDatabaseId)"
