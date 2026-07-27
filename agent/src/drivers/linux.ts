import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasCommand, run, runBinary, sleep } from './exec.js';
import { pngSize } from '../image.js';
import type { Capability, ClickOptions, ComputerDriver, MouseButton, ScreenSize } from './types.js';

/**
 * Linux / X11 driver.
 *
 * Input goes through `xdotool`, which is the same tool Anthropic's own
 * reference container uses — so the key names Claude has learned ("Return",
 * "ctrl+s", "Page_Down") map straight through without translation.
 *
 * Screen capture is deliberately pluggable: X11 desktops disagree about which
 * screenshot binary is installed, so we probe a short list once at startup and
 * remember the winner instead of failing on a missing ImageMagick.
 */

type CaptureMethod =
  | { kind: 'stdout'; file: string; args: string[] }
  | { kind: 'file'; file: string; args: (path: string) => string[] };

const CAPTURE_CANDIDATES: CaptureMethod[] = [
  // ImageMagick 6 and 7. Writing PNG to stdout avoids a temp file entirely.
  { kind: 'stdout', file: 'import', args: ['-silent', '-window', 'root', 'png:-'] },
  { kind: 'stdout', file: 'magick', args: ['import', '-silent', '-window', 'root', 'png:-'] },
  // Wayland compositors that implement wlr-screencopy (Sway, Hyprland).
  { kind: 'stdout', file: 'grim', args: ['-'] },
  { kind: 'file', file: 'scrot', args: (p) => ['-o', '-z', p] },
  { kind: 'file', file: 'gnome-screenshot', args: (p) => ['-f', p] },
  { kind: 'file', file: 'spectacle', args: (p) => ['-b', '-n', '-o', p] },
  { kind: 'file', file: 'maim', args: (p) => [p] },
];

const BUTTON_CODE: Record<MouseButton, string> = { left: '1', middle: '2', right: '3' };

/** xdotool models wheel movement as button presses 4–7. */
const SCROLL_BUTTON = { up: '4', down: '5', left: '6', right: '7' } as const;

export class LinuxDriver implements ComputerDriver {
  readonly name = 'linux/xdotool';

  private capture: CaptureMethod | null = null;

  async probe(): Promise<void> {
    if (!(await hasCommand('xdotool'))) {
      throw new Error(
        'xdotool is required to control this computer.\n' +
          '  Debian/Ubuntu:  sudo apt install xdotool\n' +
          '  Fedora:         sudo dnf install xdotool\n' +
          '  Arch:           sudo pacman -S xdotool',
      );
    }

    for (const candidate of CAPTURE_CANDIDATES) {
      if (await hasCommand(candidate.file)) {
        this.capture = candidate;
        break;
      }
    }
    if (!this.capture) {
      throw new Error(
        'No screenshot tool found. Install any one of these:\n' +
          '  Debian/Ubuntu:  sudo apt install imagemagick   (or scrot, gnome-screenshot)\n' +
          '  Fedora:         sudo dnf install ImageMagick\n' +
          '  Arch:           sudo pacman -S imagemagick',
      );
    }

    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
      throw new Error(
        'No display found (neither DISPLAY nor WAYLAND_DISPLAY is set). ' +
          'The agent has to run inside the desktop session it is controlling, ' +
          'not over a plain SSH connection.',
      );
    }

