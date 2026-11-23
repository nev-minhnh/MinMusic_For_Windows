<#
.SYNOPSIS  Size report: NSIS setup size, installed size and sidecar dist. Report only; there is no size budget (owner decision 2026-11-23), exit code is always 0.
.DESCRIPTION
  Setup size  = the newest src-tauri\target\**\bundle\nsis\*.exe (if one was built).
  Installed   = size of the files that setup would install: MinMusic.exe + core\ (sidecar\dist) + resources,
                approximated from the build outputs when no installed copy is given.
  -InstallDir <dir> measures a real install dir instead.
.EXAMPLE   powershell -File scripts\size.ps1 [-InstallDir "$env:LOCALAPPDATA\Programs\MinMusic-test"]
#>
param([string]$InstallDir = '')
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
function MB($b) { [math]::Round($b / 1MB, 1) }
function Dir-Size($p) { if (Test-Path $p) { $s = 0; Get-ChildItem $p -Recurse -File -Force -ErrorAction SilentlyContinue | ForEach-Object { $s += $_.Length }; $s } else { 0 } }

$setup = Get-ChildItem (Join-Path $repo 'src-tauri\target') -Recurse -Filter '*.exe' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\bundle\\nsis\\' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($InstallDir) { $installed = Dir-Size $InstallDir; $note = "measured $InstallDir" }
else {
  $exe = Get-ChildItem (Join-Path $repo 'src-tauri\target') -Recurse -Filter 'MinMusic.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\release\\' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $core = Dir-Size (Join-Path $repo 'sidecar\dist')
  $installed = $(if ($exe) { $exe.Length } else { 0 }) + $core
  $note = 'estimate: release MinMusic.exe + sidecar\dist (no installer layout available)'
}
$res = [ordered]@{
  setupMB = $(if ($setup) { MB $setup.Length } else { $null }); setupFile = $(if ($setup) { $setup.FullName } else { 'none built' })
  installedMB = MB $installed; installedNote = $note
  sidecarDistMB = MB (Dir-Size (Join-Path $repo 'sidecar\dist'))
}
$res | ConvertTo-Json
exit 0
