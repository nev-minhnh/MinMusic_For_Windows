<#
.SYNOPSIS  T-P12 and installer checks (M5-1): installer stops running processes, keeps data on uninstall, registers/removes URL schemes.
.DESCRIPTION
  Runs the real NSIS setup ONLY with /D=<repo>\.testdata\m5-1-<id>\install and MINMUSIC_DATA_ROOT=<...>\data.
  Steps
    1. /S install into the test dir: exe, core\ files, uninstall.exe, helper, HKCU schemes minmusic/metrolist/metrolist-auth
    2. start the installed app with the test data root (own PIDs recorded)
    3. run the setup /S again while the app runs: exit 0, the old shell and core PIDs are gone, new files in place
    4. start the app again (it starts), stop it
    5. uninstall /S: app files gone, schemes removed, the data marker survives
  Safety: the per-user registry keys / shortcuts that a real install shares are backed up and restored
  (installer-sandbox.ps1); the v1 uninstall is switched off (MINMUSIC_INSTALLER_SKIP_V1=1) unless -AllowV1Uninstall
  (default OFF: that path would uninstall the v1 MSI of THIS PC; U-1 belongs to M5-4 on a separate Windows user).
  Processes are only ever stopped by PID or by "path under the test install dir". Real data dirs are snapshotted
  before/after as proof. Exit code = number of failures.
