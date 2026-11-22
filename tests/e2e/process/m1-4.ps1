# M1-4 process checks. Dot-source after lifecycle.ps1 (it needs Start-Ready, Stop-TestApp, Invoke-CdpEval,
# Invoke-CoreCall, New-TestResult). Register in the T-P table of scripts/e2e.ps1 at integration:
#   'M1-4a' = ${function:Test-M14Balloon}; 'M1-4b' = ${function:Test-M14Smtc}

# T-P8 with the tray balloon flag: the first hide per install sets trayBalloonShown in shell.json.
function Test-M14Balloon($Ctx) {
  $app = Start-Ready $Ctx 'm14-balloon'
  try {
    $shellJson = Join-Path $app.Root 'Roaming\MinMusic\config\metrolist\shell.json'
    if (Test-Path $shellJson) { Remove-Item $shellJson -Force }
    Invoke-CdpEval $app.Port "window.__TAURI__.core.invoke('window_close')" | Out-Null
    Start-Sleep -Milliseconds 1500   # shell.json is written 500 ms after the change
    $flag = $false
    if (Test-Path $shellJson) { $flag = [bool]((Get-Content $shellJson -Raw | ConvertFrom-Json).trayBalloonShown) }
    $alive = (Test-ProcAlive $app.ShellPid) -and (Test-ProcAlive $app.CorePid)
    New-TestResult ($flag -and $alive) "trayBalloonShown=$flag alive=$alive (balloon pixels are not asserted)"
  } catch { New-TestResult $false "$_" } finally { Stop-TestApp $app }
}

function Await-WinRt($op, [Type]$resultType) {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $m = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  $t = $m.MakeGenericMethod($resultType).Invoke($null, @($op))
  $t.Wait(5000) | Out-Null
  $t.Result
}

# SMTC: with a track playing, the Windows media session title equals the track title.
function Test-M14Smtc($Ctx) {
  $app = Start-Ready $Ctx 'm14-smtc'
  try {
    $win = Invoke-CoreCall $app.Port 'library.window' @{ list = 'songs'; sort = @{ by = 'title'; desc = $false }; offset = 0; limit = 3 }
    if (-not $win -or -not $win.items -or $win.items.Count -lt 1) { return New-TestResult $true 'needs a fixture library with a playable song' -Skip }
    $track = $win.items[0]
    Invoke-CoreCall $app.Port 'player.play' @{ context = @{ kind = 'tracks'; ids = @($track.id) } } | Out-Null
    Start-Sleep -Seconds 3
    [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
    [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
    $mgr = Await-WinRt ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $titles = @()
    foreach ($s in $mgr.GetSessions()) {
      $p = Await-WinRt ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $titles += $p.Title
    }
    $ok = $titles -contains $track.title
    New-TestResult $ok ("track '{0}'; SMTC session titles: {1}" -f $track.title, ($titles -join ' | '))
  } catch { New-TestResult $false "$_" } finally { Stop-TestApp $app }
}
