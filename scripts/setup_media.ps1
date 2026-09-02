# FrameBaker bundled media-plugin Python runtime for Windows.
# Keep this file ASCII-compatible so Windows PowerShell 5.1 can parse it without a UTF-8 BOM.
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\setup_media.ps1
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$Venv = ".venv-media"
$VenvPython = Join-Path $Venv "Scripts\python.exe"
# Base runtime only; plugin-provided dependency commands are never read or executed.
$RuntimeDeps = @("requests")

if (Test-Path $VenvPython) {
  Write-Host "media Python is already installed: $VenvPython"
  Write-Host "Ensuring base runtime dependencies: $($RuntimeDeps -join ', ')"
  $UvExisting = Get-Command uv -ErrorAction SilentlyContinue
  if ($UvExisting) {
    & $UvExisting.Source pip install --python $VenvPython --link-mode copy @RuntimeDeps
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  } else {
    $Pip = Join-Path $Venv "Scripts\pip.exe"
    & $Pip install @RuntimeDeps
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
  Write-Host "Ready: $VenvPython"
  exit 0
}

$Uv = Get-Command uv -ErrorAction SilentlyContinue
if ($Uv) {
  Write-Host "Creating venv with uv: $Venv"
  & $Uv.Source venv --python 3.12 $Venv
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  Write-Host "Installing base runtime deps with uv: $($RuntimeDeps -join ', ')"
  & $Uv.Source pip install --python $VenvPython --link-mode copy @RuntimeDeps
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  $Python = if ($env:PYTHON) { $env:PYTHON } else { "python" }
  $ver = $null
  try { $ver = & $Python --version 2>&1 } catch { }
  if ($LASTEXITCODE -ne 0 -or -not $ver) {
    try { $ver = & py --version 2>&1; if ($LASTEXITCODE -eq 0) { $Python = "py" } } catch { }
  }
  if (-not $ver -or $LASTEXITCODE -ne 0) {
    Write-Host "ERROR: uv or Python was not found. Install uv from https://docs.astral.sh/uv/ or Python from https://www.python.org/downloads/."
    exit 1
  }

  Write-Host "Creating venv: $Venv ($ver)"
  & $Python -m venv $Venv
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  $Pip = Join-Path $Venv "Scripts\pip.exe"
  Write-Host "Upgrading pip"
  & $Pip install --upgrade pip
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  Write-Host "Installing base runtime deps: $($RuntimeDeps -join ', ')"
  & $Pip install @RuntimeDeps
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host ""
Write-Host "Installation complete: $VenvPython"
Write-Host "FrameBaker media plugins will use this interpreter for .iap/.vap/.aap provider.py execution."
