/**
 * Wire protocol between the Atmosphere backend and the computer-use agent.
 *
 * ⚠️ This file is duplicated verbatim at `agent/src/protocol.ts`. The agent
 * ships and versions independently — an agent installed on a technician's
 * laptop months ago must still talk to today's server — so the protocol is
 * deliberately small, additive-only, and kept in sync by hand. If you change a
 * message here, change it there too.
 */

/** Bumped only for breaking protocol changes; the server refuses mismatches. */
export const PROTOCOL_VERSION = 1;

/* ------------------------------------------------------------------ *
 * Actions — mirrors the input schema of Anthropic's `computer_*` tool. *
 * ------------------------------------------------------------------ */

/** `[x, y]` in the *scaled* coordinate space the model sees. */
export type Point = [number, number];

/** `[x1, y1, x2, y2]` — top-left and bottom-right of a region to magnify. */
export type Region = [number, number, number, number];

export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

export interface ComputerAction {
  action:
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
  /** Target for pointer actions. */
  coordinate?: Point;
  /** Drag origin (`left_click_drag`). */
  start_coordinate?: Point;
  /**
   * Overloaded exactly as the tool schema overloads it: the literal text for
   * `type`, the key combination for `key`/`hold_key`, and the modifier to hold
   * during a click or scroll.
   */
  text?: string;
  scroll_direction?: ScrollDirection;
  scroll_amount?: number;
  /** Seconds — `wait` and `hold_key`. */
  duration?: number;
  /** Region to magnify (`zoom`). */
  region?: Region;
}

/* ---------------------------- *
 * Action results                *
 * ---------------------------- */

export type ActionOutput =
  /** A PNG the model should see (screenshot / zoom). */
  | { kind: 'image'; mediaType: 'image/png'; data: string }
  /** A plain-text answer (cursor_position). */
  | { kind: 'text'; text: string }
  /** The action succeeded and produced nothing to show. */
  | { kind: 'ok' };

/* ---------------------------- *
 * Agent → server                *
 * ---------------------------- */

export interface HelloMessage {
  t: 'hello';
  protocol: number;
  /** Human label shown in the console, e.g. "Front-desk iMac". */
  name: string;
  platform: NodeJS.Platform;
  agentVersion: string;
  /** True, physical screen size in pixels — before any downscale. */
  screen: { width: number; height: number };
  /** Action names this host can actually perform (see driver capabilities). */
  capabilities: string[];
}

export interface ResultMessage {
  t: 'result';
  id: string;
  ok: boolean;
  output?: ActionOutput;
  /** Present when `ok` is false — surfaced to the model as an error result. */
  error?: string;
}

export type AgentMessage = HelloMessage | ResultMessage | { t: 'pong' };

/* ---------------------------- *
 * Server → agent                *
 * ---------------------------- */

/**
 * Tells the agent what resolution to send screenshots at. The server derives it
 * from the model's image limits, because the model must receive an image it
 * will not silently downscale — otherwise the coordinates it returns are in a
 * scale the agent cannot map back to the real screen.
 */
export interface ConfigureMessage {
  t: 'configure';
  capture: {
    /** Downscaled dimensions the model sees. */
    width: number;
    height: number;
    /** scaled = real × scale. The agent divides by this to click for real. */
    scale: number;
  };
}

export interface InvokeMessage {
  t: 'invoke';
  id: string;
  action: ComputerAction;
  /**
   * `model` — Claude asked for this and is waiting on the result.
   * `preview` — the console wants a fresh frame for the live view. Preview
   * invocations never mutate the machine; the server only sends `screenshot`.
   */
  purpose: 'model' | 'preview';
}

export type ServerMessage = ConfigureMessage | InvokeMessage | { t: 'ping' };
