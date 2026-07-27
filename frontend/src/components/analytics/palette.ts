/**
 * Chart palette for the analytics dashboards.
 *
 * Stepped for the Atmosphere dark surface (#1a1a1a — `ink-800`, the same warm
 * near-black as the brand canvas) and validated as a set: adjacent pairs clear
 * the colourblind-separation, chroma, lightness-band and 3:1 contrast gates.
 * Assign slots in order and never generate a ninth — a series past the eighth
 * folds into "Other" or gets its own small multiple.
 *
 * Colour follows the ENTITY, never its rank, so filtering a series out must not
 * repaint the survivors.
 *
 * NOTE ON THE BRAND ORANGE: the brand colour itself (#f26522) sits just above
 * the lightness band for a data mark on this surface, so charts use the nearest
 * passing step of the same hue (#ec6220) while UI chrome keeps the true brand
 * orange. They are a shade apart and read as the same colour; the distinction
 * only matters to the validator, which is the point of having one. Re-run
 * `validate_palette.js` against #1a1a1a before changing any value here.
 */

export const SERIES = [
  '#ec6220', // 1 brand orange (chart step)
  '#3987e5', // 2 blue
  '#199e70', // 3 aqua
  '#c98500', // 4 yellow
  '#d55181', // 5 magenta
  '#008300', // 6 green
  '#9085e9', // 7 violet
  '#e66767', // 8 red
] as const;

/**
 * Single-hue ramp for magnitude (the retention grid), light→dark in the brand
 * hue. The dark end stops at #7a3a12 because anything darker drops below 2:1
 * against the surface and stops reading as a filled cell at all.
 */
export const SEQUENTIAL = [
  '#7a3a12',
  '#9c4a17',
  '#be591b',
  '#dc6d24',
  '#f0904f',
  '#fbb68b',
] as const;

/**
 * The two lightest sequential steps need dark text on top; white on #fbb68b is
 * unreadable. Indices into SEQUENTIAL.
 */
export const SEQUENTIAL_DARK_TEXT_FROM = 4;

export const CHART = {
  /** The card surface these marks are drawn on (ink-800). */
  surface: '#1a1a1a',
  grid: '#2c2c2a',
  axis: '#383835',
  muted: '#898781',
  ink: '#f5f4f1',
  secondary: '#c3c2b7',
  /** Ink for cells filled with a light sequential step. */
  onLight: '#1a1a1a',
  /** Status hues — reserved for good/bad, never reused as a series colour. */
  good: '#0ca30c',
  critical: '#d03b3b',
} as const;

/** The true brand orange, for UI chrome rather than data marks. */
export const BRAND = '#f26522';

/**
 * Semantic assignments, so a metric keeps its colour across every chart.
 * Recurring revenue leads in the brand hue; cash collected is deliberately a
 * different colour, because "MRR" and "money in the bank" are different claims
 * and should never look like the same series.
 */
export const METRIC_COLOR = {
  mrr: SERIES[0],
  revenue: SERIES[2],
  users: SERIES[1],
  seats: SERIES[3],
  orgs: SERIES[6],
  /** Time spent in the product — the engagement measure, in the brand hue. */
  usage: SERIES[0],
} as const;
