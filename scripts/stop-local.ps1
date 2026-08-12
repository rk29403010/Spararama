[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
foreach ($port in 3000, 8787) {
  $listeners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  foreach ($listener in $listeners) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    if ($process.Name -ne 'node.exe') { Write-Warning "Leaving non-Node process $($listener.OwningProcess) on port $port alone."; continue }
    if ($process.CommandLine -notmatch 'Spararama|spararama|src/server.js|dist/server.cjs') { Write-Warning "Leaving unrelated Node process $($listener.OwningProcess) on port $port alone."; continue }
    Stop-Process -Id $listener.OwningProcess
    Write-Host "Stopped process $($listener.OwningProcess) on port $port."
  }
}
