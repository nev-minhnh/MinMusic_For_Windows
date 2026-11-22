<#
.SYNOPSIS  Ensures the pinned PresentMon console build is present and checks that it can start a trace session.
.DESCRIPTION
  Pinned: PresentMon 2.6.0 (GameTechDev/PresentMon release v2.6.0), SHA-256 verified.
  Download dir: D:\Coding_Project\MinMusic-notes\tools\presentmon (shared, outside the repo); falls back to tools\perf\bin.
  ETW needs elevation OR membership of the "Performance Log Users" group. -Check reports which applies.
  Prints the exe path (and, with -Check, a JSON status line). Exit 0 = exe ready; 3 = no ETW privilege.
.EXAMPLE   powershell -File tools\perf\presentmon.ps1 -Check
#>
param([switch]$Check)
$ErrorActionPreference = 'Stop'
$Version = '2.6.0'
$Sha256  = 'b2a706bc6ad475749e3b7e3409263aa1e6906d45bdcf993f6dbc0f660188f1af'
$Name    = "PresentMon-$Version-x64.exe"
$Url     = "https://github.com/GameTechDev/PresentMon/releases/download/v$Version/$Name"
$dirs = @('D:\Coding_Project\MinMusic-notes\tools\presentmon', (Join-Path $PSScriptRoot 'bin'))
$exe = $null
foreach ($d in $dirs) { $p = Join-Path $d $Name; if (Test-Path $p) { $exe = $p; break } }
if (-not $exe) {
  $d = $dirs | Where-Object { Test-Path (Split-Path $_) } | Select-Object -First 1
  New-Item -ItemType Directory -Force $d | Out-Null
  $exe = Join-Path $d $Name
  Invoke-WebRequest $Url -OutFile $exe
}
$hash = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
if ($hash -ne $Sha256) { Remove-Item $exe -Force; throw "PresentMon checksum mismatch: $hash" }

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
$admin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$plu = [bool]([Security.Principal.WindowsIdentity]::GetCurrent().Groups | Where-Object { $_.Value -eq 'S-1-5-32-559' }) # Performance Log Users
$can = $admin -or $plu
if ($Check) { @{ exe = $exe; version = $Version; sha256 = $hash; admin = $admin; performanceLogUsers = $plu; canTrace = $can } | ConvertTo-Json -Compress }
else { $exe }
if (-not $can) {
  [Console]::Error.WriteLine('PresentMon cannot start an ETW session: run elevated, or once (as admin): net localgroup "Performance Log Users" <you> /add, then sign out/in. perf-trace.ps1 continues without PresentMon (pmLongGaps = null).')
  exit 3
}
