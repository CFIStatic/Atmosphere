import { sleep } from './drivers/exec.js';
import { cropPng, pngSize, resizePng, scaleFactorFor } from './image.js';
import type { ComputerDriver } from './drivers/index.js';
import { UnsupportedActionError } from './drivers/types.js';
import type { ActionOutput, ComputerAction, Point } from './protocol.js';

/**
 * Turns a `computer` tool call into real input on this machine.
 *
 * The one job that matters here is the coordinate contract. Claude only ever
 * sees a downscaled screenshot and answers in that image's coordinate space;
 * the mouse lives in the real display's. Every incoming coordinate is divided
 * by `scale` on the way to the driver, and every screenshot is resized by
 * `scale` on the way out. Those two are the same number by construction, which
 * is why they are set together and never inferred separately.
 */

export interface CaptureSettings {
  /** Size of the image the model is shown. */
  width: number;
  height: number;
  /** scaled = real × scale. */
  scale: number;
}

/**
 * How long to let the screen settle after an action that changes it. Claude
 * almost always follows an action with a screenshot; without this pause the
 * screenshot shows the state *before* the click landed and the model concludes
 * — reasonably, and wrongly — that nothing happened.
 */
const SETTLE_MS = 350;

export class ComputerController {
  private capture: CaptureSettings | null = null;

  constructor(
    private readonly driver: ComputerDriver,
    /** Model image limits; the server sends these at connect time. */
    private limits: { maxLongEdge: number; maxPixels: number } = {
      maxLongEdge: 1568,
      maxPixels: 1_150_000,
    },
  ) {}

  /** Real, physical screen dimensions. */
  async realScreenSize(): Promise<{ width: number; height: number }> {
    return this.driver.screenSize();
  }

  capabilities(): string[] {
    return this.driver.capabilities();
  }

  configure(capture: CaptureSettings, limits?: { maxLongEdge: number; maxPixels: number }): void {
    this.capture = capture;
    if (limits) this.limits = limits;
  }

  /** Derive capture settings locally — used before the server has spoken. */
  async selfConfigure(): Promise<CaptureSettings> {
    const { width, height } = await this.realScreenSize();
    const scale = scaleFactorFor(width, height, this.limits.maxLongEdge, this.limits.maxPixels);
    const settings: CaptureSettings = {
      width: Math.max(1, Math.floor(width * scale)),
      height: Math.max(1, Math.floor(height * scale)),
      scale,
    };
    this.capture = settings;
    return settings;
  }

