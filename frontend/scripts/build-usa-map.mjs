/**
 * Generate src/lib/usaGeography.ts — the state outlines the territory map draws.
 *
 * Run by hand when the outlines need regenerating, which is close to never:
 *
 *   npx --package=us-atlas@3 --package=topojson-client@3 --package=d3-geo@3 \
 *       node scripts/build-usa-map.mjs
 *
 * Deliberately not a build step and not a dependency. The output is 40KB of
 * committed path data; making every CI run install d3 and a topology to
 * recompute a constant would be paying forever for a decision made once.
 *
 * Boundaries are the US Census Bureau's cartographic files by way of us-atlas
 * (Michael Bostock, ISC). Census boundary data is a work of the US government
 * and in the public domain.
 *
 * The second thing this does matters more than the first: it checks the
 * hand-written projection in src/lib/albersUsa.ts against d3-geo's, over every
 * state capital and a grid of points across the country, and refuses to write
 * the file if any of them disagree. The outlines are projected here and the
 * ZIP dots are projected in the browser — if those two drift apart, nothing
 * errors, the dots just quietly land in the wrong state.
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const { geoAlbersUsa, geoPath } = require('d3-geo');
const { feature } = require('topojson-client');
const topology = require('us-atlas/states-10m.json');

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'src', 'lib', 'usaGeography.ts');

const SCALE = 1300;
const TRANSLATE = [487.5, 305];
const WIDTH = 975;
const HEIGHT = 610;

const projection = geoAlbersUsa().scale(SCALE).translate(TRANSLATE);

/* ---- 1. Verify the runtime projection ------------------------------------ */

const { albersUsa } = await import('../src/lib/albersUsa.ts').catch(() => ({}));
let ours = albersUsa?.(SCALE, TRANSLATE);

if (!ours) {
  // Node cannot import TypeScript directly. Strip the types — this file is
  // plain arithmetic and the annotations are the only TS in it.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(join(HERE, '..', 'src', 'lib', 'albersUsa.ts'), 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/^export interface [\s\S]*?^}$/gm, '')
    .replace(/: \[number, number\] \| null/g, '')
    .replace(/: \[number, number\]/g, '')
    .replace(/: Piece\b/g, '')
    .replace(/: number/g, '')
    .replace(/: boolean/g, '')
    .replace(/: string/g, '')
    .replace(/<[^<>]*>\(/g, '(')
    .replace(/spec: \{[\s\S]*?\}\)/m, 'spec)')
    .replace(/\bexport /g, '');
  const mod = new Function(`${src}; return albersUsa;`)();
  ours = mod(SCALE, TRANSLATE);
}

// A grid over the continent plus the awkward cases: the two insets, the
// corners, and somewhere that must come back null.
const samples = [];
for (let lat = 24; lat <= 50; lat += 1) {
  for (let lon = -125; lon <= -66; lon += 1) samples.push([lon, lat]);
}
for (let lat = 52; lat <= 71; lat += 1) {
  for (let lon = -173; lon <= -130; lon += 2) samples.push([lon, lat]);
}
for (let lat = 18; lat <= 23; lat += 0.5) {
  for (let lon = -161; lon <= -154; lon += 0.5) samples.push([lon, lat]);
}
samples.push([-66.1, 18.4]); // San Juan — outside Albers USA entirely
samples.push([144.8, 13.5]); // Guam

let checked = 0;
let worst = 0;
for (const [lon, lat] of samples) {
  const theirs = projection([lon, lat]);
  const mine = ours(lon, lat);

  if (theirs === null || mine === null) {
    if ((theirs === null) !== (mine === null)) {
      throw new Error(
        `Projection disagrees on whether ${lon},${lat} is on the map: ` +
          `d3 ${theirs === null ? 'null' : theirs.join()}, ours ${mine === null ? 'null' : mine.join()}`,
      );
    }
    continue;
  }

  const off = Math.hypot(theirs[0] - mine[0], theirs[1] - mine[1]);
  worst = Math.max(worst, off);
  if (off > 1e-6) {
    throw new Error(`Projection differs at ${lon},${lat} by ${off}px — d3 ${theirs}, ours ${mine}`);
  }
  checked += 1;
}
console.log(`projection verified against d3-geo: ${checked} points, worst ${worst.toExponential(2)}px`);

/* ---- 2. Project the outlines --------------------------------------------- */

// One decimal is a tenth of a pixel at this viewBox — invisible, and it halves
// the file.
const path = geoPath(projection).digits(1);
const states = feature(topology, topology.objects.states);

/** FIPS → postal code. The topology carries the numeric id and the name only. */
const FIPS = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO',
  '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI',
  '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY',
  '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
  '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
  '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD',
  '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
  '54': 'WV', '55': 'WI', '56': 'WY', '72': 'PR', '78': 'VI',
};

const rows = [];
const skipped = [];
for (const f of states.features) {
  const code = FIPS[String(f.id).padStart(2, '0')];
  const d = path(f);
  // Puerto Rico and the Virgin Islands are outside Albers USA, so d3 projects
  // them to nothing. Dropping them silently would be the bug; the map says so
  // instead, since zips.ts does hand out PR and VI codes.
  if (!code || !d) {
    skipped.push(f.properties?.name ?? f.id);
    continue;
  }
  rows.push({ code, name: f.properties?.name ?? code, d });
}

rows.sort((a, b) => a.code.localeCompare(b.code));
console.log(`${rows.length} states projected; off the map: ${skipped.join(', ') || 'none'}`);

const file = `/**
 * US state outlines, projected.
 *
 * GENERATED by scripts/build-usa-map.mjs — do not edit. Boundaries are the US
 * Census Bureau's cartographic files (public domain) via us-atlas, projected
 * with Albers USA at scale ${SCALE}, translate [${TRANSLATE}], into a
 * ${WIDTH}×${HEIGHT} viewBox.
 *
 * Puerto Rico and the Virgin Islands have no place in this projection and are
 * absent by construction. ZIP codes there exist, so anything drawing this map
 * has to say so rather than let them vanish.
 */

export const USA_VIEWBOX = { width: ${WIDTH}, height: ${HEIGHT} } as const;

/** States with no outline here, because Albers USA has nowhere to put them. */
export const OFF_MAP_STATES = ['PR', 'VI'] as const;

export interface StateShape {
  /** Two-letter postal code, which is what territories resolve to. */
  code: string;
  name: string;
  /** SVG path data in viewBox coordinates. */
  d: string;
}

export const USA_STATES: StateShape[] = [
${rows.map((r) => `  { code: '${r.code}', name: ${JSON.stringify(r.name)}, d: '${r.d}' },`).join('\n')}
];

export const STATE_NAMES: Record<string, string> = Object.fromEntries(
  USA_STATES.map((s) => [s.code, s.name]),
);
`;

writeFileSync(OUT, file);
console.log(`wrote ${OUT} (${(file.length / 1024).toFixed(0)}KB)`);
