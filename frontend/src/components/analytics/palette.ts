/**
 * Chart palette for the analytics dashboards.
 *
 * These eight hues are the categorical set stepped for a DARK surface, and the
 * order is the colourblind-safety mechanism, not a preference: adjacent pairs
 * were validated against the app's chart surface (#12121d) and clear the CVD
 * separation, chroma, lightness-band and 3:1 contrast gates. Assign slots in
 * order and never generate a ninth — a series past the eighth folds into
 * "Other" or gets its own small multiple.
 *
 * Colour follows the ENTITY, never its rank, so filtering a series out must not
 * repaint the survivors.
 */

export const SERIES = [
  '#3987e5', // 1 blue
  '#d95926', // 2 orange
  '#199e70', // 3 aqua
  '#c98500', // 4 yellow
  '#d55181', // 5 magenta
  '#008300', // 6 green
  '#9085e9', // 7 violet
  '#e66767', // 8 red
] as const;

/** Single-hue ramp for magnitude (retention grid). Light → dark, one hue. */
export const SEQUENTIAL = [
  '#0d366b',
  '#184f95',
  '#256abf',
  '#2a78d6',
  '#3987e5',
  '#5598e7',
  '#86b6ef',
] as const;

export const CHART = {
  /** The card surface these marks are drawn on. */
  surface: '#12121d',
  grid: '#2c2c2a',
  axis: '#383835',
  muted: '#898781',
  ink: '#ffffff',
  secondary: '#c3c2b7',
  /** Status hues — reserved for good/bad, never reused as a series colour. */
  good: '#0ca30c',
  critical: '#d03b3b',
} as const;

/** Semantic assignments, so a metric keeps its colour across every chart. */
export const METRIC_COLOR = {
  mrr: SERIES[0],
  revenue: SERIES[2],
  users: SERIES[0],
  seats: SERIES[3],
  orgs: SERIES[6],
  usage: SERIES[1],
} as const;
