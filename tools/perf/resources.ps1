<#
.SYNOPSIS  Samples PrivateMemorySize64 and CPU of the shell, its WebView2 children and the core every second (R1, R2, C1).
.EXAMPLE   powershell -File tools\perf\resources.ps1 -ShellPid 1234 -Seconds 60 -Out .testdata\x\res.json
.NOTES     Process tree = ParentProcessId walk from the shell PID (so the owner's own MinMusic/Edge is never counted).
           CPU % is of TOTAL CPU capacity (all logical cores), averaged over the window.
#>
param(
  [Parameter(Mandatory)][int]$ShellPid,
  [int]$Seconds = 60,
  [string]$Out = ''
)
function Get-Tree([int]$Root) {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name
  $set = [System.Collections.Generic.HashSet[int]]::new(); [void]$set.Add($Root)
  $grew = $true
  while ($grew) {
    $grew = $false
    foreach ($p in $all) { if ($set.Contains([int]$p.ParentProcessId) -and $set.Add([int]$p.ProcessId)) { $grew = $true } }
  }
  return $set
}
$cores = [Environment]::ProcessorCount
$prevCpu = @{}; $samples = @()
$sw = [Diagnostics.Stopwatch]::StartNew(); $last = 0.0
for ($i = 0; $i -lt $Seconds; $i++) {
  $tree = Get-Tree $ShellPid
  $procs = Get-Process -Id @($tree) -ErrorAction SilentlyContinue
  $priv = 0L; $cpuDelta = 0.0; $by = @{}
  foreach ($p in $procs) {
    $priv += $p.PrivateMemorySize64
    $by[$p.ProcessName] = ($by[$p.ProcessName] + $p.PrivateMemorySize64)
    $c = $p.TotalProcessorTime.TotalSeconds
    if ($prevCpu.ContainsKey($p.Id)) { $cpuDelta += [math]::Max(0, $c - $prevCpu[$p.Id]) }
    $prevCpu[$p.Id] = $c
  }
  $now = $sw.Elapsed.TotalSeconds; $dt = $now - $last; $last = $now
  $samples += [pscustomobject]@{ t = [math]::Round($now, 1); privateMB = [math]::Round($priv / 1MB, 1); cpuPct = $(if ($i -gt 0 -and $dt -gt 0) { [math]::Round(100 * $cpuDelta / ($dt * $cores), 2) } else { 0 }); procs = @($procs).Count; byName = $by }
  $sleep = 1000 - ($sw.ElapsedMilliseconds % 1000)
  Start-Sleep -Milliseconds $sleep
}
$cpuAvg = ($samples | Select-Object -Skip 1 | Measure-Object cpuPct -Average).Average
$res = [pscustomobject]@{
  shellPid = $ShellPid; seconds = $Seconds; logicalCores = $cores
  privateMB_max = ($samples | Measure-Object privateMB -Maximum).Maximum
  privateMB_last = $samples[-1].privateMB
  cpuPct_avg = [math]::Round($cpuAvg, 2)
  lastByProcessMB = @($samples[-1].byName.GetEnumerator() | ForEach-Object { [pscustomobject]@{ name = $_.Key; mb = [math]::Round($_.Value / 1MB, 1) } })
  samples = $samples | Select-Object t, privateMB, cpuPct, procs
}
if ($Out) { $res | ConvertTo-Json -Depth 6 | Set-Content $Out -Encoding utf8 }
$res | Select-Object shellPid, seconds, privateMB_max, privateMB_last, cpuPct_avg | ConvertTo-Json -Compress
