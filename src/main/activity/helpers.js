'use strict';
// The "helper" that tells which window is active: a small process, started only while you have a session,
// that writes one JSON line every ~1.5 s: { t, app, title, pid, perm? }.
// No native modules (nothing to compile for Electron): on Windows it is a PowerShell script
// (it comes with Windows), on macOS a JavaScript for Automation script run by osascript.

const path = require('path');

const INTERVAL_MS = 1500;

// ---------------------------------------------------------------- Windows
// Reads the foreground window with user32.dll functions and the app name from
// the executable's description (e.g. "Google Chrome"), falling back to the process name.
const WINDOWS_PS1 = `# Desktop Buddy: the active app (generated automatically on every start)
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class BuddyForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$names = @{}
while ($true) {
  $out = [ordered]@{ t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
  $h = [BuddyForeground]::GetForegroundWindow()
  if ($h -ne [IntPtr]::Zero) {
    $len = [BuddyForeground]::GetWindowTextLength($h)
    $sb = New-Object System.Text.StringBuilder ($len + 1)
    [void][BuddyForeground]::GetWindowText($h, $sb, $sb.Capacity)
    [uint32]$procId = 0
    [void][BuddyForeground]::GetWindowThreadProcessId($h, [ref]$procId)
    if (-not $names.ContainsKey($procId)) {
      if ($names.Count -gt 500) { $names.Clear() }
      $name = ''
      $p = Get-Process -Id $procId
      if ($p) {
        $name = $p.ProcessName
        try { $d = $p.MainModule.FileVersionInfo.FileDescription; if ($d) { $name = $d.Trim() } } catch {}
      }
      $names[$procId] = $name
    }
    $out.app = $names[$procId]
    $out.title = $sb.ToString()
    $out.pid = $procId
  }
  [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds ${INTERVAL_MS}
}
`;

// ---------------------------------------------------------------- macOS (NOT TESTED on a Mac)
// The app name comes from NSWorkspace (no permissions). The window title needs the
// "Accessibility" permission; without it, we send perm:false and an empty title.
// The loop uses NSRunLoop (not delay), so frontmostApplication updates.
const MAC_JXA = `
ObjC.import('AppKit');
ObjC.import('Foundation');
const se = Application('System Events');
function out(o) {
  const data = $(JSON.stringify(o) + '\\n').dataUsingEncoding($.NSUTF8StringEncoding);
  $.NSFileHandle.fileHandleWithStandardOutput.writeData(data);
}
while (true) {
  const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  const o = { t: Date.now() };
  if (app && !app.isNil()) {
    o.app = ObjC.unwrap(app.localizedName) || '';
    o.pid = app.processIdentifier;
    try {
      const procs = se.processes.whose({ unixId: o.pid });
      const wins = procs.length ? procs[0].windows() : [];
      o.title = wins.length ? (wins[0].name() || '') : '';
      o.perm = true;
    } catch (e) {
      o.title = '';
      o.perm = false;
    }
  }
  out(o);
  $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(${INTERVAL_MS / 1000}));
}
`;

/**
 * The command for the current platform, or null if it isn't supported.
 * @param {string} dataDir  where we can write the script (the app's data folder)
 */
function helperCommand(dataDir, platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    // Full path: a bare "powershell.exe" is searched in the current folder first (a planted copy would run).
    // The script goes in -EncodedCommand (UTF-16LE base64, ~5 KB): no file on disk to tamper with, no -ExecutionPolicy.
    return {
      command: path.win32.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WINDOWS_PS1, 'utf16le').toString('base64')],
    };
  }
  if (platform === 'darwin') {
    return { command: '/usr/bin/osascript', args: ['-l', 'JavaScript', '-e', MAC_JXA] };
  }
  return null;
}

module.exports = { helperCommand, INTERVAL_MS, WINDOWS_PS1, MAC_JXA };