.EXAMPLE   powershell -ExecutionPolicy Bypass -File tests\e2e\process\m5-1.ps1 [-Setup <setup.exe>] [-Keep] [-AllowV1Uninstall]
#>
param(
  [string]$Setup = '',
  [switch]$Keep,
  [switch]$AllowV1Uninstall
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
. (Join-Path $repo 'tools\perf\lib.ps1')
. (Join-Path $repo 'src-tauri\nsis\installer-sandbox.ps1')

if (-not $Setup) {
  $f = Get-ChildItem (Join-Path $repo 'src-tauri\target') -Recurse -Filter '*-setup.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\bundle\\nsis\\' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $f) { throw 'no setup found under src-tauri\target\**\bundle\nsis; build the bundle first or pass -Setup' }
  $Setup = $f.FullName
}
$Setup = (Resolve-Path $Setup).Path
$id = 'm5-1-' + (New-RunId)
$root = Join-Path $repo ".testdata\$id"
$inst = Join-Path $root 'install'
$data = Join-Path $root 'data'
New-Item -ItemType Directory -Force $root, $data | Out-Null
$fails = 0
$sb = $null
$started = @()   # PIDs we started (never kill anything else)
function Check([string]$Name, [bool]$Ok, [string]$Detail = '') {
  if ($Ok) { Write-Host "PASS $Name $Detail" } else { Write-Host "FAIL $Name $Detail"; $script:fails++ }
}
function Get-InstProcs([string]$Dir) {
  $prefix = $Dir.TrimEnd('\') + '\'
  @(Get-Process -Name 'MinMusic', 'minmusic-core' -ErrorAction SilentlyContinue | Where-Object { $p = $null; try { $p = $_.Path } catch { }; $p -and $p.StartsWith($prefix, 'OrdinalIgnoreCase') })
}
function Start-Installed {
  $exe = Join-Path $inst 'MinMusic.exe'
  # A release build ignores MINMUSIC_DATA_ROOT (test hooks are compiled out), so it would use the owner's real profile
  # (INT-W5 incident). portable.flag keeps all shell and core data in <install>\data instead.
  Set-Content (Join-Path $inst 'portable.flag') '' -Encoding ascii
  $old = @{}
  foreach ($k in 'MINMUSIC_DATA_ROOT') { $old[$k] = [Environment]::GetEnvironmentVariable($k) }
  [Environment]::SetEnvironmentVariable('MINMUSIC_DATA_ROOT', $data)
  try { $p = Start-Process -FilePath $exe -WorkingDirectory $inst -PassThru } finally { foreach ($k in $old.Keys) { [Environment]::SetEnvironmentVariable($k, $old[$k]) } }
  $script:started += $p.Id
  $sw = [Diagnostics.Stopwatch]::StartNew(); $shell = $null; $core = $null
  while ($sw.Elapsed.TotalSeconds -lt 30) {
    $pr = Get-InstProcs $inst
    $shell = $pr | Where-Object { $_.ProcessName -eq 'MinMusic' } | Select-Object -First 1
    $core = $pr | Where-Object { $_.ProcessName -eq 'minmusic-core' } | Select-Object -First 1
    if ($shell -and $core) { break }
    Start-Sleep -Milliseconds 300
  }
  foreach ($x in @($shell, $core)) { if ($x) { $script:started += $x.Id } }
  [pscustomobject]@{ Shell = $shell; Core = $core }
}
function Scheme-Cmd([string]$s) { try { (Get-ItemProperty "HKCU:\Software\Classes\$s\shell\open\command" -ErrorAction Stop).'(default)' } catch { $null } }

$before = Get-RealDataSnapshot
Write-Host "run $id`nsetup $Setup`ninstall dir $inst`ndata root $data`nv1 uninstall: $(if ($AllowV1Uninstall) { 'ALLOWED (will uninstall this PC''s v1)' } else { 'off' })"
try {
  $sb = Enter-InstallerSandbox (Join-Path $root 'backup') -AllowV1Uninstall:$AllowV1Uninstall

  # 1. first silent install
  $code = Invoke-TestSetup $Setup $inst
  Check 'install #1 exit code 0' ($code -eq 0) "exit $code"
  foreach ($rel in 'MinMusic.exe', 'uninstall.exe', 'installer-helper.ps1', 'core\core.args', 'core\runtime\bin\minmusic-core.exe', 'core\lib') {
    Check "installed $rel" (Test-Path (Join-Path $inst $rel))
  }
  foreach ($s in 'minmusic', 'metrolist', 'metrolist-auth') {
    $c = Scheme-Cmd $s
    Check "scheme $s registered" ($c -and $c -like "*$inst\MinMusic.exe*%1*") "$c"
  }
  # marker data that an uninstall must not remove
  $marker = Join-Path $data 'Local\MinMusic\data\metrolist\marker.txt'
  New-Item -ItemType Directory -Force (Split-Path $marker) | Out-Null
  Set-Content $marker 'keep me'

  # 2. run the app from the test install
  $app = Start-Installed
  Check 'app started (shell + core under the test install dir)' ($app.Shell -and $app.Core) "shell=$($app.Shell.Id) core=$($app.Core.Id)"
  $oldPids = @(@($app.Shell, $app.Core) | Where-Object { $_ } | ForEach-Object { $_.Id })
  $mtime = (Get-Item (Join-Path $inst 'MinMusic.exe')).LastWriteTime

  # 3. T-P12: install again over the running app
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $code = Invoke-TestSetup $Setup $inst
  Check 'T-P12 install #2 over the running app: exit code 0' ($code -eq 0) ("exit $code in {0:N1} s" -f $sw.Elapsed.TotalSeconds)
  $alive = @($oldPids | Where-Object { Test-ProcAlive $_ })
  Check 'T-P12 both old processes stopped' ($alive.Count -eq 0) "still alive: $($alive -join ',')"
  Check 'T-P12 files replaced / present' (Test-Path (Join-Path $inst 'MinMusic.exe'))

  # 4. the app starts again
  $app2 = Start-Installed
  Check 'T-P12 app starts after the reinstall' ($app2.Shell -and $app2.Core) "shell=$($app2.Shell.Id) core=$($app2.Core.Id)"
  foreach ($x in @($app2.Shell, $app2.Core)) { if ($x) { Stop-Process -Id $x.Id -Force -ErrorAction SilentlyContinue } }
  Start-Sleep -Milliseconds 800

  Remove-Item (Join-Path $inst 'portable.flag') -Force -ErrorAction SilentlyContinue
  # 5. uninstall keeps data, removes schemes
  $code = Invoke-TestUninstall $inst
  Check 'uninstall exit code 0' ($code -eq 0) "exit $code"
  Check 'app files removed' (-not (Test-Path (Join-Path $inst 'MinMusic.exe')) -and -not (Test-Path (Join-Path $inst 'core')))
  foreach ($s in 'minmusic', 'metrolist', 'metrolist-auth') { Check "scheme $s removed" (-not (Scheme-Cmd $s)) }
  Check 'uninstall keeps the user data' ((Test-Path $marker) -and ((Get-Content $marker -Raw).Trim() -eq 'keep me'))
}
catch { Write-Host "ERROR $_"; $fails++ }
finally {
  # only our own PIDs, then anything running from our own test install dir
  foreach ($p in ($started | Select-Object -Unique)) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
  foreach ($x in (Get-InstProcs $inst)) { Stop-Process -Id $x.Id -Force -ErrorAction SilentlyContinue }
  Exit-InstallerSandbox $sb
  $after = Get-RealDataSnapshot
  $same = (($before | Out-String) -eq ($after | Out-String))
  Check 'real data dirs untouched (before/after snapshot)' $same
  if (-not $Keep) { Start-Sleep -Milliseconds 500; Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue }
}
Write-Host "failures: $fails"
exit $fails
