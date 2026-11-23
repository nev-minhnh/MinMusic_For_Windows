# Process lifecycle tests T-P1 ... T-P12 (test-guide section 3). Dot-sourced by scripts/e2e.ps1 -Suite process.
# Each Test-TPn takes $Ctx (@{ Exe; RunRoot }) and returns New-TestResult (Ok/Skip/Msg).
# Every test starts its own app instance with its own data root under .testdata\<run-id>\ and
# stops ONLY the PIDs from its own pidfile (never by image name).

function Get-CoreChildren([int]$ShellPid) {
  @(Get-CimInstance Win32_Process -Filter "Name='minmusic-core.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.ParentProcessId -eq $ShellPid })
}
function Get-CoreRoot([pscustomobject]$App) { Join-Path $App.Root 'Local\MinMusic\state\metrolist' }
function Start-Ready($Ctx, [string]$Name, [hashtable]$Env = @{}) {
  $root = Join-Path $Ctx.RunRoot $Name
  $app = Start-TestApp -Exe $Ctx.Exe -Root $root -ExtraEnv $Env
  Wait-AppReady $app | Out-Null
  # the pidfile is written by the shell once the core is up
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt 10) { $p = Read-PidFile $app.PidFile; if ($p -and $p.corePid) { break }; Start-Sleep -Milliseconds 200 }
  $app | Add-Member -NotePropertyName CorePid -NotePropertyValue ([int]$p.corePid) -Force
  return $app
}
function Get-StatusTimeline($App, [int]$Ms) { (Invoke-Cdp -Port $App.Port watch $Ms) | ConvertFrom-Json }

function Test-TP1($Ctx) {
  $app = Start-Ready $Ctx 'tp1'
  try {
    $core = $app.CorePid
    & taskkill /F /PID $app.ShellPid | Out-Null
    $t = Wait-ProcGone @($core) 2
    if ($t -ge 0) { New-TestResult $true ("core gone {0:N2} s after the shell was killed" -f $t) }
    else { New-TestResult $false "core $core still alive 2 s after taskkill /F of the shell" }
  } finally { Stop-TestApp $app }
}

function Test-TP2($Ctx) {
  $app = Start-Ready $Ctx 'tp2'
  try {
    $win = Invoke-CoreCall $app.Port 'library.window' @{ list = 'songs'; sort = @{ by = 'title'; dir = 'asc' }; offset = 0; limit = 5 }
    if (-not $win -or -not $win.items -or $win.items.Count -lt 5) { return New-TestResult $true 'needs a fixture library with >= 5 songs and a playing core (library.window/player.play unavailable)' -Skip }
    $ids = @($win.items | ForEach-Object { $_.id })
    Invoke-CoreCall $app.Port 'player.play' @{ context = @{ kind = 'tracks'; ids = $ids } } | Out-Null
    Start-Sleep -Seconds 2
    Invoke-CoreCall $app.Port 'player.seek' @{ ms = 42000 } | Out-Null
    Invoke-CoreCall $app.Port 'player.pause' | Out-Null
    Start-Sleep -Milliseconds 800
    $pids = Get-AppPids $app
    Invoke-CdpEval $app.Port "window.__TAURI__.core.invoke('app_quit')" 2>$null | Out-Null
    $t = Wait-ProcGone $pids 4
    if ($t -lt 0) { return New-TestResult $false 'processes still alive 4 s after app_quit' }
    $app2 = Start-TestApp -Exe $Ctx.Exe -Root $app.Root
    try {
      Wait-AppReady $app2 | Out-Null
      $q = Invoke-CoreCall $app2.Port 'queue.window' @{ offset = 0; limit = 10 }
      $snap = Invoke-Cdp -Port $app2.Port core 'sub:player' '{}' | ConvertFrom-Json
      $pos = [double]($snap.p.positionMs); $playing = $snap.p.playing
      $ok = ($q.total -eq 5) -and ([math]::Abs($pos / 1000 - 42) -le 1) -and (-not $playing)
      New-TestResult $ok ("quit {0:N2} s; restored total={1} index={2} pos={3:N1}s playing={4}" -f $t, $q.total, $q.currentIndex, ($pos / 1000), $playing)
    } finally { Stop-TestApp $app2 }
  } catch { New-TestResult $false "$_" } finally { Stop-TestApp $app }
}

