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
  try { return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 $Url).StatusCode -eq 200 } catch { return $false }
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
  1..10 | ForEach-Object { if (Test-Http 'http://127.0.0.1:8787/api/status') { return }; Start-Sleep -Seconds 1 }
  if (-not (Test-Http 'http://127.0.0.1:8787/api/status')) { throw "Recovery bridge did not become healthy. See $bridgeLog" }
}

if (-not (Test-Path (Join-Path $appPath 'dist\server.cjs'))) { & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'Spararama build failed.' } }
if (-not (Test-Http 'http://127.0.0.1:3000/api/health')) {
  if (Get-Listener 3000) { throw 'Port 3000 is occupied but is not serving Spararama.' }
  $appLog = Join-Path $logPath 'spararama.log'
  $appErrorLog = Join-Path $logPath 'spararama-error.log'
  Start-Process -FilePath cmd.exe -ArgumentList '/c', 'set "NODE_ENV=production" && node dist/server.cjs' -WorkingDirectory $appPath -RedirectStandardOutput $appLog -RedirectStandardError $appErrorLog -WindowStyle Hidden
  1..10 | ForEach-Object { if (Test-Http 'http://127.0.0.1:3000/api/health') { return }; Start-Sleep -Seconds 1 }
  if (-not (Test-Http 'http://127.0.0.1:3000/api/health')) { throw "Spararama did not become healthy. See $appLog" }
}

$lanIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' -and $_.AddressState -eq 'Preferred' } | Select-Object -First 1 -ExpandProperty IPAddress)
$telemetry = Invoke-RestMethod 'http://127.0.0.1:3000/api/telemetry/status'
Write-Host "Laptop UI: http://127.0.0.1:3000"
Write-Host "Phone UI:  http://${lanIp}:3000"
Write-Host "Telemetry running: $($telemetry.running); Firebase upload enabled: $($telemetry.firebaseEnabled)"
