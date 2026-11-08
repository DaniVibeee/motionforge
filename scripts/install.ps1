# Nameless Editing — one-line installer
# Usage (PowerShell):
#   irm https://raw.githubusercontent.com/DaniVibeee/nameless-editing/main/scripts/install.ps1 | iex
#
# Downloads the newest portable build from GitHub Releases into
# %LOCALAPPDATA%\Nameless Editing and offers to launch it.
$ErrorActionPreference = 'Stop'

$repo = 'DaniVibeee/nameless-editing'
$api = "https://api.github.com/repos/$repo/releases/latest"
$headers = @{ 'User-Agent' = 'nameless-editing-installer'; Accept = 'application/vnd.github+json' }

Write-Host 'Checking the latest Nameless Editing release...'
$release = Invoke-RestMethod -Uri $api -Headers $headers

$asset = $release.assets |
  Where-Object { $_.name -match '^NamelessEditing.*portable\.exe$' } |
  Select-Object -First 1
if (-not $asset) { throw 'No portable .exe found in the latest release.' }

$targetDir = Join-Path $env:LOCALAPPDATA 'Nameless Editing'
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
$target = Join-Path $targetDir 'Nameless Editing.exe'

Write-Host ("Downloading {0} ({1:N1} MB)..." -f $asset.name, ($asset.size / 1MB))
$old = $ProgressPreference
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $target
$ProgressPreference = $old

Write-Host "Installed to: $target"
$answer = Read-Host 'Launch Nameless Editing now? [Y/n]'
if ([string]::IsNullOrWhiteSpace($answer) -or $answer -match '^[Yy]') {
  Start-Process -FilePath $target
}