function Test-TP3($Ctx) {
  $app = Start-Ready $Ctx 'tp3'
  try {
    $old = $app.CorePid
    $job = Start-Job { param($cdp, $port) & node $cdp --port $port watch 8000 } -ArgumentList $script:Cdp, $app.Port
    Start-Sleep -Milliseconds 400
    Stop-Process -Id $old -Force
    $tl = (Receive-Job $job -Wait -AutoRemoveJob) | ConvertFrom-Json
    $states = ($tl | ForEach-Object { $_.state }) -join '>'
    $r = $tl | Where-Object { $_.state -eq 'ready' } | Select-Object -Last 1
    $sawRestart = $states -match 'restarting'
    $p = Read-PidFile $app.PidFile
    $cores = @(Get-CoreChildren $app.ShellPid)
    $new = if ($p) { [int]$p.corePid } else { 0 }
    $ok = $sawRestart -and ($states -match 'ready$') -and ($r.t -le 5400) -and ($cores.Count -eq 1) -and ($new -ne $old)
    New-TestResult $ok "states=$states ready at t=$($r.t) ms; core pids now: $($cores.Count) (old $old, new $new). Restart banner not asserted: M0-C defines no testid for it"
  } catch { New-TestResult $false "$_" } finally { Stop-TestApp $app }
}

function Test-TP4($Ctx) {
  $app = Start-Ready $Ctx 'tp4'
  try {
    $old = @{}; foreach ($k in $app.Env.Keys) { $old[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, [string]$app.Env[$k]) }
    try { $second = Start-Process -FilePath $app.Exe -PassThru } finally { foreach ($k in $old.Keys) { [Environment]::SetEnvironmentVariable($k, $old[$k]) } }
    $t = Wait-ProcGone @($second.Id) 2
    $cores = @(Get-CoreChildren $app.ShellPid)
    if ($t -lt 0) { Stop-Process -Id $second.Id -Force -ErrorAction SilentlyContinue }
    $ok = ($t -ge 0) -and ($cores.Count -eq 1)
    New-TestResult $ok ("second instance exited in {0:N2} s; minmusic-core.exe children of the shell: {1}. Window focus not asserted (needs an unlocked desktop)" -f $t, $cores.Count)
  } finally { Stop-TestApp $app }
}

function Test-TP5($Ctx) {
  $app = Start-Ready $Ctx 'tp5' @{ MINMUSIC_TEST_NO_JOB = '1' }
  try {
    $core = $app.CorePid
    & taskkill /F /PID $app.ShellPid | Out-Null
    $t = Wait-ProcGone @($core) 3
    if ($t -lt 0) { Stop-Process -Id $core -Force -ErrorAction SilentlyContinue }
    New-TestResult ($t -ge 0) $(if ($t -ge 0) { "core exited {0:N2} s after the shell died (no job)" -f $t } else { 'core still alive 3 s after the shell was killed without a Job Object' })
  } finally { Stop-TestApp $app }
}

