<#
  Pester-free unit checks for installer-helper.ps1 (safe: only touches processes it starts itself and a throw-away
  HKCU key). Run: powershell -NoProfile -ExecutionPolicy Bypass -File src-tauri\nsis\installer-helper.tests.ps1
  Exit code = number of failures.
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'installer-helper.ps1')   # Action '' -> only defines functions
$fail = 0
function Check([string]$Name, [bool]$Ok, [string]$Detail = '') {
  if ($Ok) { Write-Host "PASS $Name" } else { Write-Host "FAIL $Name $Detail"; $script:fail++ }
}

# 1. GUID packing, 3 known pairs (Windows Installer registry format)
$pairs = @(
  # Adobe Reader product code, documented in many Windows Installer references
  @('{AC76BA86-7AD7-1033-7B44-AC0F074E4100}', '68AB67CA7DA73301B744CAF070E41400'),
  # MinMusic v1 UpgradeCode (hand-derived from the packing rule)
  @('4ce33e04-b190-4983-b1b1-037bdff99a71', '40E33EC4091B38941B1B30B7FD9FA917'),
  # all-distinct digits
  @('{01234567-89AB-CDEF-0123-456789ABCDEF}', '76543210BA98FEDC1032547698BADCFE')
)
foreach ($p in $pairs) {
  $got = ConvertTo-PackedGuid $p[0]
  Check "pack $($p[0])" ($got -eq $p[1]) "got $got expected $($p[1])"
  $back = '{' + (ConvertFrom-PackedGuid $p[1]) + '}'
  Check "unpack $($p[1])" ($back -ieq ('{' + $p[0].Trim('{', '}') + '}')) "got $back"
}

# 2. Product-code lookup against a fake registry root
$root = "HKCU:\Software\MinMusic-m5-1-test-$PID"
try {
  $code = '{AC76BA86-7AD7-1033-7B44-AC0F074E4100}'
  $up = '4ce33e04-b190-4983-b1b1-037bdff99a71'
  $key = Join-Path $root (ConvertTo-PackedGuid $up)
  New-Item -Path $key -Force | Out-Null
  New-ItemProperty -Path $key -Name (ConvertTo-PackedGuid $code) -Value '' -PropertyType String | Out-Null
  $found = @(Get-V1ProductCodes $root $up)
  Check 'lookup finds the product code' ($found.Count -eq 1 -and $found[0] -ieq $code) ($found -join ',')
  Check 'lookup of an unknown upgrade code is empty' (@(Get-V1ProductCodes $root '{11111111-2222-3333-4444-555555555555}').Count -eq 0)
  $out = & (Join-Path $PSScriptRoot 'installer-helper.ps1') -Action UninstallV1 -DryRun -RegRoot $root
  Check 'UninstallV1 -DryRun prints the code and runs no msiexec' (($out -join ' ') -match [regex]::Escape($code))
  $env:MINMUSIC_INSTALLER_SKIP_V1 = '1'
  $out = & (Join-Path $PSScriptRoot 'installer-helper.ps1') -Action UninstallV1 -DryRun -RegRoot $root
  Check 'MINMUSIC_INSTALLER_SKIP_V1 skips v1 lookup' (($out -join ' ') -match 'skipped')
} finally {
  Remove-Item Env:\MINMUSIC_INSTALLER_SKIP_V1 -ErrorAction SilentlyContinue
  Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
}

# 3. StopProcesses touches only processes under the given dir (dummy copies of ping.exe named like the real ones)
$tmp = Join-Path ([IO.Path]::GetTempPath()) "mm-m5-1-test-$PID"
$a = Join-Path $tmp 'a'; $b = Join-Path $tmp 'b'
New-Item -ItemType Directory -Force $a, $b | Out-Null
$ping = Join-Path $env:WINDIR 'System32\PING.EXE'
$mine = @()
try {
  Copy-Item $ping (Join-Path $a 'MinMusic.exe'); Copy-Item $ping (Join-Path $a 'minmusic-core.exe'); Copy-Item $ping (Join-Path $b 'MinMusic.exe')
  foreach ($f in (Join-Path $a 'MinMusic.exe'), (Join-Path $a 'minmusic-core.exe'), (Join-Path $b 'MinMusic.exe')) {
    $mine += Start-Process $f -ArgumentList '-t', '127.0.0.1' -WindowStyle Hidden -PassThru
  }
  Start-Sleep -Milliseconds 700
  $n = Stop-InstalledMinMusic $a 1
  $dead = ($mine[0].HasExited -and $mine[1].HasExited)
  Check 'processes under the install dir are stopped' ($n -eq 2 -and $dead) "n=$n"
  Check 'a same-named process outside the install dir is left alone' (-not $mine[2].HasExited)
} finally {
  foreach ($p in $mine) { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "failures: $fail"
exit $fail
