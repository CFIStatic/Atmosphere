import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasCommand, run, sleep } from './exec.js';
import type { Capability, ClickOptions, ComputerDriver, MouseButton, ScreenSize } from './types.js';

/**
 * Windows driver.
 *
 * Everything runs through one PowerShell helper that is written to a temp file
 * at startup. It uses only what ships with Windows — `System.Drawing` for the
 * screenshot and the Win32 `SetCursorPos` / `mouse_event` / `keybd_event`
 * entry points for input — so there is nothing for an operator to install.
 *
 * The payload is passed as base64-encoded JSON. Windows command-line quoting
 * has enough corner cases (embedded quotes, carets, trailing backslashes) that
 * hand-escaping model-supplied text into a PowerShell command line would be a
 * real injection risk; base64 sidesteps the question entirely.
 */

const POWERSHELL_HELPER = String.raw`
param([Parameter(Mandatory=$true)][string]$Payload)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AtmosphereNative {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
"@

# Without this, a scaled display reports logical coordinates while the
# screenshot is captured in physical pixels, and every click is offset.
[void][AtmosphereNative]::SetProcessDPIAware()

$cmd = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json

$MOUSEEVENTF_MOVE       = 0x0001
$MOUSEEVENTF_LEFTDOWN   = 0x0002
$MOUSEEVENTF_LEFTUP     = 0x0004
$MOUSEEVENTF_RIGHTDOWN  = 0x0008
$MOUSEEVENTF_RIGHTUP    = 0x0010
$MOUSEEVENTF_MIDDLEDOWN = 0x0020
$MOUSEEVENTF_MIDDLEUP   = 0x0040
$MOUSEEVENTF_WHEEL      = 0x0800
$MOUSEEVENTF_HWHEEL     = 0x1000
$KEYEVENTF_KEYUP        = 0x0002

$MODIFIER_VK = @{ 'ctrl' = 0x11; 'control' = 0x11; 'shift' = 0x10; 'alt' = 0x12; 'option' = 0x12; 'win' = 0x5B; 'cmd' = 0x5B; 'super' = 0x5B; 'meta' = 0x5B }

function Down-Modifiers($mods) {
  foreach ($m in $mods) {
    $vk = $MODIFIER_VK[$m.ToLower()]
    if ($vk) { [AtmosphereNative]::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero) }
  }
}
function Up-Modifiers($mods) {
  for ($i = $mods.Count - 1; $i -ge 0; $i--) {
    $vk = $MODIFIER_VK[$mods[$i].ToLower()]
    if ($vk) { [AtmosphereNative]::keybd_event([byte]$vk, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero) }
  }
}

function Press-Button($button, $isDown) {
  if ($button -eq 1) { $flag = if ($isDown) { $MOUSEEVENTF_RIGHTDOWN } else { $MOUSEEVENTF_RIGHTUP } }
  elseif ($button -eq 2) { $flag = if ($isDown) { $MOUSEEVENTF_MIDDLEDOWN } else { $MOUSEEVENTF_MIDDLEUP } }
  else { $flag = if ($isDown) { $MOUSEEVENTF_LEFTDOWN } else { $MOUSEEVENTF_LEFTUP } }
  [AtmosphereNative]::mouse_event($flag, 0, 0, 0, [UIntPtr]::Zero)
}

switch ($cmd.op) {

  'size' {
    $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
    ConvertTo-Json @{ width = $b.Width; height = $b.Height }
  }

  'capture' {
    $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
    $bmp.Save($cmd.path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    'ok'
  }

  'position' {
    $p = New-Object AtmosphereNative+POINT
    [void][AtmosphereNative]::GetCursorPos([ref]$p)
    ConvertTo-Json @{ x = $p.X; y = $p.Y }
  }

  'move' {
    [void][AtmosphereNative]::SetCursorPos([int]$cmd.x, [int]$cmd.y)
    'ok'
  }

  'click' {
    if ($cmd.x -ne $null) { [void][AtmosphereNative]::SetCursorPos([int]$cmd.x, [int]$cmd.y); Start-Sleep -Milliseconds 40 }
    Down-Modifiers $cmd.modifiers
    try {
      for ($i = 0; $i -lt [int]$cmd.count; $i++) {
        Press-Button ([int]$cmd.button) $true
        Press-Button ([int]$cmd.button) $false
        Start-Sleep -Milliseconds 60
      }
    } finally { Up-Modifiers $cmd.modifiers }
    'ok'
  }

  'down' { Press-Button ([int]$cmd.button) $true; 'ok' }
  'up'   { Press-Button ([int]$cmd.button) $false; 'ok' }

  'drag' {
    [void][AtmosphereNative]::SetCursorPos([int]$cmd.fromX, [int]$cmd.fromY)
    Start-Sleep -Milliseconds 60
    Press-Button 0 $true
    Start-Sleep -Milliseconds 90
    $steps = 14
    for ($i = 1; $i -le $steps; $i++) {
      $x = [int]($cmd.fromX + (($cmd.toX - $cmd.fromX) * $i / $steps))
      $y = [int]($cmd.fromY + (($cmd.toY - $cmd.fromY) * $i / $steps))
      [void][AtmosphereNative]::SetCursorPos($x, $y)
      [AtmosphereNative]::mouse_event($MOUSEEVENTF_MOVE, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 16
    }
    Start-Sleep -Milliseconds 90
    Press-Button 0 $false
    'ok'
  }

  'scroll' {
    if ($cmd.x -ne $null) { [void][AtmosphereNative]::SetCursorPos([int]$cmd.x, [int]$cmd.y); Start-Sleep -Milliseconds 40 }
    Down-Modifiers $cmd.modifiers
    try {
      $flag = if ($cmd.axis -eq 'h') { $MOUSEEVENTF_HWHEEL } else { $MOUSEEVENTF_WHEEL }
      for ($i = 0; $i -lt [int]$cmd.amount; $i++) {
        [AtmosphereNative]::mouse_event($flag, 0, 0, [int]$cmd.delta, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 30
      }
    } finally { Up-Modifiers $cmd.modifiers }
    'ok'
  }

  'type' {
    [System.Windows.Forms.SendKeys]::SendWait($cmd.keys)
    'ok'
  }

  'holdkey' {
    Down-Modifiers $cmd.modifiers
    try { Start-Sleep -Milliseconds ([int]$cmd.ms) } finally { Up-Modifiers $cmd.modifiers }
    'ok'
  }

  default { throw "Unknown op: $($cmd.op)" }
}
`;