function Test-TP6($Ctx) {
  $core = Get-ChildItem (Join-Path $script:Repo 'sidecar\dist') -Recurse -Filter minmusic-core.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $core) { return New-TestResult $true 'needs sidecar\dist\...\minmusic-core.exe (M0-B); not built yet' -Skip }
  $root = Join-Path $Ctx.RunRoot 'tp6'
  $stateDir = Join-Path $root 'Local\MinMusic\state\metrolist'
  New-Item -ItemType Directory -Force $stateDir | Out-Null
  $stale = Start-Process -FilePath $core.FullName -ArgumentList '--cds-warmup-idle' -PassThru -WindowStyle Hidden
  $app = $null
  try {
    Start-Sleep -Milliseconds 800
    $startMs = [DateTimeOffset]::new($stale.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()
    (@{ pid = $stale.Id; startTimeMs = $startMs; exe = $core.FullName } | ConvertTo-Json -Compress) | Set-Content (Join-Path $stateDir 'core.pid') -Encoding utf8
    $app = Start-TestApp -Exe $Ctx.Exe -Root $root
    Wait-AppReady $app | Out-Null
    Start-Sleep -Seconds 1
    $stalePid = $stale.Id; $gone = -not (Test-ProcAlive $stalePid)
    $cores = @(Get-CimInstance Win32_Process -Filter "Name='minmusic-core.exe'" | Where-Object { $_.ParentProcessId -eq $app.ShellPid })
    New-TestResult ($gone -and $cores.Count -eq 1) "stale core $stalePid killed=$gone; cores under the shell: $($cores.Count)"
  } catch { New-TestResult $false "$_" } finally {
    if (Test-ProcAlive $stale.Id) { Stop-Process -Id $stale.Id -Force -ErrorAction SilentlyContinue } # our own helper process
    Stop-TestApp $app
  }
}

function Test-TP7($Ctx) {
  $app = Start-Ready $Ctx 'tp7'
  try {
    $sw = [Diagnostics.Stopwatch]::StartNew(); $failedAt = 0
    for ($i = 1; $i -le 4; $i++) {
      $p = Read-PidFile $app.PidFile
      if (-not $p -or -not (Test-ProcAlive ([int]$p.corePid))) {
        $st = try { Invoke-CdpEval $app.Port "window.__TAURI__.core.invoke('core_status').then(v=>JSON.stringify(v))" } catch { '' }
        if ($st -match 'failed') { $failedAt = $i; break }
        Start-Sleep -Milliseconds 700; continue
      }
      Stop-Process -Id ([int]$p.corePid) -Force
      Start-Sleep -Milliseconds 6500 # back-off 0.5/2/5 s plus restart
      $st = try { Invoke-CdpEval $app.Port "window.__TAURI__.core.invoke('core_status').then(v=>JSON.stringify(v))" } catch { '' }
      if ($st -match 'failed') { $failedAt = $i; break }
    }
    $st = try { Invoke-CdpEval $app.Port "window.__TAURI__.core.invoke('core_status').then(v=>JSON.stringify(v))" } catch { '' }
    $cores = @(Get-CoreChildren $app.ShellPid)
    $ok = ($st -match 'failed') -and ($failedAt -eq 3) -and ($cores.Count -eq 0)
    $pids = Get-AppPids $app
    Invoke-CdpEval $app.Port "window.__TAURI__.core.invoke('app_quit')" 2>$null | Out-Null
    $t = Wait-ProcGone $pids 4
    $msg = ("failed state after crash #{0} (expected 3) in {1:N0} s, status={2}, live cores={3}, quit gone in {4:N2} s. Fatal screen not asserted visually (see screenshots)" -f $failedAt, $sw.Elapsed.TotalSeconds, $st, $cores.Count, $t)
    New-TestResult ($ok -and $t -ge 0) $msg
  } catch { New-TestResult $false "$_" } finally { Stop-TestApp $app }
}

