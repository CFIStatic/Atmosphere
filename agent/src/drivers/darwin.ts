import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasCommand, run, sleep } from './exec.js';
import { pngSize } from '../image.js';
import type { Capability, ClickOptions, ComputerDriver, MouseButton, ScreenSize } from './types.js';

/**
 * macOS driver.
 *
 * Three separate mechanisms, each chosen because it is the most dependable one
 * for its job on a stock Mac with nothing installed:
 *
 *   • Screen capture — `screencapture`, part of the OS.
 *   • Keyboard       — AppleScript `System Events`, part of the OS.
 *   • Mouse          — CoreGraphics events driven through JavaScript for
 *                      Automation. `osascript -l JavaScript` can reach the
 *                      ObjC bridge, which is the only no-install way to
 *                      synthesise a scroll wheel or a real drag on macOS.
 *                      If that bridge is unavailable we fall back to
 *                      `cliclick` (brew) and drop scroll from our advertised
 *                      capabilities, so Claude is told rather than left
 *                      guessing.
 *
 * Retina note: screenshots come back in *pixels* while CoreGraphics events are
 * addressed in *points*. Everything above this driver speaks screenshot pixels,
 * so `pointScale` converts on the way out. Getting this wrong is the classic
 * "every click lands in the top-left quadrant" bug.
 */

/** Numeric CGEvent constants — the ObjC bridge does not expose the enums. */
const EVENT = {
  leftDown: 1,
  leftUp: 2,
  rightDown: 3,
  rightUp: 4,
  mouseMoved: 5,
  leftDragged: 6,
  scrollWheel: 22,
  otherDown: 25,
  otherUp: 26,
} as const;

const CG_BUTTON: Record<MouseButton, number> = { left: 0, right: 1, middle: 2 };

/**
 * The JXA program. It takes one JSON argument describing a mouse operation and
 * performs it via CoreGraphics. Kept as a single script so the driver pays one
 * `osascript` launch per action instead of per event.
 */
const MOUSE_SCRIPT = `
ObjC.import('CoreGraphics');
ObjC.import('Foundation');

function post(ev) { $.CGEventPost(0, ev); }
function point(x, y) { return { x: x, y: y }; }

function mouseEvent(type, x, y, button, clickState) {
  var ev = $.CGEventCreateMouseEvent($(), type, point(x, y), button);
  if (clickState && clickState > 1) {
    // kCGMouseEventClickState = 1. Without it a "double click" is just two
    // unrelated clicks and no app treats it as a double click.
    $.CGEventSetIntegerValueField(ev, 1, clickState);
  }
  return ev;
}

function run(argv) {
  var cmd = JSON.parse(argv[0]);

  if (cmd.op === 'position') {
    var here = $.CGEventGetLocation($.CGEventCreate($()));
    return JSON.stringify({ x: here.x, y: here.y });
  }

  if (cmd.op === 'move') {
    post(mouseEvent(${EVENT.mouseMoved}, cmd.x, cmd.y, 0, 0));
    return 'ok';
  }

  if (cmd.op === 'click') {
    var down = cmd.button === 1 ? ${EVENT.rightDown} : cmd.button === 2 ? ${EVENT.otherDown} : ${EVENT.leftDown};
    var up = cmd.button === 1 ? ${EVENT.rightUp} : cmd.button === 2 ? ${EVENT.otherUp} : ${EVENT.leftUp};
    post(mouseEvent(${EVENT.mouseMoved}, cmd.x, cmd.y, cmd.button, 0));
    for (var i = 1; i <= cmd.count; i++) {
      post(mouseEvent(down, cmd.x, cmd.y, cmd.button, i));
      post(mouseEvent(up, cmd.x, cmd.y, cmd.button, i));
      delay(0.06);
    }
    return 'ok';
  }

  if (cmd.op === 'down' || cmd.op === 'up') {
    var isDown = cmd.op === 'down';
    var type = cmd.button === 1
      ? (isDown ? ${EVENT.rightDown} : ${EVENT.rightUp})
      : cmd.button === 2
        ? (isDown ? ${EVENT.otherDown} : ${EVENT.otherUp})
        : (isDown ? ${EVENT.leftDown} : ${EVENT.leftUp});
    var at = $.CGEventGetLocation($.CGEventCreate($()));
    post(mouseEvent(type, at.x, at.y, cmd.button, 1));
    return 'ok';
  }

  if (cmd.op === 'drag') {
    post(mouseEvent(${EVENT.mouseMoved}, cmd.fromX, cmd.fromY, 0, 0));
    delay(0.05);
    post(mouseEvent(${EVENT.leftDown}, cmd.fromX, cmd.fromY, 0, 1));
    delay(0.08);
    var steps = 14;
    for (var s = 1; s <= steps; s++) {
      var x = cmd.fromX + ((cmd.toX - cmd.fromX) * s) / steps;
      var y = cmd.fromY + ((cmd.toY - cmd.fromY) * s) / steps;
      post(mouseEvent(${EVENT.leftDragged}, x, y, 0, 1));
      delay(0.015);
    }
    delay(0.08);
    post(mouseEvent(${EVENT.leftUp}, cmd.toX, cmd.toY, 0, 1));
    return 'ok';
  }

  if (cmd.op === 'scroll') {
    if (cmd.x !== null) { post(mouseEvent(${EVENT.mouseMoved}, cmd.x, cmd.y, 0, 0)); }
    for (var n = 0; n < cmd.amount; n++) {
      // kCGScrollEventUnitLine = 1; two axes: vertical then horizontal.
      var ev = $.CGEventCreateScrollWheelEvent($(), 1, 2, cmd.dy, cmd.dx);
      post(ev);
      delay(0.03);
    }
    return 'ok';
  }

  return 'unknown-op';
}
`;

