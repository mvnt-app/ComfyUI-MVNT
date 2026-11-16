#Requires -Version 5.1
<#
.SYNOPSIS
  Wire ComfyUI-MVNT into a ComfyUI install via directory junction (no admin).

.PARAMETER ComfyRoot
  Path to the ComfyUI folder that contains main.py and custom_nodes\ (not the Electron app root).

.PARAMETER LinkName
  Folder name under custom_nodes (default: comfyui-mvnt).

.PARAMETER RepoRoot
  Git checkout of ComfyUI-MVNT (default: parent of this scripts folder).
#>
param(
  [Parameter(Mandatory = $true)]
  [string] $ComfyRoot,

  [string] $LinkName = 'comfyui-mvnt',

  [string] $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'

$comfyRootResolved = (Resolve-Path $ComfyRoot).Path
$mainPy = Join-Path $comfyRootResolved 'main.py'
if (-not (Test-Path $mainPy)) {
  throw "ComfyRoot must contain main.py. Not found: $mainPy"
}

$customNodes = Join-Path $comfyRootResolved 'custom_nodes'
if (-not (Test-Path $customNodes)) {
  New-Item -ItemType Directory -Path $customNodes | Out-Null
}

$linkPath = Join-Path $customNodes $LinkName
if (Test-Path $linkPath) {
  $item = Get-Item $linkPath -Force
  if ($item.LinkType -eq 'Junction' -and $item.Target -contains $RepoRoot) {
    Write-Host "Junction already OK: $linkPath -> $RepoRoot"
  } else {
    throw "custom_nodes\$LinkName exists and is not our junction: $linkPath"
  }
} else {
  cmd /c "mklink /J `"$linkPath`" `"$RepoRoot`""
  if ($LASTEXITCODE -ne 0) { throw "mklink failed with exit $LASTEXITCODE" }
  Write-Host "Created junction: $linkPath -> $RepoRoot"
}

Write-Host ""
Write-Host "Set before starting ComfyUI (PowerShell):"
Write-Host '  $env:MVNT_API_BASE = "https://api.mvnt.studio/v1"'
Write-Host '  $env:MVNT_API_KEY = "mvnt_live_<your-key>"'
Write-Host ""
Write-Host "Optional user-level MVNT_API_BASE (run once):"
Write-Host '  [Environment]::SetEnvironmentVariable("MVNT_API_BASE", "https://api.mvnt.studio/v1", "User")'
Write-Host ""
Write-Host "Python deps (use Comfy's python if you have it, else your default python):"
Write-Host "  python -m pip install -r `"$RepoRoot\requirements.txt`""
