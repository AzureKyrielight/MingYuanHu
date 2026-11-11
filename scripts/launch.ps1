# Starts the MingYuanHu dev window (Vite + Electron) from any working directory.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

if (-not (Test-Path 'node_modules')) {
  Write-Host 'Installing dependencies (first run)...'
  corepack pnpm install
}

corepack pnpm dev
if ($LASTEXITCODE -ne 0) {
  Write-Host "MingYuanHu exited with code $LASTEXITCODE"
  Read-Host 'Press Enter to close'
}