/** xdotool-flavoured key names → AppleScript virtual key codes. */
const KEY_CODES: Record<string, number> = {
  return: 36,
  enter: 36,
  kp_enter: 36,
  tab: 48,
  space: 49,
  backspace: 51,
  escape: 53,
  esc: 53,
  delete: 117,
  forwarddelete: 117,
  left: 123,
  right: 124,
  down: 125,
  up: 126,
  home: 115,
  end: 119,
  page_up: 116,
  pageup: 116,
  prior: 116,
  page_down: 121,
  pagedown: 121,
  next: 121,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111,
};

/** Modifier aliases → AppleScript modifier phrases. */
const MODIFIERS: Record<string, string> = {
  ctrl: 'control down',
  control: 'control down',
  alt: 'option down',
  option: 'option down',
  opt: 'option down',
  shift: 'shift down',
  cmd: 'command down',
  command: 'command down',
  super: 'command down',
  meta: 'command down',
  win: 'command down',
};

export class DarwinDriver implements ComputerDriver {
  readonly name = 'darwin';

  /** screenshot pixels × pointScale = CoreGraphics points. 0.5 on Retina. */
  private pointScale = 1;
  private mouseBackend: 'jxa' | 'cliclick' | null = null;

  async probe(): Promise<void> {
    if (!(await hasCommand('osascript'))) {
      throw new Error('osascript is missing — this does not look like macOS.');
    }

    // Prefer the ObjC bridge: it is the only option that can scroll and drag.
    try {
      await this.jxa({ op: 'position' });
      this.mouseBackend = 'jxa';
    } catch {
      this.mouseBackend = (await hasCommand('cliclick')) ? 'cliclick' : null;
    }

    if (!this.mouseBackend) {
      throw new Error(
        'Could not find a way to control the mouse.\n' +
          "  • Grant this terminal Accessibility access in System Settings → Privacy & Security → Accessibility, or\n" +
          '  • install cliclick:  brew install cliclick',
      );
    }

    // Establish the pixel↔point ratio once, from ground truth on both sides.
    const shot = await pngSize(await this.captureScreen());
    const points = await this.displayPointSize();
    this.pointScale = points.width > 0 ? points.width / shot.width : 1;
  }

  capabilities(): Capability[] {
    const base: Capability[] = [
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
      'wait',
      'zoom',
    ];
    // cliclick has no scroll-wheel command, so we do not claim one.
    if (this.mouseBackend === 'jxa') base.push('scroll');
    return base;
  }

  async screenSize(): Promise<ScreenSize> {
    return pngSize(await this.captureScreen());
  }

