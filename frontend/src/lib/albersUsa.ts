/**
 * Albers USA, as a function.
 *
 * The state outlines on the territory map are projected once, offline, by
 * d3-geo (see scripts/build-usa-map.mjs). But a ZIP centroid arrives at
 * runtime, and it has to land in the same place on the same picture — so the
 * projection itself has to exist in the browser too.
 *
 * Rather than ship d3-geo for one function, this is that one function. It is
 * the same maths, and it is not trusted to be: the generator recomputes a few
 * hundred points through both this and the real d3-geo and refuses to write
 * the map if they disagree. A projection that is subtly wrong does not throw —
 * it puts Austin in Oklahoma — so the check is the only thing that makes
 * hand-rolling this reasonable.
 *
 * Albers USA is three projections wearing a trenchcoat: a conic for the lower
 * 48, a second for Alaska at just over a third of the scale, a third for
 * Hawaii, each clipped to its own box so the insets do not bleed. Anywhere
 * outside all three — Puerto Rico, Guam, a bad geocode in the Atlantic —
 * returns null rather than a plausible-looking wrong answer.
 */

const RADIANS = Math.PI / 180;
const EPSILON = 1e-6;

/** A conic equal-area projection between two standard parallels. */
function conicEqualArea(parallel0: number, parallel1: number) {
  const sy0 = Math.sin(parallel0 * RADIANS);
  const n = (sy0 + Math.sin(parallel1 * RADIANS)) / 2;
  const c = 1 + sy0 * (2 * n - sy0);
  const r0 = Math.sqrt(c) / n;

  return (lambda: number, phi: number): [number, number] => {
    const r = Math.sqrt(c - 2 * n * Math.sin(phi)) / n;
    const x = lambda * n;
    return [r * Math.sin(x), r0 - r * Math.cos(x)];
  };
}

interface Piece {
  raw: (lambda: number, phi: number) => [number, number];
  /** Degrees added to longitude before projecting — what centres the cone. */
  rotate: number;
  scale: number;
  /** Where the projected origin lands, precomputed from d3's `center`. */
  dx: number;
  dy: number;
  /** Screen-space box this piece owns. Outside it, the point is not ours. */
  clip: [number, number, number, number];
}

function piece(spec: {
  parallels: [number, number];
  rotate: number;
  center: [number, number];
  scale: number;
  translate: [number, number];
  clip: [number, number, number, number];
}): Piece {
  const raw = conicEqualArea(spec.parallels[0], spec.parallels[1]);
  // d3 applies `center` in already-rotated coordinates, so it is projected
  // directly rather than run through the rotation first.
  const [cx, cy] = raw(spec.center[0] * RADIANS, spec.center[1] * RADIANS);
  return {
    raw,
    rotate: spec.rotate,
    scale: spec.scale,
    dx: spec.translate[0] - spec.scale * cx,
    dy: spec.translate[1] + spec.scale * cy,
    clip: spec.clip,
  };
}

function project(p: Piece, lon: number, lat: number): [number, number] {
  let lambda = (lon + p.rotate) * RADIANS;
  // Wrap, or a point east of the antimeridian after rotation comes out on the
  // wrong side of the map. Alaska's rotation of 154° pushes the Aleutians
  // across it, so this is load-bearing rather than defensive.
  if (lambda > Math.PI) lambda -= 2 * Math.PI;
  else if (lambda < -Math.PI) lambda += 2 * Math.PI;

  const [px, py] = p.raw(lambda, lat * RADIANS);
  return [p.dx + p.scale * px, p.dy - p.scale * py];
}

function inside(p: Piece, x: number, y: number): boolean {
  return x >= p.clip[0] && x <= p.clip[2] && y >= p.clip[1] && y <= p.clip[3];
}

/**
 * Build the projection for a given scale and translate.
 *
 * The map ships at scale 1300 / translate [487.5, 305], which is the standard
 * fit for a 975×610 viewBox and the one the outlines were generated with.
 */
export function albersUsa(scale = 1300, translate: [number, number] = [487.5, 305]) {
  const k = scale;
  const [x, y] = translate;

  const lower48 = piece({
    parallels: [29.5, 45.5],
    rotate: 96,
    center: [-0.6, 38.7],
    scale: k,
    translate: [x, y],
    clip: [x - 0.455 * k, y - 0.238 * k, x + 0.455 * k, y + 0.238 * k],
  });

  const alaska = piece({
    parallels: [55, 65],
    rotate: 154,
    center: [-2, 58.5],
    scale: k * 0.35,
    translate: [x - 0.307 * k, y + 0.201 * k],
    clip: [
      x - 0.425 * k + EPSILON,
      y + 0.12 * k + EPSILON,
      x - 0.214 * k - EPSILON,
      y + 0.234 * k - EPSILON,
    ],
  });

  const hawaii = piece({
    parallels: [8, 18],
    rotate: 157,
    center: [-3, 19.9],
    scale: k,
    translate: [x - 0.205 * k, y + 0.212 * k],
    clip: [
      x - 0.214 * k + EPSILON,
      y + 0.166 * k + EPSILON,
      x - 0.115 * k - EPSILON,
      y + 0.234 * k - EPSILON,
    ],
  });

  /** Screen position for a longitude/latitude, or null if it is off the map. */
  return function projectPoint(lon: number, lat: number): [number, number] | null {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    for (const p of [lower48, alaska, hawaii]) {
      const at = project(p, lon, lat);
      if (inside(p, at[0], at[1])) return at;
    }
    return null;
  };
}

/** The shared instance, matching the generated outlines. */
export const projectUsa = albersUsa();
