<#
  Dot-source helper for scripts that run the real NSIS setup into a test dir (size.ps1, tests/e2e/process/m5-1.ps1).
  Even with /D=<dir> the setup writes per-user registry keys and shortcuts that a real install shares
  (Uninstall\MinMusic, Software\nev-minhnh\MinMusic, the URL schemes incl. the v1 `metrolist://`, Start Menu and
  Desktop shortcuts). Enter-InstallerSandbox backs them up, Exit-InstallerSandbox restores the exact previous state,
  so the owner's real installation is never changed by a test. It also sets MINMUSIC_INSTALLER_SKIP_V1=1 so the
  installer does not uninstall the owner's v1 (unless -AllowV1Uninstall).
#>
function Get-SandboxItems {
  $desk = [Environment]::GetFolderPath('Desktop')
  $sm = Join-Path ([Environment]::GetFolderPath('Programs')) 'MinMusic.lnk'
  @{
    RegKeys = @('Software\Classes\minmusic', 'Software\Classes\metrolist', 'Software\Classes\metrolist-auth',
      'Software\Microsoft\Windows\CurrentVersion\Uninstall\MinMusic', 'Software\nev-minhnh\MinMusic')
    Lnks = @($sm, (Join-Path $desk 'MinMusic.lnk'))
  }
}

function Enter-InstallerSandbox([string]$BackupDir, [switch]$AllowV1Uninstall) {
  New-Item -ItemType Directory -Force $BackupDir | Out-Null
  $items = Get-SandboxItems
  $state = [ordered]@{ Dir = $BackupDir; Keys = @{}; Files = @{}; OldEnv = $env:MINMUSIC_INSTALLER_SKIP_V1 }
  $i = 0
  foreach ($k in $items.RegKeys) {
    $i++
    $f = Join-Path $BackupDir "key$i.reg"
    Remove-Item $f -ErrorAction SilentlyContinue
    # cmd /c: under ErrorActionPreference=Stop, PS 5.1 turns reg.exe stderr (missing key) into a terminating error
    & cmd.exe /c "reg.exe export `"HKCU\$k`" `"$f`" /y >nul 2>nul"
    $state.Keys[$k] = $(if (Test-Path $f) { $f } else { $null })
  }
  $i = 0
  foreach ($p in $items.Lnks) {
    $i++
    if (Test-Path $p) { $b = Join-Path $BackupDir "file$i.lnk"; Copy-Item $p $b -Force; $state.Files[$p] = $b } else { $state.Files[$p] = $null }
  }
  $env:MINMUSIC_INSTALLER_SKIP_V1 = $(if ($AllowV1Uninstall) { '' } else { '1' })
  [pscustomobject]$state
}

function Exit-InstallerSandbox($State) {
  if (-not $State) { return }
  foreach ($k in $State.Keys.Keys) {
    & cmd.exe /c "reg.exe delete `"HKCU\$k`" /f >nul 2>nul"
    if ($State.Keys[$k]) { & cmd.exe /c "reg.exe import `"$($State.Keys[$k])`" >nul 2>nul" }
  }
  foreach ($p in $State.Files.Keys) {
    if ($State.Files[$p]) { Copy-Item $State.Files[$p] $p -Force } else { Remove-Item $p -Force -ErrorAction SilentlyContinue }
  }
  $env:MINMUSIC_INSTALLER_SKIP_V1 = $State.OldEnv
}

# Silent install/uninstall into a test dir. /D= must be the last argument and unquoted.
function Invoke-TestSetup([string]$Setup, [string]$InstallDir, [int]$TimeoutSec = 300) {
  $p = Start-Process -FilePath $Setup -ArgumentList '/S', "/D=$InstallDir" -PassThru
  if (-not $p.WaitForExit($TimeoutSec * 1000)) { Stop-Process -Id $p.Id -Force; throw "setup timed out after $TimeoutSec s" }
  $p.ExitCode
}
function Invoke-TestUninstall([string]$InstallDir, [int]$TimeoutSec = 120) {
  $u = Join-Path $InstallDir 'uninstall.exe'
  $p = Start-Process -FilePath $u -ArgumentList '/S', "_?=$InstallDir" -PassThru   # _?= keeps it synchronous
  if (-not $p.WaitForExit($TimeoutSec * 1000)) { Stop-Process -Id $p.Id -Force; throw "uninstall timed out after $TimeoutSec s" }
  $p.ExitCode
}