  async execute(action: ComputerAction): Promise<ActionOutput> {
    const settings = this.capture ?? (await this.selfConfigure());
    const supported = new Set(this.driver.capabilities());
    if (!supported.has(action.action as never)) {
      throw new UnsupportedActionError(action.action, 'this computer does not support it');
    }

    switch (action.action) {
      case 'screenshot':
        return this.screenshot(settings);

      case 'zoom': {
        if (!action.region) throw new Error('zoom requires a "region".');
        return this.zoom(action.region, settings);
      }

      case 'cursor_position': {
        const { x, y } = await this.driver.cursorPosition();
        const scaled = this.toModel(x, y, settings);
        return { kind: 'text', text: `X=${scaled[0]},Y=${scaled[1]}` };
      }

      case 'wait': {
        // Bounded: an unbounded wait would hold the whole run hostage.
        await sleep(Math.min(Math.max(action.duration ?? 1, 0), 30) * 1000);
        return { kind: 'ok' };
      }

      case 'mouse_move': {
        const [x, y] = this.toReal(requireCoordinate(action, 'mouse_move'), settings);
        await this.driver.mouseMove(x, y);
        return { kind: 'ok' };
      }

      case 'left_click':
      case 'right_click':
      case 'middle_click':
      case 'double_click':
      case 'triple_click': {
        const button =
          action.action === 'right_click' ? 'right' : action.action === 'middle_click' ? 'middle' : 'left';
        const count = action.action === 'double_click' ? 2 : action.action === 'triple_click' ? 3 : 1;
        const at = action.coordinate ? this.toReal(action.coordinate, settings) : [undefined, undefined];
        await this.driver.click(button, at[0], at[1], { count, modifier: action.text });
        await sleep(SETTLE_MS);
        return { kind: 'ok' };
      }

      case 'left_mouse_down':
        await this.driver.mouseDown('left');
        return { kind: 'ok' };

      case 'left_mouse_up':
        await this.driver.mouseUp('left');
        await sleep(SETTLE_MS);
        return { kind: 'ok' };

      case 'left_click_drag': {
        const to = this.toReal(requireCoordinate(action, 'left_click_drag'), settings);
        const from = action.start_coordinate
          ? this.toReal(action.start_coordinate, settings)
          : await (async () => {
              const p = await this.driver.cursorPosition();
              return [p.x, p.y] as [number, number];
            })();
        await this.driver.drag(from[0], from[1], to[0], to[1]);
        await sleep(SETTLE_MS);
        return { kind: 'ok' };
      }

      case 'scroll': {
        const at = action.coordinate ? this.toReal(action.coordinate, settings) : [undefined, undefined];
        await this.driver.scroll(
          at[0],
          at[1],
          action.scroll_direction ?? 'down',
          action.scroll_amount ?? 3,
          action.text,
        );
        await sleep(SETTLE_MS);
        return { kind: 'ok' };
      }

      case 'type': {
        if (typeof action.text !== 'string') throw new Error('type requires "text".');
        await this.driver.typeText(action.text);
        await sleep(SETTLE_MS);
        return { kind: 'ok' };
      }

      case 'key': {
        if (!action.text) throw new Error('key requires "text".');
        await this.driver.pressKey(action.text);
        await sleep(SETTLE_MS);
        return { kind: 'ok' };
      }

      case 'hold_key': {
        if (!action.text) throw new Error('hold_key requires "text".');
        await this.driver.holdKey(action.text, action.duration ?? 1);
        await sleep(SETTLE_MS);
        return { kind: 'ok' };
      }

      default: {
        const never: never = action.action;
        throw new Error(`Unsupported action: ${String(never)}`);
      }
    }
  }

  /* ---------------- internals ---------------- */

  private async screenshot(settings: CaptureSettings): Promise<ActionOutput> {
    const native = await this.driver.captureScreen();
    const size = await pngSize(native);

    // The display can be resized mid-run (a monitor unplugged, a VM window
    // dragged). Re-derive the scale from the image we actually have rather
    // than trusting a stale factor and mis-mapping every later click.
    if (size.width !== Math.round(settings.width / settings.scale)) {
      const scale = scaleFactorFor(
        size.width,
        size.height,
        this.limits.maxLongEdge,
        this.limits.maxPixels,
      );
      this.capture = {
        width: Math.max(1, Math.floor(size.width * scale)),
        height: Math.max(1, Math.floor(size.height * scale)),
        scale,
      };
      settings = this.capture;
    }

    const resized =
      settings.scale >= 1 ? native : await resizePng(native, settings.width, settings.height);
    return { kind: 'image', mediaType: 'image/png', data: resized.toString('base64') };
  }

  private async zoom(region: [number, number, number, number], settings: CaptureSettings): Promise<ActionOutput> {
    const native = await this.driver.captureScreen();
    const [x1, y1, x2, y2] = region;
    const left = Math.round(Math.min(x1, x2) / settings.scale);
    const top = Math.round(Math.min(y1, y2) / settings.scale);
    const width = Math.round(Math.abs(x2 - x1) / settings.scale);
    const height = Math.round(Math.abs(y2 - y1) / settings.scale);

    const cropped = await cropPng(
      native,
      left,
      top,
      Math.max(1, width),
      Math.max(1, height),
      this.limits.maxLongEdge,
      this.limits.maxPixels,
    );
    return { kind: 'image', mediaType: 'image/png', data: cropped.toString('base64') };
  }

  /** Model coordinates → real screen pixels. */
  private toReal(point: Point, settings: CaptureSettings): [number, number] {
    return [Math.round(point[0] / settings.scale), Math.round(point[1] / settings.scale)];
  }

  /** Real screen pixels → model coordinates. */
  private toModel(x: number, y: number, settings: CaptureSettings): [number, number] {
    return [Math.round(x * settings.scale), Math.round(y * settings.scale)];
  }
}

function requireCoordinate(action: ComputerAction, name: string): Point {
  if (!action.coordinate) throw new Error(`${name} requires a "coordinate".`);
  return action.coordinate;
}
