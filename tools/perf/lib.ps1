# Shared helpers for scripts/e2e.ps1, scripts/perf-trace.ps1 and the process suite.
# Dot-source:  . "$PSScriptRoot\..\tools\perf\lib.ps1"
# Rules (test-guide section 0): never touch the owner's real data, never kill by image name -
# only the PIDs from our own pidfile / that we started.
$script:Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:Cdp  = Join-Path $PSScriptRoot 'cdp.mjs'

function Get-RepoRoot { $script:Repo }

function New-RunId { Get-Date -Format 'yyyyMMdd-HHmmss' }

function Get-FreePort {
  $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $l.Start(); $p = $l.LocalEndpoint.Port; $l.Stop(); return $p
}

function Resolve-AppExe([string]$Exe) {
  if ($Exe) { return (Resolve-Path $Exe).Path }
  $c = foreach ($k in 'release', 'debug') {
    $p = Join-Path $script:Repo "src-tauri\target\x86_64-pc-windows-gnu\$k\MinMusic.exe"
    if (Test-Path $p) { Get-Item $p }
  }
  $best = $c | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $best) { throw "MinMusic.exe not found under src-tauri\target\x86_64-pc-windows-gnu\{release,debug}; pass -Exe" }
  return $best.FullName
}

# Snapshot of the owner's real data dirs, read-only (proof that tests never touch them).
function Get-RealDataSnapshot {
  $out = @()
  foreach ($d in @("$env:LOCALAPPDATA\MinMusic", "$env:APPDATA\MinMusic")) {
    if (Test-Path $d) {
      $f = @(Get-ChildItem $d -Recurse -Force -File -ErrorAction SilentlyContinue)
      $bytes = 0; foreach ($x in $f) { $bytes += $x.Length }
      $last = $f | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
      $out += [pscustomobject]@{ Dir = $d; Files = $f.Count; Bytes = $bytes; NewestWrite = $(if ($last) { $last.LastWriteTimeUtc.ToString('o') } else { '-' }) }
    } else { $out += [pscustomobject]@{ Dir = $d; Files = 0; Bytes = 0; NewestWrite = '(missing)' } }
  }
  return $out
}

function Invoke-Cdp {
  param([int]$Port, [Parameter(ValueFromRemainingArguments)]$Rest)
  $o = & node $script:Cdp --port $Port @Rest 2>&1
  if ($LASTEXITCODE -ne 0) { throw "cdp $($Rest -join ' '): $o" }
  return ($o | Out-String).Trim()
}
function Invoke-CdpEval([int]$Port, [string]$Js) { Invoke-Cdp -Port $Port eval $Js }
function Invoke-CoreCall([int]$Port, [string]$Method, $Params = $null) {
  $p = if ($null -ne $Params) { $Params | ConvertTo-Json -Compress -Depth 8 } else { '{}' }
  $o = Invoke-Cdp -Port $Port core $Method $p
  if ($o) { $o | ConvertFrom-Json } else { $null }
}

function Test-ProcAlive([int]$ProcId) { [bool](Get-Process -Id $ProcId -ErrorAction SilentlyContinue) }

# Returns seconds until all PIDs are gone, or -1 on timeout.
function Wait-ProcGone([int[]]$Pids, [double]$Seconds) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $Seconds) {
    if (-not ($Pids | Where-Object { Test-ProcAlive $_ })) { return $sw.Elapsed.TotalSeconds }
    Start-Sleep -Milliseconds 50
  }
  return -1
}

function Read-PidFile([string]$File) {
  if (-not (Test-Path $File)) { return $null }
  try { Get-Content $File -Raw | ConvertFrom-Json } catch { $null }
}

# Start the app with a private data root. Returns a context object.
function Start-TestApp {
  param([string]$Exe, [string]$Root, [hashtable]$ExtraEnv = @{}, [int]$Port = 0)
  New-Item -ItemType Directory -Force $Root | Out-Null
  if (-not $Port) { $Port = Get-FreePort }
  $pidfile = Join-Path $Root 'pids.json'
  Remove-Item $pidfile -ErrorAction SilentlyContinue
  $set = @{ MINMUSIC_DATA_ROOT = $Root; MINMUSIC_DEVTOOLS_PORT = "$Port"; MINMUSIC_TEST_PIDFILE = $pidfile } + $ExtraEnv
  $old = @{}
  foreach ($k in $set.Keys) { $old[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, [string]$set[$k]) }
  try { $proc = Start-Process -FilePath $Exe -PassThru -WorkingDirectory (Split-Path $Exe) }
  finally { foreach ($k in $old.Keys) { [Environment]::SetEnvironmentVariable($k, $old[$k]) } }
  [pscustomobject]@{ Proc = $proc; Exe = $Exe; Root = $Root; Port = $Port; PidFile = $pidfile; Env = $set; ShellPid = $proc.Id }
}

# Poll /json/version for 20 s, then core_status == ready (CDP evaluate), up to another 20 s.
function Wait-AppReady([pscustomobject]$App, [int]$CdpSeconds = 20, [int]$ReadySeconds = 20) {
  $sw = [Diagnostics.Stopwatch]::StartNew(); $ok = $false
  while ($sw.Elapsed.TotalSeconds -lt $CdpSeconds) {
    if ($App.Proc.HasExited) { throw "app exited early (code $($App.Proc.ExitCode))" }
    try { $null = Invoke-RestMethod "http://127.0.0.1:$($App.Port)/json/version" -TimeoutSec 2; $ok = $true; break } catch { Start-Sleep -Milliseconds 250 }
  }
  if (-not $ok) { throw "CDP endpoint 127.0.0.1:$($App.Port) not up after $CdpSeconds s" }
  $sw.Restart(); $last = ''
  while ($sw.Elapsed.TotalSeconds -lt $ReadySeconds) {
    try {
      $last = Invoke-CdpEval $App.Port "window.__TAURI__.core.invoke('core_status').then(v=>JSON.stringify(v))"
      if ($last -match 'ready') { return $true }
    } catch { $last = "$_" }
    Start-Sleep -Milliseconds 300
  }
  throw "core_status never became ready (last: $last)"
}

function Get-AppPids([pscustomobject]$App) {
  $p = Read-PidFile $App.PidFile
  $r = @()
  if ($p) { foreach ($n in 'shellPid', 'corePid') { if ($p.PSObject.Properties[$n] -and $p.$n) { $r += [int]$p.$n } } }
  if (-not $r) { $r = @($App.ShellPid) }
  return $r
}

# Graceful quit via CDP app_quit, then Stop-Process on ONLY our PIDs after 5 s.
function Stop-TestApp([pscustomobject]$App) {
  if (-not $App) { return }
  $pids = @(@(Get-AppPids $App) + @($App.ShellPid) | Select-Object -Unique)
  if ($pids | Where-Object { Test-ProcAlive $_ }) {
    try { $null = Invoke-CdpEval $App.Port "window.__TAURI__.core.invoke('app_quit')" } catch { }
    if ((Wait-ProcGone $pids 5) -lt 0) {
      foreach ($p in $pids) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
    }
  }
}

function New-TestResult([bool]$Ok, [string]$Msg, [switch]$Skip) {
  [pscustomobject]@{ Ok = $Ok; Skip = [bool]$Skip; Msg = $Msg }
}
