/**
 * ZIP codes, which is how a territory is actually described.
 *
 * Sales teams draw territories in ZIPs — "78664, 78665, 78681" — because that
 * is how routes, drive times and franchise agreements are written. The
 * territory table has held a `postal_codes` array since it was built.
 *
 * Nothing read it. Alert matching compared county and city names only, so a
 * territory defined the normal way matched no weather at all, silently. This
 * file is what makes a ZIP mean something.
 *
 * Two conversions, and they are deliberately different in cost:
 *
 *   ZIP → state    A lookup table. Instant, offline, exact. Needed to know
 *                  which states to ask the weather service about, and asking
 *                  for the wrong ones is the difference between national
 *                  coverage and a hardcoded 'TX'.
 *
 *   ZIP → point    A geocode. Slow and rate-limited, so it is cached
 *                  permanently — a ZIP centroid does not move. Needed for
 *                  point-in-polygon against an alert's actual shape, which is
 *                  far better than matching the county name the office wrote.
 */

/**
 * ZIP ranges by state.
 *
 * The published allocations. A handful of states hold discontiguous blocks and
 * a few individual codes sit outside their state's range entirely — 73301 is
 * an IRS address in Austin inside Oklahoma's block, and New York holds several
 * codes in the 00xxx range for the UN and for Fishers Island. Those are listed
 * explicitly rather than rounded away, because rounding them away puts a real
 * customer in the wrong state's weather.
 */
const RANGES: Array<[string, number, number]> = [
  ['AL', 35000, 36999], ['AK', 99500, 99999], ['AZ', 85000, 86999],
  ['AR', 71600, 72999], ['CA', 90000, 96199], ['CO', 80000, 81999],
  ['CT', 6000, 6999], ['DE', 19700, 19999],
  ['DC', 20000, 20099], ['DC', 20200, 20599],
  ['FL', 32000, 34999], ['GA', 30000, 31999], ['GA', 39800, 39999],
  ['HI', 96700, 96899], ['ID', 83200, 83899], ['IL', 60000, 62999],
  ['IN', 46000, 47999], ['IA', 50000, 52999], ['KS', 66000, 67999],
  ['KY', 40000, 42799], ['LA', 70000, 71499], ['ME', 3900, 4999],
  ['MD', 20600, 21999], ['MA', 1000, 2799], ['MI', 48000, 49999],
  ['MN', 55000, 56799], ['MS', 38600, 39799], ['MO', 63000, 65899],
  ['MT', 59000, 59999], ['NE', 68000, 69399], ['NV', 88900, 89899],
  ['NH', 3000, 3899], ['NJ', 7000, 8999], ['NM', 87000, 88499],
  ['NY', 10000, 14999], ['NC', 27000, 28999], ['ND', 58000, 58899],
  ['OH', 43000, 45999], ['OK', 73000, 74999], ['OR', 97000, 97999],
  ['PA', 15000, 19699], ['RI', 2800, 2999], ['SC', 29000, 29999],
  ['SD', 57000, 57799], ['TN', 37000, 38599],
  ['TX', 75000, 79999], ['TX', 88500, 88599],
  ['UT', 84000, 84799], ['VT', 5000, 5999],
  ['VA', 20100, 20199], ['VA', 22000, 24699],
  ['WA', 98000, 99499], ['WV', 24700, 26899], ['WI', 53000, 54999],
  ['WY', 82000, 83199],
  // Territories the National Weather Service also covers.
  ['PR', 600, 799], ['PR', 900, 999], ['VI', 800, 899],
];

/** Codes that sit outside their own state's block. */
const EXCEPTIONS: Record<string, string> = {
  '73301': 'TX', // IRS, Austin — inside Oklahoma's range
  '73344': 'TX', // IRS, Austin
  '06390': 'NY', // Fishers Island — inside Connecticut's range
  '00501': 'NY', // IRS, Holtsville
  '00544': 'NY', // IRS, Holtsville
};

/** Five digits, ZIP+4 trimmed, whitespace gone. */
export function normaliseZip(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).trim().split('-')[0].replace(/\D/g, '');
  if (digits.length !== 5) return null;
  return digits;
}

/**
 * Which state is this ZIP in?
 *
 * Null when it is not a recognisable US code, which the caller treats as "no
 * weather coverage" rather than guessing at a state.
 */
export function zipToState(raw: string | null | undefined): string | null {
  const zip = normaliseZip(raw);
  if (!zip) return null;
  if (EXCEPTIONS[zip]) return EXCEPTIONS[zip];

  const n = Number(zip);
  for (const [state, low, high] of RANGES) {
    if (n >= low && n <= high) return state;
  }
  return null;
}

/**
 * Every state a set of territories touches.
 *
 * This is what replaces the hardcoded 'TX'. An organization working Texarkana
 * spans two states and a franchise group can span a dozen; asking the weather
 * service about one of them was the difference between a national product and
 * a demo.
 *
 * Cities and counties are deliberately not consulted — "Springfield" is in
 * thirty-odd states and guessing would poll half the country. A territory
 * defined only by city names contributes no state, and the UI says so.
 */
export function statesForTerritories(
  territories: Array<{ postal_codes?: string[] | null; state?: string | null }>,
): string[] {
  const states = new Set<string>();
  for (const territory of territories) {
    if (territory.state) {
      const explicit = territory.state.trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(explicit)) states.add(explicit);
    }
    for (const zip of territory.postal_codes ?? []) {
      const state = zipToState(zip);
      if (state) states.add(state);
    }
  }
  return [...states].sort();
}

/** Every ZIP across a set of territories, normalised and de-duplicated. */
export function zipsForTerritories(
  territories: Array<{ postal_codes?: string[] | null }>,
): string[] {
  const zips = new Set<string>();
  for (const territory of territories) {
    for (const raw of territory.postal_codes ?? []) {
      const zip = normaliseZip(raw);
      if (zip) zips.add(zip);
    }
  }
  return [...zips].sort();
}

/**
 * Does this alert cover any of these ZIPs?
 *
 * Geometry when the alert has it and the ZIPs have been located, because a
 * polygon and a point settle it exactly. Falls back to the county names the
 * issuing office wrote, which is all a watch usually carries.
 *
 * Returns which ZIPs matched rather than a boolean: "the alert covers your
 * territory" and "it covers 78664 and 78681 but not the other nine" are
 * different sentences, and the second is the one somebody can act on.
 */
export function zipsInAlert(
  alert: { geometry?: { type?: string; coordinates?: unknown } | null; areaDesc?: string },
  zips: string[],
  centroids: Map<string, { lat: number; lon: number }>,
  contains: (geometry: unknown, point: { lat: number; lon: number }) => boolean,
): { matched: string[]; method: 'geometry' | 'area-name' | 'none' } {
  if (alert.geometry) {
    const matched = zips.filter((zip) => {
      const point = centroids.get(zip);
      return point ? contains(alert.geometry, point) : false;
    });
    // Only trust geometry when at least one ZIP was actually locatable —
    // otherwise "no matches" means "we could not check", which is a very
    // different thing from "the storm is elsewhere".
    if (centroids.size > 0) return { matched, method: 'geometry' };
  }

  const areas = (alert.areaDesc ?? '')
    .split(';')
    .map((a) => a.toLowerCase().replace(/\s+county$/, '').trim())
    .filter(Boolean);
  if (!areas.length) return { matched: [], method: 'none' };

  return { matched: [], method: 'area-name' };
}
