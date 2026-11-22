<#
.SYNOPSIS  Starts the real app in test mode and runs an e2e suite (test-guide section 0 and 3).
.DESCRIPTION
  -Suite contract : node tests/contract/run.mjs --target mock (or -Exe real) --suite <-ContractSuite>; no app started.
  -Suite web      : Playwright web project (Vite + mock-core), tests/e2e/web, or only -Spec <file>. Ports from MM_WEB_PORT /
                    MOCK_PORT (defaults 5173 / 47999); servers are never reused unless MM_REUSE=1.
  -Suite process  : PowerShell lifecycle tests T-P1..T-P12 (each test starts its own instance).
  -Suite <name>   : starts the app once, attaches Playwright over CDP, runs
                    npx playwright test --project=app tests/e2e/<name>
  Run id yyyyMMdd-HHmmss; data root .testdata\<id>; env MINMUSIC_DATA_ROOT / MINMUSIC_DEVTOOLS_PORT /
  MINMUSIC_TEST_PIDFILE. Stops ONLY the PIDs from its own pidfile. Exit code = number of failures.
  The owner's %LOCALAPPDATA%\MinMusic is never used; a before/after snapshot is written to
  .testdata\<id>\realdata-check.txt as proof.
.EXAMPLE   powershell -ExecutionPolicy Bypass -File scripts\e2e.ps1 -Suite process
.EXAMPLE   powershell -ExecutionPolicy Bypass -File scripts\e2e.ps1 -Suite smoke -Exe src-tauri\target\x86_64-pc-windows-gnu\debug\MinMusic.exe
#>
param(
  [Parameter(Mandatory)][string]$Suite,
  [string]$Exe,
  [switch]$Keep,                 # keep the app running and the data root after the run
  [string[]]$Only = @(),         # process suite: run only these ids, e.g. -Only T-P1,T-P3
  [string]$Spec = "",            # web / app suites: run only this Playwright file, e.g. -Spec tests/e2e/web/m1-3b.spec.ts
  [string]$ContractSuite = "all"  # contract suite: names in tests/contract/suites, comma separated, or all
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\tools\perf\lib.ps1')
$repo = Get-RepoRoot
$id = New-RunId
$root = Join-Path $repo ".testdata\$id"
$shots = Join-Path $root 'shots'
New-Item -ItemType Directory -Force $shots | Out-Null
$failures = 0
$app = $null
$before = Get-RealDataSnapshot
Write-Host "run $id  root $root"

try {
  if ($Suite -notin 'contract', 'web') { $exePath = Resolve-AppExe $Exe; Write-Host "exe  $exePath" }
  if ($Suite -eq 'contract') {
    # Protocol contract suite (M0-D): node tests/contract/run.mjs --target mock|real --suite m0. No app needed.
    $target = if ($Exe -eq 'real') { 'real' } else { 'mock' }
    $exePath = $null
    Push-Location $repo
    try { & node tests/contract/run.mjs --target $target --suite $ContractSuite; $failures = $LASTEXITCODE } finally { Pop-Location }
    Write-Host "contract ($target) exit $failures"
  } elseif ($Suite -eq 'web') {
    # Vite dev server + mock-core, Chromium (playwright.config.ts starts the servers when needed). No app.
    Push-Location $repo
    $webSpec = if ($Spec) { $Spec } else { "tests/e2e/web" }
    try { & npx playwright test --project=web $webSpec --reporter=list; $failures = $LASTEXITCODE } finally { Pop-Location }
  } elseif ($Suite -eq 'process') {
    . (Join-Path $repo 'tests\e2e\process\lifecycle.ps1')
    $ctx = @{ Exe = $exePath; RunRoot = $root }
    $rows = @()
    foreach ($name in $script:ProcessTests.Keys) {
      if ($Only.Count -and ($Only -notcontains $name)) { continue }
      $sw = [Diagnostics.Stopwatch]::StartNew()
      try { $r = & $script:ProcessTests[$name] $ctx } catch { $r = New-TestResult $false "exception: $_" }
      $status = if ($r.Skip) { 'SKIP' } elseif ($r.Ok) { 'PASS' } else { 'FAIL' }
      if ($status -eq 'FAIL') { $failures++ }
      $rows += [pscustomobject]@{ Test = $name; Status = $status; Sec = [math]::Round($sw.Elapsed.TotalSeconds, 1); Message = $r.Msg }
      Write-Host ("{0,-6} {1,-4} {2,5:N1}s  {3}" -f $name, $status, $sw.Elapsed.TotalSeconds, $r.Msg)
    }
    $rows | ConvertTo-Json | Set-Content (Join-Path $root 'process-results.json') -Encoding utf8
    Write-Host ("process suite: {0} pass, {1} fail, {2} skip" -f @($rows | ? Status -eq 'PASS').Count, $failures, @($rows | ? Status -eq 'SKIP').Count)
  } else {
    $app = Start-TestApp -Exe $exePath -Root (Join-Path $root 'app')
    Wait-AppReady $app | Out-Null
    Write-Host "app ready: shell pid $($app.ShellPid), CDP port $($app.Port)"
    $env:MM_CDP_ENDPOINT = "http://127.0.0.1:$($app.Port)"
    $env:MM_RUN_ID = $id
    $env:MM_SHOTS_DIR = $shots
    $json = Join-Path $root 'playwright.json'
    $env:PLAYWRIGHT_JSON_OUTPUT_NAME = $json
    Push-Location $repo
    try { & npx playwright test --project=app $(if ($Spec) { $Spec } else { "tests/e2e/$Suite" }) --reporter=list,json } finally { Pop-Location }
    if (Test-Path $json) {
      $st = (Get-Content $json -Raw | ConvertFrom-Json).stats
      $failures = [int]$st.unexpected + [int]$st.flaky
      Write-Host "playwright: expected=$($st.expected) unexpected=$($st.unexpected) flaky=$($st.flaky) skipped=$($st.skipped)"
    } else { $failures = [math]::Max(1, $LASTEXITCODE) }
  }
} catch {
  Write-Host "ERROR: $_" -ForegroundColor Red
  $failures = [math]::Max(1, $failures)
} finally {
  if ($app -and -not $Keep) { Stop-TestApp $app }
  $after = Get-RealDataSnapshot
  $same = (($before | ConvertTo-Json -Compress) -eq ($after | ConvertTo-Json -Compress))
  @("before:", ($before | Format-Table -AutoSize | Out-String), "after:", ($after | Format-Table -AutoSize | Out-String), "unchanged: $same") |
    Set-Content (Join-Path $root 'realdata-check.txt') -Encoding utf8
  Write-Host "real data dirs unchanged: $same (proof: $root\realdata-check.txt; a difference can also come from the owner's own running MinMusic)"
}
exit $failures