function Test-TP8($Ctx) {
  $app = Start-Ready $Ctx 'tp8'
  try {
    Invoke-CdpEval $app.Port "window.__TAURI__.core.invoke('window_close')" | Out-Null
    Start-Sleep -Seconds 2
    # Process.MainWindowHandle turns into the single-instance helper window once hidden: pick the real one by class.
    Add-Type -Namespace Mm -Name W -MemberDefinition '[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, System.IntPtr l); public delegate bool EnumProc(System.IntPtr h, System.IntPtr l); [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr h, out int pid); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(System.IntPtr h, System.Text.StringBuilder s, int n);' -ErrorAction SilentlyContinue
    $hwnd = [IntPtr]::Zero; $shellPid = $app.ShellPid
    $cb = [Mm.W+EnumProc]{ param($h, $l) $p = 0; [void][Mm.W]::GetWindowThreadProcessId($h, [ref]$p); if ($p -eq $shellPid) { $sb = New-Object System.Text.StringBuilder 256; [void][Mm.W]::GetClassName($h, $sb, 256); if ($sb.ToString() -eq "Tauri Window") { $script:tp8Hwnd = $h; return $false } }; return $true }
    $script:tp8Hwnd = [IntPtr]::Zero; [void][Mm.W]::EnumWindows($cb, [IntPtr]::Zero); $hwnd = $script:tp8Hwnd
    $alive = (Test-ProcAlive $app.ShellPid) -and (Test-ProcAlive $app.CorePid)
    $visible = $false
    try { Add-Type -Namespace Mm -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);' } catch { }
    if ($hwnd -ne [IntPtr]::Zero) { $visible = [Mm.U]::IsWindowVisible($hwnd) }
    New-TestResult ($alive -and ($hwnd -ne [IntPtr]::Zero) -and -not $visible) "alive=$alive windowFound=$($hwnd -ne [IntPtr]::Zero) windowVisible=$visible (default settings: minimise to tray). player.playing for 10 s needs a playable fixture: not asserted"
  } catch { New-TestResult $false "$_" } finally { Stop-TestApp $app }
}

function Test-TP9($Ctx) {
  $app = Start-Ready $Ctx 'tp9'
  try {
    try { Invoke-CoreCall $app.Port 'settings.set' @{ key = 'minimizeToTrayOnClose'; value = $false } | Out-Null }
    catch { return New-TestResult $true "settings.set minimizeToTrayOnClose unavailable: $_" -Skip }
    $pids = Get-AppPids $app
    Invoke-CdpEval $app.Port "window.__TAURI__.core.invoke('window_close')" 2>$null | Out-Null
    $t = Wait-ProcGone $pids 4
    New-TestResult ($t -ge 0) $(if ($t -ge 0) { "normal quit, both gone in {0:N2} s (queue restore: see T-P2)" -f $t } else { 'processes still alive 4 s after close with minimizeToTrayOnClose=false' })
  } catch { New-TestResult $false "$_" } finally { Stop-TestApp $app }
}

function Test-TP10($Ctx) {
  $app = Start-Ready $Ctx 'tp10'
  try {
    $sm = Join-Path $script:Repo 'tools\sendmsg.ps1'
    $pids = Get-AppPids $app
    $a = & powershell -NoProfile -ExecutionPolicy Bypass -File $sm -ProcessId $app.ShellPid -Message 0x11 -WParam 0 -LParam 0 -TimeoutMs 3500 | ConvertFrom-Json  # WM_QUERYENDSESSION
    $b = & powershell -NoProfile -ExecutionPolicy Bypass -File $sm -ProcessId $app.ShellPid -Message 0x16 -WParam 1 -LParam 0 -TimeoutMs 3500 | ConvertFrom-Json  # WM_ENDSESSION(TRUE)
    $t = Wait-ProcGone $pids 4
    $ok = $a.returned -and ($a.result -eq 1) -and $b.returned -and ($b.elapsedMs -le 3500) -and ($t -ge 0)
    New-TestResult $ok "QUERYENDSESSION returned=$($a.returned) result=$($a.result) in $($a.elapsedMs) ms; ENDSESSION returned=$($b.returned) in $($b.elapsedMs) ms; processes gone: $($t -ge 0). Queue-saved check: see T-P2"
  } catch { New-TestResult $false "$_" } finally { Stop-TestApp $app }
}