/** SendKeys names for keys that are not a single printable character. */
const SENDKEYS_NAMES: Record<string, string> = {
  return: '{ENTER}',
  enter: '{ENTER}',
  kpenter: '{ENTER}',
  tab: '{TAB}',
  space: ' ',
  backspace: '{BACKSPACE}',
  escape: '{ESC}',
  esc: '{ESC}',
  delete: '{DELETE}',
  insert: '{INSERT}',
  left: '{LEFT}',
  right: '{RIGHT}',
  up: '{UP}',
  down: '{DOWN}',
  home: '{HOME}',
  end: '{END}',
  pageup: '{PGUP}',
  prior: '{PGUP}',
  pagedown: '{PGDN}',
  next: '{PGDN}',
  f1: '{F1}',
  f2: '{F2}',
  f3: '{F3}',
  f4: '{F4}',
  f5: '{F5}',
  f6: '{F6}',
  f7: '{F7}',
  f8: '{F8}',
  f9: '{F9}',
  f10: '{F10}',
  f11: '{F11}',
  f12: '{F12}',
};

const SENDKEYS_MODIFIER: Record<string, string> = {
  ctrl: '^',
  control: '^',
  shift: '+',
  alt: '%',
  option: '%',
};

const BUTTON_INDEX: Record<MouseButton, number> = { left: 0, right: 1, middle: 2 };

export class Win32Driver implements ComputerDriver {
  readonly name = 'win32/powershell';

  private scriptPath: string | null = null;
  private scriptDir: string | null = null;

  async probe(): Promise<void> {
    const shell = (await hasCommand('powershell')) ? 'powershell' : null;
    if (!shell) {
      throw new Error('powershell.exe was not found on PATH; the agent cannot control this computer.');
    }
    this.scriptDir = await mkdtemp(join(tmpdir(), 'atmosphere-agent-'));
    this.scriptPath = join(this.scriptDir, 'input.ps1');
    await writeFile(this.scriptPath, POWERSHELL_HELPER, 'utf8');

    // Fail now, at startup, rather than on the first tool call: an operator
    // watching the terminal can act on it; a stalled run cannot.
    await this.ps({ op: 'size' });
  }

  capabilities(): Capability[] {
    return [
      'screenshot',
      'cursor_position',
      'mouse_move',
      'left_click',
      'right_click',
      'middle_click',
      'double_click',
      'triple_click',
      'left_mouse_down',
      'left_mouse_up',
      'left_click_drag',
      'type',
      'key',
      'hold_key',
      'scroll',
      'wait',
      'zoom',
    ];
  }

