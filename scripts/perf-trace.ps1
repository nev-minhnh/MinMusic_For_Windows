<#
.SYNOPSIS  Performance measurement (test-guide section 5): scenarios P1..P8 on the real app, or CAL (analyzer calibration).
.DESCRIPTION
  -Scenario P1,P2,...|all|CAL   (all = P1..P6,P8; P7 = long tasks summed over P1-P5, derived)
  -Size 1920|4k                 1920: window 1920x1200 with --force-device-scale-factor=1; 4k: 3840x2400 native
  -Runs N                       repetitions, the WORST run counts (median shown too)
  Writes docs\perf\<date>-<scenario>-<size>.json and appends rows to docs\perf\results.md.
  CAL starts its own Microsoft Edge (same engine as WebView2) on tools\perf\cal\cal.html, three times:
     janky (120 ms busy loop every 1 s)  -> must show >= 1 long task/s and dropped > 0
     clean (same page, no injection)     -> 0 long tasks
     idle  (idle page, no input, 5 s)    -> 0 long tasks, 0 dropped frames
  PresentMon 2.6.0 is used when this account may start an ETW session (admin or "Performance Log Users");
  otherwise it is skipped with a warning and pmLongGaps stays null.
.EXAMPLE   powershell -ExecutionPolicy Bypass -File scripts\perf-trace.ps1 -Scenario CAL
.EXAMPLE   powershell -ExecutionPolicy Bypass -File scripts\perf-trace.ps1 -Scenario P1,P3,P4 -Size 1920 -Runs 1
#>
param(
  [string]$Scenario = 'all',
  [ValidateSet('4k', '1920')][string]$Size = '1920',
  [int]$Runs = 5,
  [string]$Exe,
  [string]$FixtureHome = '',
  [switch]$NoPresentMon,
  [int]$WarmupSeconds = 10
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\tools\perf\lib.ps1')
$repo = Get-RepoRoot
$id = New-RunId
$root = Join-Path $repo ".testdata\$id-perf"
$outDir = Join-Path $repo 'docs\perf'
$runMjs = Join-Path $repo 'tools\perf\run.mjs'
New-Item -ItemType Directory -Force $root, $outDir | Out-Null
$date = Get-Date -Format 'yyyy-MM-dd'
$results = Join-Path $outDir 'results.md'
$before = Get-RealDataSnapshot

# --- tools: sendinput.exe, PresentMon
$sendinput = Join-Path $repo 'tools\perf\bin\sendinput.exe'
if (-not (Test-Path $sendinput)) {
  Write-Host 'building sendinput (GNU toolchain)...'
  $env:RUSTUP_HOME = 'D:/Coding_Project/MinMusic-notes/tools/rust/rustup'; $env:CARGO_HOME = 'D:/Coding_Project/MinMusic-notes/tools/rust/cargo'
  $env:PATH = "D:\Coding_Project\MinMusic-notes\tools\rust\cargo\bin;C:\TDM-GCC-64\bin;$env:PATH"
  Push-Location (Join-Path $repo 'tools\perf\sendinput'); try { & cargo build --release } finally { Pop-Location }
  New-Item -ItemType Directory -Force (Split-Path $sendinput) | Out-Null
  Copy-Item (Join-Path $repo 'tools\perf\sendinput\target\release\sendinput.exe') $sendinput
}
$pmExe = $null
if (-not $NoPresentMon) {
  $ErrorActionPreference = 'Continue'
  $st = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'tools\perf\presentmon.ps1') -Check 2>&1 | ForEach-Object { "$_" }
  $ErrorActionPreference = 'Stop'
  $json = ($st | Where-Object { $_ -is [string] -and $_.TrimStart().StartsWith('{') }) | Select-Object -First 1
  if ($json) { $s = $json | ConvertFrom-Json; if ($s.canTrace) { $pmExe = $s.exe } else { Write-Warning "PresentMon present ($($s.exe)) but this account cannot start ETW sessions (admin=$($s.admin), Performance Log Users=$($s.performanceLogUsers)); continuing without it" } }
}

