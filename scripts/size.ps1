<#
.SYNOPSIS  I1 check: setup size, installed size, sidecar dist and portable zip against the limits (setup <= 100 MB, installed <= 280 MB).
.DESCRIPTION
  Setup      = the newest src-tauri\target\**\bundle\nsis\*-setup.exe (or -Setup <file>).
  Installed  = sum of the install dir after a silent install into .testdata\install-<id> with /D= (the sandbox in
               src-tauri\nsis\installer-sandbox.ps1 backs up and restores the per-user registry keys and shortcuts the
               setup touches, and the v1 uninstall is switched off; the owner's real install is not changed).
               -InstallDir <dir> measures an existing dir instead (no install). -NoInstall estimates from the build
               outputs (release MinMusic.exe + sidecar\dist) when no setup exists.
  Sidecar    = size of sidecar\dist without core.warmup.args (what is shipped).
  Zip        = the newest dist\MinMusic-*-portable-x64.zip (informational, no limit).
  Exit code 1 when a limit is breached (setup > 100 MB or installed > 280 MB), 0 otherwise.
.EXAMPLE   powershell -File scripts\size.ps1 [-Setup <setup.exe>] [-InstallDir <dir>] [-NoInstall] [-Keep]
#>
param(
  [string]$Setup = '',
  [string]$InstallDir = '',
  [switch]$NoInstall,
  [switch]$Keep
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $repo 'src-tauri\nsis\installer-sandbox.ps1')
function MB($b) { [math]::Round($b / 1MB, 1) }
function Dir-Size($p) { if (Test-Path $p) { $s = 0; Get-ChildItem $p -Recurse -File -Force -ErrorAction SilentlyContinue | ForEach-Object { $s += $_.Length }; $s } else { 0 } }

$target = Join-Path $repo 'src-tauri\target'
if ($Setup) { $setupFile = Get-Item $Setup }
else {
  $setupFile = Get-ChildItem $target -Recurse -Filter '*-setup.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\bundle\\nsis\\' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
$dist = Join-Path $repo 'sidecar\dist'
$distBytes = 0
foreach ($n in 'runtime', 'lib') { $distBytes += Dir-Size (Join-Path $dist $n) }
foreach ($n in 'core.args', 'core.jsa') { $f = Join-Path $dist $n; if (Test-Path $f) { $distBytes += (Get-Item $f).Length } }

$installed = $null; $note = ''
if ($InstallDir) { $installed = Dir-Size $InstallDir; $note = "measured $InstallDir" }
elseif ($setupFile -and -not $NoInstall) {
  $id = Get-Date -Format 'yyyyMMdd-HHmmss'
  $dir = Join-Path $repo ".testdata\install-$id"
  $sb = Enter-InstallerSandbox (Join-Path $repo ".testdata\install-$id-backup")
  try {
    $code = Invoke-TestSetup $setupFile.FullName $dir
    if ($code -ne 0) { throw "setup exited with $code" }
    $installed = Dir-Size $dir; $note = "silent install into $dir"
    if (-not $Keep) { try { Invoke-TestUninstall $dir | Out-Null } catch { Write-Warning "uninstall: $_" } }
  } finally {
    Exit-InstallerSandbox $sb
    if (-not $Keep) { Remove-Item $dir, (Join-Path $repo ".testdata\install-$id-backup") -Recurse -Force -ErrorAction SilentlyContinue }
  }
}
else {
  $exe = Get-ChildItem $target -Recurse -Filter 'MinMusic.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\release\\' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $installed = $(if ($exe) { $exe.Length } else { 0 }) + $distBytes
  $note = 'estimate: release MinMusic.exe + sidecar\dist (no setup installed)'
}

$zip = Get-ChildItem (Join-Path $repo 'dist') -Filter 'MinMusic-*-portable-x64.zip' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$res = [ordered]@{
  setupMB = $(if ($setupFile) { MB $setupFile.Length } else { $null }); setupFile = $(if ($setupFile) { $setupFile.FullName } else { 'none built' })
  installedMB = MB $installed; installedNote = $note
  sidecarDistMB = MB $distBytes
  portableZipMB = $(if ($zip) { MB $zip.Length } else { $null }); portableZip = $(if ($zip) { $zip.FullName } else { 'none built' })
  setupLimitMB = 100; installedLimitMB = 280
}
$res.setupOk = $(if ($null -ne $res.setupMB) { $res.setupMB -le 100 } else { $null })
$res.installedOk = $res.installedMB -le 280
$res | ConvertTo-Json
if (($res.setupOk -eq $false) -or (-not $res.installedOk)) { Write-Host 'I1 BREACH'; exit 1 }
exit 0
