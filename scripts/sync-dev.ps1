[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
Push-Location $repoRoot
try {
  if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
    throw 'Git is not available on PATH.'
  }

  $dirty = git status --porcelain
  if ($LASTEXITCODE -ne 0) { throw 'Unable to read Git status.' }
  if ($dirty) {
    Write-Host 'The checkout has uncommitted changes, so sync-dev will not switch or pull.' -ForegroundColor Yellow
    git status --short
    exit 2
  }

  Write-Host 'Fetching origin…'
  git fetch origin --prune
  if ($LASTEXITCODE -ne 0) { throw 'git fetch failed.' }

  $branch = (git branch --show-current).Trim()
  if ($branch -ne 'chatgpt-dev') {
    Write-Host "Current branch is '$branch'; switching to chatgpt-dev…"
    git switch chatgpt-dev
    if ($LASTEXITCODE -ne 0) {
      throw "Could not switch to chatgpt-dev. If Git says the branch is checked out in another worktree, run this script from that worktree instead."
    }
  }

  git branch --set-upstream-to=origin/chatgpt-dev chatgpt-dev 2>$null | Out-Null

  Write-Host 'Fast-forwarding chatgpt-dev…'
  git pull --ff-only origin chatgpt-dev
  if ($LASTEXITCODE -ne 0) {
    throw 'Fast-forward pull failed. No merge or reset was attempted; inspect git status/log before resolving it.'
  }

  $head = (git rev-parse --short HEAD).Trim()
  Write-Host "Spararama is up to date on chatgpt-dev at $head" -ForegroundColor Green
  git status --short --branch
}
finally {
  Pop-Location
}