  async screenSize(): Promise<ScreenSize> {
    const out = await this.ps({ op: 'size' });
    return JSON.parse(out) as ScreenSize;
  }

  async captureScreen(): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), 'atmosphere-shot-'));
    const path = join(dir, 'screen.png');
    try {
      await this.ps({ op: 'capture', path });
      return await readFile(path);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async cursorPosition(): Promise<{ x: number; y: number }> {
    return JSON.parse(await this.ps({ op: 'position' })) as { x: number; y: number };
  }

  async mouseMove(x: number, y: number): Promise<void> {
    await this.ps({ op: 'move', x, y });
  }

  async click(
    button: MouseButton,
    x: number | undefined,
    y: number | undefined,
    options: ClickOptions = {},
  ): Promise<void> {
    await this.ps({
      op: 'click',
      button: BUTTON_INDEX[button],
      count: options.count ?? 1,
      x: x ?? null,
      y: y ?? null,
      modifiers: splitModifiers(options.modifier),
    });
  }

  async mouseDown(button: MouseButton): Promise<void> {
    await this.ps({ op: 'down', button: BUTTON_INDEX[button] });
  }

  async mouseUp(button: MouseButton): Promise<void> {
    await this.ps({ op: 'up', button: BUTTON_INDEX[button] });
  }

  async drag(fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
    await this.ps({ op: 'drag', fromX, fromY, toX, toY });
  }

  async scroll(
    x: number | undefined,
    y: number | undefined,
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number,
    modifier?: string,
  ): Promise<void> {
    const horizontal = direction === 'left' || direction === 'right';
    // One wheel notch is 120 units; up and right are positive.
    const delta = direction === 'up' || direction === 'right' ? 120 : -120;
    await this.ps({
      op: 'scroll',
      x: x ?? null,
      y: y ?? null,
      axis: horizontal ? 'h' : 'v',
      delta,
      amount: Math.max(1, amount),
      modifiers: splitModifiers(modifier),
    });
  }

  async typeText(text: string): Promise<void> {
    await this.ps({ op: 'type', keys: escapeSendKeys(text) }, 60_000);
  }

  async pressKey(combo: string): Promise<void> {
    await this.ps({ op: 'type', keys: sendKeysForCombo(combo) });
  }

  async holdKey(combo: string, seconds: number): Promise<void> {
    const parts = splitModifiers(combo);
    const ms = Math.min(seconds, 30) * 1000;
    if (parts.length > 0 && parts.every((p) => p.toLowerCase() in SENDKEYS_MODIFIER || /^(win|cmd|super|meta)$/i.test(p))) {
      await this.ps({ op: 'holdkey', modifiers: parts, ms }, ms + 15_000);
      return;
    }
    // SendKeys cannot hold a non-modifier key down; press once, then wait.
    await this.pressKey(combo);
    await sleep(ms);
  }

  private async ps(command: Record<string, unknown>, timeoutMs = 30_000): Promise<string> {
    if (!this.scriptPath) throw new Error('Driver not probed.');
    const payload = Buffer.from(JSON.stringify(command), 'utf8').toString('base64');
    const out = await run(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath, '-Payload', payload],
      { timeoutMs },
    );
    return out.trim();
  }

  /** Best-effort cleanup of the temp helper script. */
  async dispose(): Promise<void> {
    if (this.scriptDir) await rm(this.scriptDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function splitModifiers(modifier?: string): string[] {
  if (!modifier) return [];
  return modifier
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * SendKeys treats `+ ^ % ~ ( ) { } [ ]` as syntax. Literal text from a web page
 * routinely contains them, so every one must be braced before sending.
 */
function escapeSendKeys(text: string): string {
  return text
    .replace(/([+^%~(){}[\]])/g, '{$1}')
    .replace(/\r\n/g, '{ENTER}')
    .replace(/\n/g, '{ENTER}')
    .replace(/\t/g, '{TAB}');
}

function sendKeysForCombo(combo: string): string {
  const parts = combo
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);

  let prefix = '';
  let key = '';
  for (const part of parts) {
    const mod = SENDKEYS_MODIFIER[part.toLowerCase()];
    if (mod) prefix += mod;
    else key = part;
  }

  const named = SENDKEYS_NAMES[key.toLowerCase().replace(/[\s_-]/g, '')];
  if (named) return prefix + named;
  if (key.length === 1) return prefix + escapeSendKeys(key);
  throw new Error(`Unrecognised key: "${combo}"`);
}
