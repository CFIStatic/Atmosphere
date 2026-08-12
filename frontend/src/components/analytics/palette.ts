/**
 * Chart palette for Business Portal / growth analytics — tuned for Atmosphere’s
 * light paper surfaces (paper-0 / glass-card), not the old dark analytics shell.
 *
 * Colour follows the ENTITY, never its rank. Brand orange leads recurring
 * revenue; cash collected uses a separate hue so MRR and banked revenue never
 * look like the same claim.
 */

export const SERIES = [
  '#d2500a', // 1 brand orange (chart step on light paper)
  '#2563b8', // 2 blue
  '#0f8a5f', // 3 aqua / collected
  '#b45309', // 4 amber seats
  '#c0265a', // 5 magenta
  '#15803d', // 6 green
  '#6d5bd0', // 7 violet orgs
  '#c24141', // 8 red
] as const;

/**
 * Single-hue ramp for magnitude (retention grid), light→dark in the brand hue
 * so filled cells read on white paper.
 */
export const SEQUENTIAL = [
  '#fde8d8',
  '#f7c7a4',
  '#ef9d68',
  '#e07032',
  '#c24e0c',
  '#8f3606',
] as const;

/** Indices into SEQUENTIAL that need light text on top. */
export const SEQUENTIAL_DARK_TEXT_FROM = 4;

export const CHART = {
  /** Card surface these marks are drawn on (paper-0). */
  surface: '#ffffff',
  grid: '#ebe6dc',
  axis: '#d8d2c5',
  muted: '#807c74',
  ink: '#1c1917',
  secondary: '#57534e',
  /** Ink for cells filled with a dark sequential step. */
  onLight: '#ffffff',
  onDark: '#1c1917',
  /** Status hues — reserved for good/bad, never reused as a series colour. */
  good: '#15803d',
  critical: '#b91c1c',
} as const;

/** The true brand orange, for UI chrome rather than data marks. */
export const BRAND = '#d2500a';

export const METRIC_COLOR = {
  mrr: SERIES[0],
  revenue: SERIES[2],
  users: SERIES[1],
  seats: SERIES[3],
  orgs: SERIES[6],
  usage: SERIES[0],
} as const;
