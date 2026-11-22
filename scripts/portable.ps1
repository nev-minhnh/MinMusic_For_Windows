<#
.SYNOPSIS  Builds the portable zip: MinMusic.exe + core\ + portable.flag -> MinMusic-<ver>-portable-x64.zip.
.DESCRIPTION
  Input: the release build output (src-tauri\target\<triple>\release\MinMusic.exe) and sidecar\dist
  (runtime, lib, core.args, core.jsa; the same files the installer ships as bundle.resources -> core\).
  Portable mode contract (architecture section 7): the presence of portable.flag next to MinMusic.exe makes the
  shell set MINMUSIC_PORTABLE=1 for itself and the core; the core then uses <exe dir>\data as the XDG base
  (data\Local, data\Roaming). The core side is checked at INT-W2 (if it is missing, M4-3a must add it).
  A portable copy is never auto-updated; Updates opens the release page.
  Zip entries use forward slashes. The zip is written to -OutDir (default: dist\ in the repo, git-ignored).
.EXAMPLE   powershell -File scripts\portable.ps1 [-Exe <MinMusic.exe>] [-Version 2.0.0-alpha.0]
#>
param(
  [string]$Exe = '',
  [string]$CoreDir = '',
  [string]$Version = '',
  [string]$OutDir = ''
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $CoreDir) { $CoreDir = Join-Path $repo 'sidecar\dist' }
if (-not $OutDir) { $OutDir = Join-Path $repo 'dist' }

if (-not $Version) {
  $conf = Get-Content (Join-Path $repo 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
  $Version = $conf.version
  if ($conf.plugins -and $conf.plugins.minmusic -and $conf.plugins.minmusic.displayVersion) { $Version = $conf.plugins.minmusic.displayVersion }
}
if (-not $Exe) {
  $c = foreach ($t in 'x86_64-pc-windows-msvc', 'x86_64-pc-windows-gnu', '') {
    $p = if ($t) { Join-Path $repo "src-tauri\target\$t\release\MinMusic.exe" } else { Join-Path $repo 'src-tauri\target\release\MinMusic.exe' }
    if (Test-Path $p) { Get-Item $p }
  }
  $best = $c | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $best) { throw 'MinMusic.exe (release build) not found under src-tauri\target; pass -Exe' }
  $Exe = $best.FullName
}
$Exe = (Resolve-Path $Exe).Path
foreach ($n in 'runtime', 'lib', 'core.args', 'core.jsa') {
  if (-not (Test-Path (Join-Path $CoreDir $n))) { throw "missing $CoreDir\$n (build the sidecar image first)" }
}

New-Item -ItemType Directory -Force $OutDir | Out-Null
$zip = Join-Path $OutDir "MinMusic-$Version-portable-x64.zip"
Remove-Item $zip -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.IO.Compression
$fs = [IO.File]::Open($zip, 'Create')
$za = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create)
function Add-ZipFile([string]$Path, [string]$Entry) {
  $e = $za.CreateEntry($Entry, [IO.Compression.CompressionLevel]::Optimal)
  $in = [IO.File]::OpenRead($Path); $out = $e.Open()
  try { $in.CopyTo($out) } finally { $out.Dispose(); $in.Dispose() }
}
try {
  Add-ZipFile $Exe 'MinMusic.exe'
  $flag = $za.CreateEntry('portable.flag'); $w = New-Object IO.StreamWriter($flag.Open()); $w.Write("portable`r`n"); $w.Dispose()
  foreach ($n in 'core.args', 'core.jsa') { Add-ZipFile (Join-Path $CoreDir $n) "core/$n" }
  foreach ($d in 'runtime', 'lib') {
    $base = (Resolve-Path (Join-Path $CoreDir $d)).Path
    Get-ChildItem $base -Recurse -File -Force | ForEach-Object {
      Add-ZipFile $_.FullName ("core/$d/" + $_.FullName.Substring($base.Length + 1).Replace('\', '/'))
    }
  }
} finally { $za.Dispose(); $fs.Dispose() }
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "portable zip: $zip ($mb MB)"
Write-Output $zip
