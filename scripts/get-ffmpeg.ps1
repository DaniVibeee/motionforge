# Downloads a static FFmpeg build and installs ffmpeg.exe into ..\bin
# (the repository does not contain the ~170 MB binary because GitHub rejects
#  files larger than 100 MB).
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$bin = Join-Path $root 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null

$url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
$zip = Join-Path $env:TEMP 'motionforge-ffmpeg.zip'
$tmp = Join-Path $env:TEMP 'motionforge-ffmpeg-extract'

Write-Host "Downloading $url ..."
$old = $ProgressPreference
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Uri $url -OutFile $zip
$ProgressPreference = $old

if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Write-Host 'Extracting...'
Expand-Archive -Path $zip -DestinationPath $tmp -Force

$exe = Get-ChildItem $tmp -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1
if (-not $exe) { throw 'ffmpeg.exe was not found in the archive' }

Copy-Item $exe.FullName (Join-Path $bin 'ffmpeg.exe') -Force
Remove-Item $zip -Force
Remove-Item $tmp -Recurse -Force

Write-Host "Installed $bin\ffmpeg.exe"