  async captureScreen(): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), 'atmosphere-shot-'));
    const path = join(dir, 'screen.png');
    try {
      // -x silences the shutter, -m captures the main display only.
      await run('screencapture', ['-x', '-m', '-t', 'png', path], { timeoutMs: 20_000 });
      return await readFile(path);
    } catch (err) {
      throw new Error(
        `Screen capture failed (${(err as Error).message}). Grant Screen Recording ` +
          'permission in System Settings → Privacy & Security → Screen Recording, ' +
          'then restart the agent.',
      );
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async cursorPosition(): Promise<{ x: number; y: number }> {
    if (this.mouseBackend === 'jxa') {
      const out = await this.jxa({ op: 'position' });
      const { x, y } = JSON.parse(out) as { x: number; y: number };
      return { x: Math.round(x / this.pointScale), y: Math.round(y / this.pointScale) };
    }
    const out = await run('cliclick', ['p']);
    const [x, y] = out.trim().split(',').map(Number);
    return { x: Math.round(x / this.pointScale), y: Math.round(y / this.pointScale) };
  }

  async mouseMove(x: number, y: number): Promise<void> {
    const p = this.toPoints(x, y);
    if (this.mouseBackend === 'jxa') {
      await this.jxa({ op: 'move', x: p.x, y: p.y });
    } else {
      await run('cliclick', [`m:${p.x},${p.y}`]);
    }
  }

  async click(
    button: MouseButton,
    x: number | undefined,
    y: number | undefined,
    options: ClickOptions = {},
  ): Promise<void> {
    const count = options.count ?? 1;
    const target = x !== undefined && y !== undefined ? this.toPoints(x, y) : await this.pointerPoints();
    const modifiers = splitModifiers(options.modifier);

    await this.withModifiers(modifiers, async () => {
      if (this.mouseBackend === 'jxa') {
        await this.jxa({ op: 'click', x: target.x, y: target.y, button: CG_BUTTON[button], count });
        return;
      }
      const verb = button === 'right' ? 'rc' : count >= 3 ? 'tc' : count === 2 ? 'dc' : 'c';
      await run('cliclick', [`${verb}:${target.x},${target.y}`]);
    });
  }

  async mouseDown(button: MouseButton): Promise<void> {
    if (this.mouseBackend === 'jxa') {
      await this.jxa({ op: 'down', button: CG_BUTTON[button] });
      return;
    }
    const at = await this.pointerPoints();
    await run('cliclick', [`dd:${at.x},${at.y}`]);
  }

  async mouseUp(button: MouseButton): Promise<void> {
    if (this.mouseBackend === 'jxa') {
      await this.jxa({ op: 'up', button: CG_BUTTON[button] });
      return;
    }
    const at = await this.pointerPoints();
    await run('cliclick', [`du:${at.x},${at.y}`]);
  }

  async drag(fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
    const from = this.toPoints(fromX, fromY);
    const to = this.toPoints(toX, toY);
    if (this.mouseBackend === 'jxa') {
      await this.jxa({ op: 'drag', fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });
      return;
    }
    await run('cliclick', [`dd:${from.x},${from.y}`, 'w:120', `du:${to.x},${to.y}`]);
  }

  async scroll(
    x: number | undefined,
    y: number | undefined,
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number,
    modifier?: string,
  ): Promise<void> {
    if (this.mouseBackend !== 'jxa') {
      throw new Error(
        'Scrolling is unavailable on this Mac. Grant Accessibility access to the ' +
          'terminal running the agent so it can post CoreGraphics events.',
      );
    }
    const at = x !== undefined && y !== undefined ? this.toPoints(x, y) : null;
    const dy = direction === 'up' ? 3 : direction === 'down' ? -3 : 0;
    const dx = direction === 'left' ? 3 : direction === 'right' ? -3 : 0;

    await this.withModifiers(splitModifiers(modifier), async () => {
      await this.jxa({
        op: 'scroll',
        x: at ? at.x : null,
        y: at ? at.y : null,
        dx,
        dy,
        amount: Math.max(1, amount),
      });
    });
  }

  async typeText(text: string): Promise<void> {
    // The text is passed as an argv element, never interpolated into the
    // script, so quotes and newlines in page content cannot break out.
    await run(
      'osascript',
      ['-e', 'on run argv', '-e', 'tell application "System Events" to keystroke (item 1 of argv)', '-e', 'end run', text],
      { timeoutMs: 60_000 },
    );
  }

  async pressKey(combo: string): Promise<void> {
    await run('osascript', ['-e', appleScriptForCombo(combo)]);
  }

  async holdKey(combo: string, seconds: number): Promise<void> {
    const modifiers = splitModifiers(combo);
    // System Events cannot hold an arbitrary key down across statements, but it
    // can hold modifiers around a delay — which is what `hold_key` is used for
    // in practice (Shift to extend a selection, Cmd to reveal a menu overlay).
    if (modifiers.every((m) => MODIFIERS[m.toLowerCase()])) {
      const phrase = modifiers.map((m) => MODIFIERS[m.toLowerCase()]).join(', ');
      await run(
        'osascript',
        [
          '-e',
          `tell application "System Events" to key down {${phrase.replace(/ down/g, '')}}`,
        ],
      ).catch(() => undefined);
      await sleep(Math.min(seconds, 30) * 1000);
      await run(
        'osascript',
        ['-e', `tell application "System Events" to key up {${phrase.replace(/ down/g, '')}}`],
      ).catch(() => undefined);
      return;
    }
    // Non-modifier keys: press once, then wait. Auto-repeat is not reproducible
    // through System Events, and pretending otherwise would be a silent lie.
    await this.pressKey(combo);
    await sleep(Math.min(seconds, 30) * 1000);
  }

  /* ---------------- internals ---------------- */

  private toPoints(x: number, y: number): { x: number; y: number } {
    return { x: Math.round(x * this.pointScale), y: Math.round(y * this.pointScale) };
  }

  private async pointerPoints(): Promise<{ x: number; y: number }> {
    const p = await this.cursorPosition();
    return this.toPoints(p.x, p.y);
  }

  private async jxa(command: Record<string, unknown>): Promise<string> {
    return (
      await run('osascript', ['-l', 'JavaScript', '-e', MOUSE_SCRIPT, JSON.stringify(command)], {
        timeoutMs: 30_000,
      })
    ).trim();
  }

  /** Hold AppleScript modifiers around an arbitrary mouse operation. */
  private async withModifiers(modifiers: string[], body: () => Promise<void>): Promise<void> {
    const phrases = modifiers
      .map((m) => MODIFIERS[m.toLowerCase()]?.replace(' down', ''))
      .filter(Boolean) as string[];

    if (phrases.length === 0) {
      await body();
      return;
    }
    const list = `{${phrases.join(', ')}}`;
    await run('osascript', ['-e', `tell application "System Events" to key down ${list}`]);
    try {
      await body();
    } finally {
      await run('osascript', ['-e', `tell application "System Events" to key up ${list}`]).catch(
        () => undefined,
      );
    }
  }

  /** Desktop size in points, used only to derive the Retina ratio. */
  private async displayPointSize(): Promise<{ width: number; height: number }> {
    try {
      const out = await run('osascript', [
        '-e',
        'tell application "Finder" to get bounds of window of desktop',
      ]);
      const nums = out.trim().split(',').map((n) => Number(n.trim()));
      if (nums.length === 4 && nums[2] > 0) return { width: nums[2], height: nums[3] };
    } catch {
      /* fall through */
    }
    return { width: 0, height: 0 }; // caller treats 0 as "assume 1:1"
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
 * Translate "cmd+shift+t" or "Return" into a System Events statement.
 * Printable single characters go through `keystroke`; everything else needs the
 * virtual key code, because `keystroke "Return"` would type the word.
 */
function appleScriptForCombo(combo: string): string {
  const parts = combo
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);

  const mods: string[] = [];
  let key = '';
  for (const part of parts) {
    const mod = MODIFIERS[part.toLowerCase()];
    if (mod) mods.push(mod);
    else key = part;
  }

  const using = mods.length ? ` using {${mods.join(', ')}}` : '';
  const code = KEY_CODES[key.toLowerCase().replace(/[\s_-]/g, '')] ?? KEY_CODES[key.toLowerCase()];

  if (code !== undefined) {
    return `tell application "System Events" to key code ${code}${using}`;
  }
  if (key.length === 1) {
    // Only a single printable character reaches here, so escaping quotes and
    // backslashes is sufficient to keep it inside the AppleScript string.
    const escaped = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `tell application "System Events" to keystroke "${escaped}"${using}`;
  }
  throw new Error(`Unrecognised key: "${combo}"`);
}