function Add-ResultRows([string]$JsonFile, [string]$Label) {
  if (-not (Test-Path $results)) {
    @('# Performance results', '', 'Worst of N runs counts (median in brackets). dropped = DROPPED + PRESENTED_PARTIAL over non-idle frames.', '',
      '| date | scenario | size | runs | frames (worst) | dropped % worst (median) | dropped (per transition) | long tasks | max long task ms | PM long gaps | input p95 ms | input via | verdict |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|---|') | Set-Content $results -Encoding utf8
  }
  $j = Get-Content $JsonFile -Raw | ConvertFrom-Json
  foreach ($p in $j.results.PSObject.Properties) {
    $r = $p.Value; $w = $r.worst
    if (-not $w) { Add-Content $results "| $($j.date) | $($p.Name)$Label | $($j.size) | $(@($r.runs).Count) | - | - | - | - | - | - | - | - | $($r.verdict) (no usable run) |"; continue }
    $per = if ($w.PSObject.Properties['droppedPerTransition']) { $w.droppedPerTransition } else { '-' }
    $gaps = if ($null -ne $w.pmLongGaps) { $w.pmLongGaps } else { 'n/a' }
    $lat = if ($null -ne $w.eventLatencyP95) { $w.eventLatencyP95 } else { '-' }
    Add-Content $results "| $($j.date) | $($p.Name)$Label | $($j.size) | $(@($r.runs).Count) | $($w.frames) | $($w.droppedPct) ($($r.medianDroppedPct)) | $per | $($w.longTasks) | $($w.maxLongTaskMs) | $gaps | $lat | $($j.osInput) | $($r.verdict) |"
  }
}

function Invoke-Run([string]$Endpoint, [string]$Names, [int]$N, [string]$Tag, [string[]]$Extra, [string]$PmProc) {
  $a = @($runMjs, '--endpoint', $Endpoint, '--scenario', $Names, '--size', $Size, '--runs', $N, '--out', $outDir, '--trace-dir', (Join-Path $root 'traces'))
  if ($Tag) { $a += @('--tag', $Tag) }
  if ($pmExe) { $a += @('--pm', $pmExe, '--pm-process', $PmProc) }
  $a += $Extra
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $lines = & node @a 2>&1 | ForEach-Object { $t = "$_"; Write-Host $t; $t } } finally { $ErrorActionPreference = $prev }
  $m = [regex]::Match(($lines -join "`n"), '"outFile":\s*"([^"]+)"')
  if (-not $m.Success) { throw "run.mjs produced no result file (see output above)" }
  $f = $m.Groups[1].Value -replace '\\', '\'
  return $(if ([IO.Path]::IsPathRooted($f)) { $f } else { Join-Path $repo $f })
}

# --- global perf lock (M1-5): one perf run on the machine at a time. mkdir is atomic; retry every 5 s; a lock older than 2 h is stale.
$lockDir = "D:Coding_ProjectMinMusic_4_Windows-wp.perf.lock"
$haveLock = $false
while (-not $haveLock) {
  try { New-Item -ItemType Directory -Path $lockDir -ErrorAction Stop | Out-Null; $haveLock = $true }
  catch {
    $li = Get-Item $lockDir -ErrorAction SilentlyContinue
    if ($li -and ((Get-Date) - $li.LastWriteTime).TotalHours -gt 2) { Write-Warning "breaking stale perf lock (older than 2 h)"; Remove-Item $lockDir -Recurse -Force -ErrorAction SilentlyContinue }
    else { Write-Host "perf lock held by another run, retrying in 5 s ($lockDir)"; Start-Sleep -Seconds 5 }
  }
}

