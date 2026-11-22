<#
.SYNOPSIS  Warm-start timing (S1, S2): launches the app N times with a fresh data root and measures
           S1 = shell spawn -> performance.mark('mm-first-home-paint')  (window.__mmMarks, e2e build)
           S2 = shell spawn -> core READY (from the shell log READY timestamp; fallback: core_status=ready seen over CDP)
.EXAMPLE   powershell -File tools\perf\startup.ps1 -Runs 10 [-Exe path]
.NOTES     Cold starts (after a reboot) are measured by hand once. Writes docs\perf\<date>-startup.json.
           Needs the e2e hooks: window.__mmMarks (M0-A/M0-C) - rows without it report s1Ms=null.
#>
param([string]$Exe, [int]$Runs = 10)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
$repo = Get-RepoRoot
$exePath = Resolve-AppExe $Exe
$id = New-RunId
$rows = @()
$sharedRoot = Join-Path $repo ".testdata\$id-startup"
for ($i = 1; $i -le $Runs; $i++) {
  $app = $null
  try {
    $t0 = Get-Date
    $app = Start-TestApp -Exe $exePath -Root (Join-Path $sharedRoot "r$i")
    $t0 = $app.Proc.StartTime
    $s2 = $null; $s1 = $null; $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt 30 -and ($null -eq $s2 -or $null -eq $s1)) {
      try {
        if ($null -eq $s2) {
          $v = Invoke-CdpEval $app.Port "window.__TAURI__.core.invoke('core_status').then(v=>JSON.stringify(v))"
          if ($v -match 'ready') { $s2 = [math]::Round(((Get-Date) - $t0).TotalMilliseconds) }
        }
        if ($null -eq $s1) {
          # performance.now() origin = navigation start of the page; add its offset from the shell start
          $m = Invoke-CdpEval $app.Port "JSON.stringify({m:(window.__mmMarks&&window.__mmMarks['mm-first-home-paint'])||null, o:performance.timeOrigin})"
          $o = $m | ConvertFrom-Json
          if ($o.m -is [ValueType] -and $null -ne $o.m) {
            $origin = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$o.o).LocalDateTime
            $s1 = [math]::Round(($origin - $t0).TotalMilliseconds + [double]$o.m)
          }
        }
      } catch { }
      Start-Sleep -Milliseconds 100
    }
    $rows += [pscustomobject]@{ run = $i; s1Ms = $s1; s2Ms = $s2 }
    Write-Host "run ${i}: S1=$s1 ms  S2=$s2 ms"
  } finally { Stop-TestApp $app }
}
function Get-Median($a) { $s = @($a | Where-Object { $null -ne $_ } | Sort-Object); if ($s.Count) { $s[[int][math]::Floor(($s.Count - 1) / 2)] } else { $null } }
$sum = [pscustomobject]@{
  date = (Get-Date -Format 'yyyy-MM-dd'); runs = $Runs
  s1_median = Get-Median ($rows.s1Ms); s1_worst = ($rows.s1Ms | Where-Object { $null -ne $_ } | Measure-Object -Maximum).Maximum
  s2_median = Get-Median ($rows.s2Ms); s2_worst = ($rows.s2Ms | Where-Object { $null -ne $_ } | Measure-Object -Maximum).Maximum
  rows = $rows
}
New-Item -ItemType Directory -Force (Join-Path $repo 'docs\perf') | Out-Null
$sum | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $repo "docs\perf\$($sum.date)-startup.json") -Encoding utf8
$sum | Select-Object date, runs, s1_median, s1_worst, s2_median, s2_worst | ConvertTo-Json -Compress
