<#
.SYNOPSIS  Helper called by hooks.nsh (installer and uninstaller). Also dot-sourceable for unit tests.
.DESCRIPTION
  -Action StopProcesses -InstallDir <dir>
      Graceful `taskkill /PID <pid> /T` for every MinMusic.exe / minmusic-core.exe whose executable lives under
      <dir>, wait up to 3 s, then Stop-Process -Force on the survivors. Processes outside <dir> (for example the
      owner's other MinMusic) are never touched. Never matches by bare image name alone.
  -Action UninstallV1
      Looks up the v1 MSI ProductCode(s) for UpgradeCode 4ce33e04-b190-4983-b1b1-037bdff99a71 in
      HKCU\Software\Microsoft\Installer\UpgradeCodes\<packed GUID> and runs `msiexec /x {code} /qn /norestart`
      (per-user MSI, no admin). User data is not touched (an MSI uninstall only removes its own files).
  -DryRun    UninstallV1 only: print the product codes, do not run msiexec.
  -RegRoot   UninstallV1 only: override the registry root (tests).
#>
param(
  [ValidateSet('', 'StopProcesses', 'UninstallV1')][string]$Action = '',
  [string]$InstallDir = '',
  [switch]$DryRun,
  [string]$RegRoot = 'HKCU:\Software\Microsoft\Installer\UpgradeCodes',
  [string]$UpgradeCode = '4ce33e04-b190-4983-b1b1-037bdff99a71'
)
$ErrorActionPreference = 'Stop'

function Get-ReversedText([string]$s) { $a = $s.ToCharArray(); [array]::Reverse($a); -join $a }

# Windows Installer "packed" GUID: the 32 hex digits of the GUID, with the first 3 groups (8, 4, 4 digits) reversed
# and each of the remaining 8 bytes swapped pairwise (nibble swap). The transform is its own inverse.
function Convert-PackedGuid([string]$Guid) {
  $h = $Guid.Trim().Trim('{', '}').Replace('-', '')
  if ($h -notmatch '^[0-9a-fA-F]{32}$') { throw "not a GUID: $Guid" }
  $out = (Get-ReversedText $h.Substring(0, 8)) + (Get-ReversedText $h.Substring(8, 4)) + (Get-ReversedText $h.Substring(12, 4))
  foreach ($i in 0..7) { $out += Get-ReversedText $h.Substring(16 + 2 * $i, 2) }
  $out.ToUpperInvariant()
}
function ConvertTo-PackedGuid([string]$Guid) { Convert-PackedGuid $Guid }
function ConvertFrom-PackedGuid([string]$Packed) {
  $h = Convert-PackedGuid $Packed
  '{0}-{1}-{2}-{3}-{4}' -f $h.Substring(0, 8), $h.Substring(8, 4), $h.Substring(12, 4), $h.Substring(16, 4), $h.Substring(20, 12)
}

function Get-InstalledMinMusicProcesses([string]$InstallDir) {
  if (-not $InstallDir) { return @() }
  $prefix = $InstallDir.TrimEnd('\') + '\'
  @(Get-Process -Name 'MinMusic', 'minmusic-core' -ErrorAction SilentlyContinue | Where-Object {
      $p = $null; try { $p = $_.Path } catch { }
      $p -and $p.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
    })
}

function Stop-InstalledMinMusic([string]$InstallDir, [double]$GraceSeconds = 3) {
  $procs = Get-InstalledMinMusicProcesses $InstallDir
  if (-not $procs) { return 0 }
  foreach ($p in $procs) { & cmd.exe /c "taskkill.exe /PID $($p.Id) /T >nul 2>&1" }   # graceful (WM_CLOSE), no /F
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $GraceSeconds -and (Get-InstalledMinMusicProcesses $InstallDir)) { Start-Sleep -Milliseconds 200 }
  $left = @(Get-InstalledMinMusicProcesses $InstallDir)
  foreach ($p in $left) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  if ($left) { Start-Sleep -Milliseconds 500 }   # let file handles close
  return $procs.Count
}

function Get-V1ProductCodes([string]$RegRoot, [string]$UpgradeCode) {
  $key = Join-Path $RegRoot (Convert-PackedGuid $UpgradeCode)
  if (-not (Test-Path $key)) { return @() }
  @((Get-Item $key).GetValueNames() | Where-Object { $_ -match '^[0-9A-Fa-f]{32}$' } | ForEach-Object { '{' + (ConvertFrom-PackedGuid $_) + '}' })
}

function Uninstall-MinMusicV1([string]$RegRoot, [string]$UpgradeCode, [switch]$DryRun) {
  $codes = Get-V1ProductCodes $RegRoot $UpgradeCode
  foreach ($c in $codes) {
    if ($DryRun) { Write-Output "v1 product $c"; continue }
    $p = Start-Process msiexec.exe -ArgumentList '/x', $c, '/qn', '/norestart' -Wait -PassThru -WindowStyle Hidden
    Write-Output "v1 product $c msiexec exit $($p.ExitCode)"   # 0 ok, 3010 reboot, 1605 not installed: all non-fatal
  }
  if (-not $codes) { Write-Output 'no v1 install found' }
}

switch ($Action) {
  'StopProcesses' { $n = Stop-InstalledMinMusic $InstallDir; Write-Output "stopped $n process(es) under $InstallDir"; exit 0 }
  'UninstallV1' {
    # Test guard: installer tests set MINMUSIC_INSTALLER_SKIP_V1=1 so they never uninstall the owner's real v1.
    if ($env:MINMUSIC_INSTALLER_SKIP_V1 -eq '1') { Write-Output 'v1 uninstall skipped (MINMUSIC_INSTALLER_SKIP_V1=1)'; exit 0 }
    try { Uninstall-MinMusicV1 $RegRoot $UpgradeCode -DryRun:$DryRun } catch { Write-Output "v1 uninstall skipped: $_" }; exit 0 }
}
