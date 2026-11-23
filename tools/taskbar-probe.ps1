<#
.SYNOPSIS  Win32 probe for the M2-4 shell features (mini window, taskbar thumbnail buttons, Snap Layouts overlay).
           Every action prints ONE JSON line. Only touches windows of the given process id.
.EXAMPLE   powershell -File tools\taskbar-probe.ps1 -ProcessId 1234 -Action windows
             -> [{"hwnd":..,"class":"Tauri Window","title":"MinMusic","left":..,"top":..,"right":..,"bottom":..,"topmost":true,"visible":true}, ...]
           powershell -File tools\taskbar-probe.ps1 -ProcessId 1234 -Action command -ButtonId 1
             -> posts WM_COMMAND(THBN_CLICKED, id) to the main window, exactly what a click on a thumbnail button sends.
                ids: 0 previous, 1 play/pause, 2 next.
           powershell -File tools\taskbar-probe.ps1 -ProcessId 1234 -Action children
             -> child windows of the main window (looks for class MinMusicSnapHit, the Snap Layouts overlay)
           powershell -File tools\taskbar-probe.ps1 -ProcessId 1234 -Action hittest -X 1200 -Y 20
             -> WindowFromPoint(x,y) (screen px): its class, owner process and WM_NCHITTEST answer (9 = HTMAXBUTTON)
           powershell -File tools\taskbar-probe.ps1 -Action thumbnail
             -> best effort UI Automation search for the three thumbnail buttons (only exist while the taskbar
                thumbnail is open, i.e. while the mouse hovers the taskbar button)
#>
param(
  [int]$ProcessId = 0,
  [Parameter(Mandatory)][ValidateSet('windows', 'command', 'children', 'hittest', 'thumbnail')][string]$Action,
  [int]$ButtonId = 1,
  [int]$X = 0,
  [int]$Y = 0
)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class MmProbe {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct PT { public int X, Y; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(PT p);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
  public static string Cls(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
  public static string Txt(IntPtr h) { var s = new StringBuilder(256); GetWindowText(h, s, 256); return s.ToString(); }
  public static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
  public static RECT Rc(IntPtr h) { RECT r; GetWindowRect(h, out r); return r; }
  public static bool Vis(IntPtr h) { return IsWindowVisible(h); }
  public static bool Topmost(IntPtr h) { return ((long)GetWindowLongPtr(h, -20) & 0x8) != 0; }
  public static List<IntPtr> Top(uint pid) {
    var l = new List<IntPtr>();
    EnumWindows((h, _) => { if (Pid(h) == pid) l.Add(h); return true; }, IntPtr.Zero);
    return l;
  }
  public static List<IntPtr> Kids(IntPtr parent) {
    var l = new List<IntPtr>();
    EnumChildWindows(parent, (h, _) => { l.Add(h); return true; }, IntPtr.Zero);
    return l;
  }
  public static IntPtr At(int x, int y) { return WindowFromPoint(new PT { X = x, Y = y }); }
  public static long NcHitTest(IntPtr h, int x, int y) {
    IntPtr r; IntPtr lp = (IntPtr)(((y & 0xffff) << 16) | (x & 0xffff));
    SendMessageTimeout(h, 0x84, IntPtr.Zero, lp, 2, 1000, out r);
    return (long)r;
  }
}
'@

function Describe([IntPtr]$h) {
  $r = [MmProbe]::Rc($h)
  [ordered]@{
    hwnd = $h.ToInt64(); class = [MmProbe]::Cls($h); title = [MmProbe]::Txt($h)
    left = $r.L; top = $r.T; right = $r.R; bottom = $r.B
    topmost = [MmProbe]::Topmost($h); visible = [MmProbe]::Vis($h)
  }
}
function Tauri-Windows([int]$procId) {
  # the shell's top-level windows of class "Tauri Window" (main, mini; WebView2 hosts are children)
  [MmProbe]::Top([uint32]$procId) | Where-Object { [MmProbe]::Cls($_) -eq 'Tauri Window' }
}
function Main-Window([int]$procId) {
  # the main window is the widest visible Tauri window (the mini player is 320 px wide)
  Tauri-Windows $procId | Where-Object { [MmProbe]::Vis($_) -or $true } |
    Sort-Object { $r = [MmProbe]::Rc($_); $r.R - $r.L } -Descending | Select-Object -First 1
}

switch ($Action) {
  'windows' {
    if (-not $ProcessId) { throw '-ProcessId is required' }
    ConvertTo-Json -Compress -InputObject @(Tauri-Windows $ProcessId | ForEach-Object { Describe $_ })
  }
  'command' {
    if (-not $ProcessId) { throw '-ProcessId is required' }
    $m = Main-Window $ProcessId
    if (-not $m) { throw 'main window not found' }
    $wp = [IntPtr](0x1800 * 0x10000 + $ButtonId) # MAKEWPARAM(id, THBN_CLICKED)
    $ok = [MmProbe]::PostMessage($m, 0x111, $wp, [IntPtr]::Zero)
    [ordered]@{ hwnd = $m.ToInt64(); buttonId = $ButtonId; posted = $ok } | ConvertTo-Json -Compress
  }
  'children' {
    if (-not $ProcessId) { throw '-ProcessId is required' }
    $m = Main-Window $ProcessId
    $kids = @([MmProbe]::Kids($m) | ForEach-Object { Describe $_ })
    [ordered]@{ main = $m.ToInt64(); children = $kids; overlay = @($kids | Where-Object { $_.class -eq 'MinMusicSnapHit' }) } | ConvertTo-Json -Compress -Depth 4
  }
  'hittest' {
    $h = [MmProbe]::At($X, $Y)
    $own = [MmProbe]::Pid($h)
    [ordered]@{
      hwnd = $h.ToInt64(); class = [MmProbe]::Cls($h); pid = $own; ownedByTarget = ($ProcessId -eq 0 -or $own -eq $ProcessId)
      # only ask windows of our own process: never send messages into other applications
      ncHitTest = $(if ($ProcessId -ne 0 -and $own -eq $ProcessId) { [MmProbe]::NcHitTest($h, $X, $Y) } else { $null })
    } | ConvertTo-Json -Compress
  }
  'thumbnail' {
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
    $found = @()
    foreach ($b in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)) {
      $n = $b.Current.Name
      if ($n -match '^(Previous|Play|Pause|Next|Bài trước|Phát|Tạm dừng|Bài tiếp)$') { $found += [ordered]@{ name = $n; enabled = $b.Current.IsEnabled } }
    }
    [ordered]@{ buttons = $found } | ConvertTo-Json -Compress -Depth 3
  }
}
