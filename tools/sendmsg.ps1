<#
.SYNOPSIS  SendMessageTimeout helper (test T-P10: WM_QUERYENDSESSION / WM_ENDSESSION).
.EXAMPLE   powershell -File tools\sendmsg.ps1 -ProcessId 1234 -Message 0x11 -WParam 0 -LParam 0 -TimeoutMs 3500
           Sends to a top-level window of PID 1234 (or -Hwnd). Prints one JSON line:
           {"hwnd":..,"returned":true/false,"result":..,"elapsedMs":..,"timedOut":..}
#>
param(
  [int]$ProcessId = 0,
  [long]$Hwnd = 0,
  [Parameter(Mandatory)][string]$Message,   # decimal or 0x hex
  [string]$WParam = '0',
  [string]$LParam = '0',
  [int]$TimeoutMs = 3500
)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MmWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, UIntPtr w, IntPtr l, uint flags, uint timeout, out UIntPtr result);
  // Prefers a visible top-level window of the process, else any.
  public static IntPtr FindMain(uint pid) {
    IntPtr any = IntPtr.Zero, vis = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid) { if (any == IntPtr.Zero) any = h; if (vis == IntPtr.Zero && IsWindowVisible(h)) vis = h; }
      return true; }, IntPtr.Zero);
    return vis != IntPtr.Zero ? vis : any;
  }
}
'@
function ConvertTo-Num([string]$s) { if ($s -match '^0x') { [Convert]::ToInt64($s.Substring(2), 16) } else { [long]$s } }
$h = [IntPtr]$Hwnd
if ($h -eq [IntPtr]::Zero) {
  $h = [MmWin]::FindMain([uint32]$ProcessId)
  if ($h -eq [IntPtr]::Zero) { [Console]::Error.WriteLine("no window for pid $ProcessId"); exit 1 }
}
$res = [UIntPtr]::Zero
$sw = [Diagnostics.Stopwatch]::StartNew()
# SMTO_ABORTIFHUNG = 2
$ok = [MmWin]::SendMessageTimeout($h, [uint32](ConvertTo-Num $Message), [UIntPtr][uint64](ConvertTo-Num $WParam), [IntPtr](ConvertTo-Num $LParam), 2, [uint32]$TimeoutMs, [ref]$res)
$sw.Stop()
@{ hwnd = [long]$h; returned = ($ok -ne [IntPtr]::Zero); result = [long]$res.ToUInt64(); elapsedMs = [int]$sw.ElapsedMilliseconds; timedOut = ($ok -eq [IntPtr]::Zero) } | ConvertTo-Json -Compress
