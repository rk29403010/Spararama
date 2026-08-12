[CmdletBinding()]
param()

foreach ($url in 'http://127.0.0.1:8787/api/status', 'http://127.0.0.1:3000/api/health', 'http://127.0.0.1:3000/api/spa/status', 'http://127.0.0.1:3000/api/telemetry/status') {
  try { Write-Host "`n$url"; Invoke-RestMethod $url | ConvertTo-Json -Depth 8 } catch { Write-Warning "$url unavailable: $($_.Exception.Message)" }
}
