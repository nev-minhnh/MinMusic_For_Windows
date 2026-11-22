<#
.SYNOPSIS  Creates an EMPTY placeholder sidecar\dist (runtime\, lib\, core.args, core.jsa) when it does not exist.
.DESCRIPTION
  tauri.conf.json bundle.resources lists ../sidecar/dist/{runtime,lib,core.args,core.jsa}. tauri-build (run by
  `cargo check`, `cargo test`, `cargo build`) fails with "resource path ... doesn't exist" when they are missing, e.g. in a
  fresh worktree before the sidecar image was built. Run this once before cargo check/test. Existing files are never
  overwritten, a real sidecar image is never touched. sidecar\dist is git-ignored. Never use the stub for a bundle build.
.EXAMPLE   powershell -File src-tauri\nsis\stub-sidecar.ps1
#>
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$d = Join-Path $repo 'sidecar\dist'
foreach ($n in 'runtime', 'lib') { $p = Join-Path $d $n; if (-not (Test-Path $p)) { New-Item -ItemType Directory -Force $p | Out-Null; Write-Host "stub dir  $p" } }
foreach ($n in 'core.args', 'core.jsa') { $p = Join-Path $d $n; if (-not (Test-Path $p)) { New-Item -ItemType File -Force $p | Out-Null; Write-Host "stub file $p" } }
