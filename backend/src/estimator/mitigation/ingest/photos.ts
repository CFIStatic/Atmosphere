import type { Evidence } from '../types.js';

/**
 * iPhone photo ingestion.
 *
 * Photos arrive as a metadata manifest — filename, EXIF capture time, optional
 * GPS, and whatever caption the technician typed — not as image bytes. Pixels
 * are never needed to *estimate*; they are needed to *defend* the estimate, so
 * what matters here is the timestamp and the caption, and the URI that lets a
 * reviewer open the original.
 *
 * Extracting EXIF on the client keeps large binaries off this service entirely,
 * which is why the backend takes a manifest. `PhotoManifestEntry` is exactly
 * what a client gets from the iOS share sheet plus a caption field.
 *
 * The captions do real work. A photo captioned "flood cut 24in master bath"
 * becomes the evidence that substantiates a flood-cut line item, and without at
 * least one such photo the estimator will flag that line rather than bill it.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PhotoManifestEntry {
  id?: string;
  filename?: string;
  /** EXIF DateTimeOriginal, ISO 8601. */
  capturedAt?: string;
  latitude?: number;
  longitude?: number;
  /** Technician's caption, or the note attached in the Photos app. */
  caption?: string;
  /** Room this photo belongs to, when the app captured it. */
  roomId?: string;
  roomName?: string;
  /** Where the original lives — Supabase Storage path or signed URL. */
  uri?: string;
}

export interface PhotoParseResult {
  evidence: Evidence[];
  /** Earliest photo timestamp — a lower bound on when the crew was on site. */
  earliestCapture?: string;
  latestCapture?: string;
  warnings: string[];
}

/**
 * Caption keywords that map to scope-relevant tags.
 *
 * Ordered most-specific first so "carpet pad" wins over "carpet". Each tag is
 * consumed by the evidence gate in `profitability.ts`, so adding a pattern here
 * is what lets a new line item become billable on photo documentation alone.
 */
const CAPTION_TAGS: Array<[RegExp, string]> = [
  [/flood\s*cut|2\s*ft\s*cut|24\s*(in|")\s*cut|wall\s*cut/i, 'flood_cut'],
  [/carpet\s*pad|padding/i, 'carpet_pad'],
  [/carpet/i, 'carpet'],
  [/baseboard|base\s*trim/i, 'baseboard'],
  [/insulation/i, 'insulation'],
  [/drywall|sheetrock|gypsum/i, 'drywall'],
  [/ceiling/i, 'ceiling'],
  [/cabinet|vanity|toe\s*kick/i, 'cabinetry'],
  [/hardwood|wood\s*floor/i, 'hardwood'],
  [/tile|grout/i, 'tile'],
  [/subfloor|osb|plywood/i, 'subfloor'],
  // The lookbehind matters: "antimicrobial applied" is a photo of treatment
  // being performed, and without it that caption reads as evidence of *mold*,
  // which pulls containment, negative air and PPE onto a job that needed none.
  [/\bmold\b|(?<!anti)microbial|mildew|fungal/i, 'microbial'],
  [/sewage|black\s*water|cat\s*3|category\s*3/i, 'category_3'],
  [/cat\s*2|category\s*2|grey\s*water|gray\s*water/i, 'category_2'],
  [/containment|poly|barrier|zip\s*wall/i, 'containment'],
  [/air\s*mover|blower|fan/i, 'air_mover'],
  [/dehu|dehumidifier|lgr/i, 'dehumidifier'],
  [/scrubber|negative\s*air|afd/i, 'air_scrubber'],
  [/moisture\s*meter|reading|thermo|hygrometer/i, 'moisture_reading'],
  [/before|pre-?loss|initial/i, 'before'],
  [/after|post|complete|final/i, 'after'],
  [/content|pack\s*out|manipulat/i, 'contents'],
  [/antimicrobial|biocide|shockwave|benefect/i, 'antimicrobial'],
  [/hepa\s*vac|hepa/i, 'hepa'],
  [/extract|extraction|wand|truck\s*mount/i, 'extraction'],
  [/source|leak|supply\s*line|burst/i, 'source'],
];

/** Derive tags from a caption. Returns [] for an empty or unhelpful caption. */
export function tagsFromCaption(caption: string | undefined): string[] {
  if (!caption) return [];
  const tags = new Set<string>();
  for (const [pattern, tag] of CAPTION_TAGS) {
    if (pattern.test(caption)) tags.add(tag);
  }
  return [...tags];
}

/** Recover a capture time from an iPhone filename like `IMG_20240517_143022.HEIC`. */
function capturedAtFromFilename(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  const match = filename.match(/(20\d{2})[-_]?(\d{2})[-_]?(\d{2})[-_ T]?(\d{2})?(\d{2})?(\d{2})?/);
  if (!match) return undefined;
  const [, y, mo, d, h = '12', mi = '00', s = '00'] = match;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

export function parsePhotos(entries: unknown): PhotoParseResult {
  const warnings: string[] = [];
  const list: PhotoManifestEntry[] = Array.isArray(entries) ? (entries as PhotoManifestEntry[]) : [];

  if (list.length === 0) {
    return { evidence: [], warnings: ['No photos supplied — evidence-gated line items will be flagged.'] };
  }

  const evidence: Evidence[] = [];
  const timestamps: number[] = [];
  let untagged = 0;

  list.forEach((entry, index) => {
    const capturedAt =
      normalizeIso(entry.capturedAt) ?? capturedAtFromFilename(entry.filename ?? undefined);
    if (capturedAt) timestamps.push(Date.parse(capturedAt));

    const tags = tagsFromCaption(entry.caption);
    if (tags.length === 0) untagged += 1;

    if (entry.roomName) tags.push(normalizeTag(entry.roomName));
    if (typeof entry.latitude === 'number' && typeof entry.longitude === 'number') {
      tags.push('geotagged');
    }
    tags.push('photo');

    evidence.push({
      id: entry.id ?? `photo-${index}`,
      kind: 'photo',
      roomId: entry.roomId,
      capturedAt,
      description:
        entry.caption?.trim() ||
        `Photo ${entry.filename ?? index + 1}${entry.roomName ? ` — ${entry.roomName}` : ''} (no caption).`,
      uri: entry.uri,
      tags: [...new Set(tags)],
    });
  });

  if (untagged > 0) {
    warnings.push(
      `${untagged} of ${list.length} photos had no caption the estimator could read. Captions such as "flood cut 24in — master bath" are what substantiate demolition line items on review.`,
    );
  }

  timestamps.sort((a, b) => a - b);

  return {
    evidence,
    earliestCapture: timestamps.length ? new Date(timestamps[0]).toISOString() : undefined,
    latestCapture: timestamps.length ? new Date(timestamps[timestamps.length - 1]).toISOString() : undefined,
    warnings,
  };
}

function normalizeIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  // EXIF writes "2024:05:17 14:30:22"; JSON exports usually write ISO.
  const exif = value.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  const candidate = exif ? `${exif[1]}-${exif[2]}-${exif[3]}T${exif[4]}Z` : value;
  const parsed = Date.parse(candidate);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

function normalizeTag(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