    if ((process.env.XDG_SESSION_TYPE ?? '').toLowerCase() === 'wayland') {
      // xdotool talks to X11. Under Wayland it reaches XWayland clients only,
      // so native-Wayland windows will silently ignore input. Warn loudly
      // rather than fail: many desktops still run the bulk of apps on XWayland.
      // eslint-disable-next-line no-console
      console.warn(
        '[agent] Wayland session detected. Mouse and keyboard control only reaches ' +
          'XWayland applications. Log in to an X11/Xorg session for full control.',
      );
    }
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
    try {
      const out = await run('xdotool', ['getdisplaygeometry']);
      const [w, h] = out.trim().split(/\s+/).map(Number);
      if (w > 0 && h > 0) return { width: w, height: h };
    } catch {
      /* fall through to measuring a real capture */
    }
    // Last resort, and the most trustworthy one: whatever the screenshot says.
    return pngSize(await this.captureScreen());
  }

  async captureScreen(): Promise<Buffer> {
    if (!this.capture) throw new Error('Driver not probed.');
    const method = this.capture;

    if (method.kind === 'stdout') {
      return runBinary(method.file, method.args, { timeoutMs: 20_000 });
    }

    const dir = await mkdtemp(join(tmpdir(), 'atmosphere-shot-'));
    const path = join(dir, 'screen.png');
    try {
      await run(method.file, method.args(path), { timeoutMs: 20_000 });
      return await readFile(path);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async cursorPosition(): Promise<{ x: number; y: number }> {
    const out = await run('xdotool', ['getmouselocation', '--shell']);
    const x = Number(/X=(\d+)/.exec(out)?.[1] ?? NaN);
    const y = Number(/Y=(\d+)/.exec(out)?.[1] ?? NaN);
    if (Number.isNaN(x) || Number.isNaN(y)) throw new Error('Could not read cursor position.');
    return { x, y };
  }

  async mouseMove(x: number, y: number): Promise<void> {
    await run('xdotool', ['mousemove', String(x), String(y)]);
  }

  async click(
    button: MouseButton,
    x: number | undefined,
    y: number | undefined,
    options: ClickOptions = {},
  ): Promise<void> {
    const args: string[] = [];
    if (x !== undefined && y !== undefined) args.push('mousemove', String(x), String(y));

    const modifiers = splitModifiers(options.modifier);
    for (const mod of modifiers) args.push('keydown', mod);
    args.push('click', '--repeat', String(options.count ?? 1), '--delay', '90', BUTTON_CODE[button]);
    for (const mod of [...modifiers].reverse()) args.push('keyup', mod);

    await run('xdotool', args);
  }

  async mouseDown(button: MouseButton): Promise<void> {
    await run('xdotool', ['mousedown', BUTTON_CODE[button]]);
  }

  async mouseUp(button: MouseButton): Promise<void> {
    await run('xdotool', ['mouseup', BUTTON_CODE[button]]);
  }

  async drag(fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
    // Move → press → move → release, with pauses. Dragging in one jump often
    // fails: many toolkits need to observe intermediate motion before they
    // recognise a drag gesture at all.
    await run('xdotool', ['mousemove', String(fromX), String(fromY)]);
    await run('xdotool', ['mousedown', '1']);
    await sleep(80);
    const steps = 12;
    for (let i = 1; i <= steps; i += 1) {
      const x = Math.round(fromX + ((toX - fromX) * i) / steps);
      const y = Math.round(fromY + ((toY - fromY) * i) / steps);
      await run('xdotool', ['mousemove', String(x), String(y)]);
      await sleep(15);
    }
    await sleep(80);
    await run('xdotool', ['mouseup', '1']);
  }

  async scroll(
    x: number | undefined,
    y: number | undefined,
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number,
    modifier?: string,
  ): Promise<void> {
    const args: string[] = [];
    if (x !== undefined && y !== undefined) args.push('mousemove', String(x), String(y));
    const modifiers = splitModifiers(modifier);
    for (const mod of modifiers) args.push('keydown', mod);
    args.push('click', '--repeat', String(Math.max(1, amount)), '--delay', '40', SCROLL_BUTTON[direction]);
    for (const mod of [...modifiers].reverse()) args.push('keyup', mod);
    await run('xdotool', args);
  }

  async typeText(text: string): Promise<void> {
    // `--` stops xdotool parsing text that begins with a dash as options.
    await run('xdotool', ['type', '--delay', '12', '--', text], { timeoutMs: 60_000 });
  }

  async pressKey(combo: string): Promise<void> {
    await run('xdotool', ['key', '--clearmodifiers', combo]);
  }

  async holdKey(combo: string, seconds: number): Promise<void> {
    await run('xdotool', ['keydown', combo]);
    try {
      await sleep(Math.min(seconds, 30) * 1000);
    } finally {
      await run('xdotool', ['keyup', combo]);
    }
  }
}

/** "ctrl+shift" → ["ctrl", "shift"]. */
function splitModifiers(modifier?: string): string[] {
  if (!modifier) return [];
  return modifier
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
}
