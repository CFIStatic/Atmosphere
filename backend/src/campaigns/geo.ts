/**
 * Is this customer inside the storm?
 *
 * Territory matching by county name was the first version and it is coarse in
 * a way that costs money in both directions: Williamson County is 1,100 square
 * miles, so "the alert covers your territory" can mean the hail is forty miles
 * from every building you sell to — and a customer just over the county line
 * from a warned area is missed entirely.
 *
 * Alerts carry actual geometry. A polygon and a point settles it exactly, and
 * that is what turns "there is a storm in your county" into "seven of your
 * accounts are inside the warned area", which is a different sentence for a
 * salesperson to act on.
 *
 * Name matching stays as the fallback, because not every alert has a polygon —
 * watches in particular are issued over whole zones — and an alert with no
 * geometry must still reach the right people.
 */

export interface Point {
  lat: number;
  lon: number;
}

/** GeoJSON geometry as the weather service supplies it. */
export interface Geometry {
  type?: string;
  coordinates?: unknown;
}

/**
 * Ray casting: count how many times a ray from the point crosses the edges of
 * the ring. Odd means inside.
 *
 * Coordinates arrive GeoJSON-ordered — [longitude, latitude] — which is the
 * reverse of how everybody says it out loud, and getting it backwards puts
 * Texas in the Indian Ocean without erroring.
 */
function pointInRing(point: Point, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (typeof xi !== 'number' || typeof yi !== 'number') continue;
    if (typeof xj !== 'number' || typeof yj !== 'number') continue;

    const crosses = yi > point.lat !== yj > point.lat;
    if (!crosses) continue;
    // Where the edge sits at this latitude. Left of the point means the ray
    // going right crosses it.
    const at = ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (point.lon < at) inside = !inside;
  }
  return inside;
}

/** One polygon: the outer ring, minus any holes. */
function pointInPolygon(point: Point, rings: number[][][]): boolean {
  if (!rings.length) return false;
  if (!pointInRing(point, rings[0])) return false;
  // A hole is a real thing in these shapes — an alert can exclude a
  // metropolitan area from a rural zone — and ignoring them would put people
  // inside a storm they are demonstrably outside of.
  for (let i = 1; i < rings.length; i += 1) {
    if (pointInRing(point, rings[i])) return false;
  }
  return true;
}

/**
 * Does this geometry contain this point?
 *
 * Returns false for anything it cannot interpret rather than throwing. A
 * malformed shape is a reason to fall back to name matching, not a reason to
 * fail a page — and never a reason to assume "inside".
 */
export function geometryContains(geometry: Geometry | null | undefined, point: Point): boolean {
  if (!geometry?.coordinates) return false;
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return false;

  try {
    if (geometry.type === 'Polygon') {
      return pointInPolygon(point, geometry.coordinates as number[][][]);
    }
    if (geometry.type === 'MultiPolygon') {
      return (geometry.coordinates as number[][][][]).some((rings) => pointInPolygon(point, rings));
    }
  } catch {
    return false;
  }
  return false;
}

/** Rough bounding box, for cheaply rejecting points nowhere near a shape. */
export function boundsOf(geometry: Geometry | null | undefined): {
  south: number;
  west: number;
  north: number;
  east: number;
} | null {
  if (!geometry?.coordinates) return null;

  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;

  const walk = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      const [lon, lat] = value as number[];
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      return;
    }
    for (const child of value) walk(child);
  };

  walk(geometry.coordinates);
  if (!Number.isFinite(south) || !Number.isFinite(west)) return null;
  return { south, west, north, east };
}

/**
 * Great-circle distance in miles.
 *
 * Used for "how far is this storm from my accounts", which is the question
 * behind deciding whether to call today or wait. Haversine is plenty at these
 * distances — the error against a proper geodesic is metres over a county.
 */
export function milesBetween(a: Point, b: Point): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Which of these places are inside the alert?
 *
 * Geometry first, and only if there is none does it fall back to matching the
 * county names the issuing office wrote. Reporting which method answered is
 * not a detail: "seven accounts inside the warned polygon" and "your county is
 * mentioned" are different claims, and a salesperson deciding who to call
 * deserves to know which one they are looking at.
 */
export function placesInAlert<T extends { lat?: number | null; lon?: number | null; city?: string | null }>(
  alert: { geometry?: Geometry | null; areaDesc?: string },
  places: T[],
): { inside: T[]; method: 'geometry' | 'area-name' | 'none' } {
  const bounds = boundsOf(alert.geometry);

  if (bounds) {
    const inside = places.filter((p) => {
      if (typeof p.lat !== 'number' || typeof p.lon !== 'number') return false;
      // Cheap rejection before the ray casting, which matters when a thousand
      // accounts are being tested against every active alert.
      if (p.lat < bounds.south || p.lat > bounds.north) return false;
      if (p.lon < bounds.west || p.lon > bounds.east) return false;
      return geometryContains(alert.geometry, { lat: p.lat, lon: p.lon });
    });
    return { inside, method: 'geometry' };
  }

  const areas = (alert.areaDesc ?? '')
    .split(';')
    .map((a) => a.toLowerCase().replace(/\s+county$/, '').trim())
    .filter(Boolean);
  if (!areas.length) return { inside: [], method: 'none' };

  const inside = places.filter((p) => {
    const city = (p.city ?? '').toLowerCase().trim();
    return Boolean(city) && areas.includes(city);
  });
  return { inside, method: 'area-name' };
}