$exitFail = 0
try {
  if ($Scenario.ToUpper() -eq 'CAL') {
    # ---------------------------------------------------------------- calibration on Edge
    $edge = @('C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', 'C:\Program Files\Microsoft\Edge\Application\msedge.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $edge) { throw 'Microsoft Edge not found' }
    $port = Get-FreePort
    $calUrl = ([uri](Join-Path $repo 'tools\perf\cal\cal.html')).AbsoluteUri
    $edgeProc = Start-Process $edge -PassThru -ArgumentList "--remote-debugging-port=$port", "--user-data-dir=$(Join-Path $root 'edge')", '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--window-position=0,0', '--window-size=1300,900', 'about:blank'
    try {
      $sw = [Diagnostics.Stopwatch]::StartNew()
      while ($sw.Elapsed.TotalSeconds -lt 20) { try { $null = Invoke-RestMethod "http://127.0.0.1:$port/json/version" -TimeoutSec 2; break } catch { Start-Sleep -Milliseconds 300 } }
      $ep = "http://127.0.0.1:$port"
      $files = @{}
      foreach ($k in @(@{ kind = 'jank'; q = '?jank=1'; sc = 'CAL' }, @{ kind = 'clean'; q = '?jank=0'; sc = 'CAL' }, @{ kind = 'idle'; q = '?idle=1'; sc = 'CAL-IDLE' })) {
        Write-Host "=== calibration: $($k.kind)"
        $files[$k.kind] = Invoke-Run $ep $k.sc $Runs $k.kind @('--url', "$calUrl$($k.q)", '--cal-kind', $k.kind, '--warmup', '1') 'msedge.exe'
        Add-ResultRows $files[$k.kind] " ($($k.kind))"
      }
      $rj = $files.jank | ForEach-Object { Get-Content $_ -Raw | ConvertFrom-Json }
      $rc = $files.clean | ForEach-Object { Get-Content $_ -Raw | ConvertFrom-Json }
      $ri = $files.idle | ForEach-Object { Get-Content $_ -Raw | ConvertFrom-Json }
      $jank = $rj.results.CAL; $clean = $rc.results.CAL; $idle = $ri.results.'CAL-IDLE'
      $contrast = $jank.medianDroppedPct -gt $clean.medianDroppedPct
      $summary = [ordered]@{
        date = $date; size = $Size; osInput = $rj.osInput
        jank = @{ verdict = $jank.verdict; worstLongTasks = $jank.worst.longTasks; maxLongTaskMs = $jank.worst.maxLongTaskMs; medianDroppedPct = $jank.medianDroppedPct; worstDroppedPct = $jank.worst.droppedPct; runs = $jank.runs | % { @{ frames = $_.frames; dropped = $_.dropped; longTasks = $_.longTasks; windowMs = $_.windowMs } } }
        clean = @{ verdict = $clean.verdict; worstLongTasks = $clean.worst.longTasks; medianDroppedPct = $clean.medianDroppedPct; worstDroppedPct = $clean.worst.droppedPct }
        idle = @{ verdict = $idle.verdict; frames = $idle.worst.frames; dropped = $idle.worst.dropped; noUpdateFrames = $idle.worst.noUpdate; longTasks = $idle.worst.longTasks; runTasksSeen = $idle.worst.runTasks }
        jankDropsExceedClean = $contrast
        pass = ($jank.verdict -eq 'PASS') -and ($clean.verdict -eq 'PASS') -and ($idle.verdict -eq 'PASS') -and $contrast
        files = $files
      }
      $summary | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $outDir "$date-CAL-$Size.json") -Encoding utf8
      Write-Host ($summary | ConvertTo-Json -Depth 4)
      if (-not $summary.pass) { $exitFail = 1 }
    } finally {
      if ($edgeProc -and -not $edgeProc.HasExited) { & taskkill /T /F /PID $edgeProc.Id | Out-Null } # only the Edge we started
    }
  } else {
    # ---------------------------------------------------------------- real app
    $names = $Scenario
    $exePath = Resolve-AppExe $Exe
    $env1 = @{}
    if ($Size -eq '1920') { $env1['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = '--force-device-scale-factor=1' }
    if (-not $FixtureHome) { $f = Join-Path $repo 'tests\fixtures\home.json'; if (Test-Path $f) { $FixtureHome = $f } }
    if ($FixtureHome) { $env1['MINMUSIC_CORE_EXTRA_ARGS'] = "--fixture-home `"$FixtureHome`"" }
    $app = Start-TestApp -Exe $exePath -Root (Join-Path $root 'app') -ExtraEnv $env1
    try {
      Wait-AppReady $app | Out-Null
      Complete-FirstRun $app
      $w, $h = $(if ($Size -eq '1920') { 1920, 1200 } else { 3840, 2400 })
      try { Invoke-CdpEval $app.Port "window.__TAURI__.core.invoke('test_set_window_size',{width:$w,height:$h})" | Out-Null } catch { Write-Warning "test_set_window_size failed ($_): window size NOT forced" }
      Write-Host "warm-up $WarmupSeconds s..."; Start-Sleep -Seconds $WarmupSeconds
      $j = Invoke-Run "http://127.0.0.1:$($app.Port)" $names $Runs '' @() 'msedgewebview2.exe'
      Add-ResultRows $j ''
      $data = Get-Content $j -Raw | ConvertFrom-Json
      # P7: long tasks during P1-P5 (sum of the worst runs)
      $p7 = 0; $have = $false
      foreach ($n in 'P1', 'P2', 'P3', 'P4', 'P5') { $r = $data.results.PSObject.Properties[$n]; if ($r -and $r.Value.worst) { $p7 += $r.Value.worst.longTasks; $have = $true } }
      if ($have) { Add-Content $results "| $date | P7 (derived) | $Size | - | - | - | - | $p7 | - | - | - | - | $(if ($p7 -eq 0) { 'PASS' } else { 'FAIL' }) |" }
      foreach ($p in $data.results.PSObject.Properties) { if ("$($p.Value.verdict)" -like 'FAIL*') { $exitFail++ } }
    } finally { Stop-TestApp $app }
  }
} finally {
  if ($haveLock) { Remove-Item $lockDir -Recurse -Force -ErrorAction SilentlyContinue }
  $after = Get-RealDataSnapshot
  $same = (($before | ConvertTo-Json -Compress) -eq ($after | ConvertTo-Json -Compress))
  Write-Host "real data dirs unchanged: $same"
}
exit $exitFail
