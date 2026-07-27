/**
 * The contract every platform driver implements.
 *
 * Coordinates crossing this boundary are always **real screen pixels**. The
 * scaling between what Claude sees and what the display actually measures is
 * handled one level up, in `computer.ts`, so drivers never have to think about
 * it.
 */

export interface ScreenSize {
  width: number;
  height: number;
}

export type MouseButton = 'left' | 'right' | 'middle';

/**
 * Action names a driver can perform. The agent advertises these to the server,
 * which passes them to the model, so Claude is told up front that (say) drag is
 * unavailable rather than discovering it through a failed tool call.
 */
export type Capability =
  | 'screenshot'
  | 'cursor_position'
  | 'mouse_move'
  | 'left_click'
  | 'right_click'
  | 'middle_click'
  | 'double_click'
  | 'triple_click'
  | 'left_mouse_down'
  | 'left_mouse_up'
  | 'left_click_drag'
  | 'type'
  | 'key'
  | 'hold_key'
  | 'scroll'
  | 'wait'
  | 'zoom';

export interface ClickOptions {
  /** 1 = single, 2 = double, 3 = triple. */
  count?: number;
  /** Modifier held for the duration of the click, e.g. "shift" or "ctrl+alt". */
  modifier?: string;
}

export interface ComputerDriver {
  /** Short identifier for logs, e.g. "linux/xdotool" or "darwin/cliclick". */
  readonly name: string;

  /**
   * Verify the host can actually be driven. Throws a message written for the
   * person reading the terminal — naming the missing tool and how to install
   * it — because a driver that half-works is worse than one that refuses.
   */
  probe(): Promise<void>;

  /** Which actions this host supports; see `Capability`. */
  capabilities(): Capability[];

  screenSize(): Promise<ScreenSize>;

  /** PNG of the primary display at its native resolution. */
  captureScreen(): Promise<Buffer>;

  cursorPosition(): Promise<{ x: number; y: number }>;

  mouseMove(x: number, y: number): Promise<void>;

  /** Click at `(x, y)`, or at the current cursor position when omitted. */
  click(
    button: MouseButton,
    x: number | undefined,
    y: number | undefined,
    options?: ClickOptions,
  ): Promise<void>;

  mouseDown(button: MouseButton): Promise<void>;
  mouseUp(button: MouseButton): Promise<void>;

  drag(fromX: number, fromY: number, toX: number, toY: number): Promise<void>;

  scroll(
    x: number | undefined,
    y: number | undefined,
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number,
    modifier?: string,
  ): Promise<void>;

  typeText(text: string): Promise<void>;

  /** A single key or combination in xdotool notation, e.g. "ctrl+s", "Return". */
  pressKey(combo: string): Promise<void>;

  holdKey(combo: string, seconds: number): Promise<void>;
}

/** Thrown when the host cannot perform an action the model asked for. */
export class UnsupportedActionError extends Error {
  constructor(action: string, reason: string) {
    super(`This computer cannot perform "${action}": ${reason}`);
    this.name = 'UnsupportedActionError';
  }
}
