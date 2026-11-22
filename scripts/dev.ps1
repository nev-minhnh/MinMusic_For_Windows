<#
  Dev loop: mock-core (unless -Real) + `cargo tauri dev`, all test env vars pointing at .testdata\dev.
  Usage: scripts\dev.ps1 [-Real] [-Port 5173]
  Needs the GNU toolchain env: `source scripts/gnu-env.sh` in Git Bash, or the same variables set here.
#>
param([switch]$Real, [int]$DevtoolsPort = 9222)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$root = Join-Path $repo '.testdata\dev'
New-Item -ItemType Directory -Force -Path $root | Out-Null
$env:MINMUSIC_DATA_ROOT = $root
$env:MINMUSIC_DEVTOOLS_PORT = "$DevtoolsPort"
$env:MINMUSIC_TEST_PIDFILE = Join-Path $root 'pids.json'

# GNU toolchain (portable Rust + TDM-GCC; rust's self-contained linker, see scripts/gnu-env.sh)
$rustup = 'D:\Coding_Project\MinMusic-notes\tools\rust'
$env:RUSTUP_HOME = "$rustup\rustup"; $env:CARGO_HOME = "$rustup\cargo"
$env:Path = "$rustup\cargo\bin;C:\TDM-GCC-64\bin;$env:Path"
$env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = "$rustup\rustup\toolchains\stable-x86_64-pc-windows-gnu\lib\rustlib\x86_64-pc-windows-gnu\bin\self-contained\x86_64-w64-mingw32-gcc.exe"

$mock = $null
try {
    if (-not $Real) {
        $env:MINMUSIC_SIDECAR_CMD = "node `"$repo\mock-core\bin\sidecar.mjs`""
        Write-Host "using the fake core: $env:MINMUSIC_SIDECAR_CMD"
    }
    # `cargo tauri dev` starts the Vite dev server through build.beforeDevCommand when set;
    # here we start it explicitly so the script stays in control of the process.
    $vite = Start-Process -FilePath 'npm' -ArgumentList @('-w', 'ui', 'run', 'dev') -PassThru -WindowStyle Hidden
    try {
        cargo tauri dev --target x86_64-pc-windows-gnu
    } finally {
        if ($vite -and -not $vite.HasExited) { & taskkill /T /F /PID $vite.Id | Out-Null }
    }
} finally {
    if ($mock -and -not $mock.HasExited) { Stop-Process -Id $mock.Id -Force }
}