function Test-TP11($Ctx) {
  $root = Join-Path $Ctx.RunRoot 'tp11'
  $stateDir = Join-Path $root 'Local\MinMusic\state\metrolist'
  New-Item -ItemType Directory -Force $stateDir | Out-Null
  $fs = [IO.File]::Open((Join-Path $stateDir 'metrolist.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
  $app = $null
  try {
    $app = Start-TestApp -Exe $Ctx.Exe -Root $root
    # The core exits with 20 before READY; the shell must not retry: a native message box (dialog class #32770, text
    # "MinMusic 1.x ...") appears, and closing it ends the shell.
    Add-Type -Namespace Mm -Name W11 -MemberDefinition '[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, System.IntPtr l); public delegate bool EnumProc(System.IntPtr h, System.IntPtr l); [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr h, out int pid); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(System.IntPtr h, System.Text.StringBuilder s, int n); [DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern System.IntPtr FindWindowEx(System.IntPtr p, System.IntPtr a, string c, string w); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n); [DllImport("user32.dll")] public static extern bool PostMessage(System.IntPtr h, int m, System.IntPtr w, System.IntPtr l);' -ErrorAction SilentlyContinue
    $shellPid = $app.ShellPid
    $script:tp11Dlg = [IntPtr]::Zero
    $deadline = (Get-Date).AddSeconds(30)
    while ($script:tp11Dlg -eq [IntPtr]::Zero -and (Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 500
      $cb = [Mm.W11+EnumProc]{ param($h, $l) $p = 0; [void][Mm.W11]::GetWindowThreadProcessId($h, [ref]$p); if ($p -eq $shellPid -and [Mm.W11]::IsWindowVisible($h)) { $sb = New-Object System.Text.StringBuilder 64; [void][Mm.W11]::GetClassName($h, $sb, 64); if ($sb.ToString() -eq '#32770') { $script:tp11Dlg = $h; return $false } }; return $true }
      [void][Mm.W11]::EnumWindows($cb, [IntPtr]::Zero)
    }
    $text = ''
    if ($script:tp11Dlg -ne [IntPtr]::Zero) {
      $st = [Mm.W11]::FindWindowEx($script:tp11Dlg, [IntPtr]::Zero, 'Static', $null)
      while ($st -ne [IntPtr]::Zero -and -not $text) { $sb = New-Object System.Text.StringBuilder 256; [void][Mm.W11]::GetWindowText($st, $sb, 256); $text = $sb.ToString(); $st = [Mm.W11]::FindWindowEx($script:tp11Dlg, $st, 'Static', $null) }
    }
    $msg = $text -match 'MinMusic 1\.x'
    $cores = @(Get-CimInstance Win32_Process -Filter "Name='minmusic-core.exe'" | Where-Object { $_.ParentProcessId -eq $shellPid })
    if ($script:tp11Dlg -ne [IntPtr]::Zero) { [void][Mm.W11]::PostMessage($script:tp11Dlg, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) } # WM_CLOSE
    $exited = $false
    try { $exited = (Get-Process -Id $shellPid -ErrorAction Stop).WaitForExit(10000) } catch { $exited = $true }
    New-TestResult ($msg -and $cores.Count -eq 0 -and $exited) "message box='$text'; cores under the shell=$($cores.Count); shell exited after OK=$exited"
  } catch { New-TestResult $false "$_" } finally { $fs.Dispose(); Stop-TestApp $app }
}

function Test-TP12($Ctx) { New-TestResult $true 'M5 (NSIS installer); not applicable in M0' -Skip }

$script:ProcessTests = [ordered]@{
  'T-P1' = ${function:Test-TP1}; 'T-P2' = ${function:Test-TP2}; 'T-P3' = ${function:Test-TP3}; 'T-P4' = ${function:Test-TP4}
  'T-P5' = ${function:Test-TP5}; 'T-P6' = ${function:Test-TP6}; 'T-P7' = ${function:Test-TP7}; 'T-P8' = ${function:Test-TP8}
  'T-P9' = ${function:Test-TP9}; 'T-P10' = ${function:Test-TP10}; 'T-P11' = ${function:Test-TP11}; 'T-P12' = ${function:Test-TP12}
}
