/**
 * Structured materials list from a job file.
 *
 * Sources: clip summaries / narration / transcripts, video analysis concerns
 * and changes, and scope / estimate documents when present. Every item cites
 * its evidence. Quantities are never guessed — unknown when not in evidence.
 */
import type { JobFileAskContext, JobFileAskDocument, JobFileAskScopeLine } from './jobFileAsk.js';
import type { CollectionClip } from './proofAnalyst.js';

export type MaterialSourceKind = 'clip' | 'transcript' | 'document' | 'scope' | 'estimate';

export interface MaterialCitation {
  kind: MaterialSourceKind;
  /** Human label, e.g. "Clip · 2026-09-12" or "Document · estimate.pdf". */
  label: string;
  /** Clip / proof id when from video. */
  clipId?: string | null;
  /** Seek time in seconds when known from the transcript. */
  timestampSeconds?: number | null;
  /** Short quote or line that mentioned the material. */
  excerpt: string;
}

export interface JobMaterialItem {
  /** Stable id within one extraction (for cart matching). */
  id: string;
  item: string;
  /** Color, size, grade, brand, or other spec — null when not stated. */
  spec: string | null;
  /** Numeric quantity when stated; null means unknown (never invent). */
  quantity: number | null;
  unit: string | null;
  citations: MaterialCitation[];
}

export interface JobMaterialsList {
  items: JobMaterialItem[];
  /** Job address used later for store / delivery checks. */
  jobAddress: string | null;
  extractedAt: string;
}

const UNIT_WORDS =
  'squares?|sq\\.?\\s*ft|square\\s*feet|bundles?|rolls?|sheets?|boxes?|box|bags?|gallons?|gal\\.?|lbs?|pounds?|pieces?|pcs?|lf|lin(?:ear)?\\s*ft|linear\\s*feet|feet|ft\\.?|each|ea\\.?|units?|packs?|tubes?|pails?|buckets?|yards?|yds?';

/** Phrases that look like construction materials (not tools or people). */
const MATERIAL_HINT =
  /\b(shingles?|underlayment|felt|ice\s*and\s*water|drip\s*edge|ridge\s*cap|flashing|step\s*flashing|valley\s*metal|plywood|osb|decking|sheathing|nails?|finished\s*nails?|screws?|caulk|sealant|primer|paint|drywall|joint\s*compound|insulation|vapor\s*barrier|house\s*wrap|siding|gutters?|downspouts?|fascia|soffit|vent(?:ilation)?|pipe\s*boots?|pipe\s*collar|pipe\s*jack|starter\s*strip|ridge\s*vent|lumber|2x4|2x6|studs?|joists?|rafters?|membrane|tpo|epdm|mod(?:ified)?\s*bit(?:umen)?|granules?|mortar|grout|tile|concrete|rebar|mesh|tarp|plastic\s*sheeting|poly|tape|adhesive|glue|liquid\s*nails|construction\s*adhesive|foam|spray\s*foam|roofing\s*cement|asphalt|composition|architectural\s*shingles?|3[- ]tab|copper|aluminum|galvanized|pvc|abs|pex|copper\s*pipe|fitting|elbow|coupling|valve|filter|register|grille|duct|flex\s*duct|thermostat|wire|cable|conduit|breaker|outlet|switch|box\s*extender|mud|tape\s*and\s*mud|corner\s*bead|trim|casing|baseboard|quarter\s*round|threshold|weatherstrip|lockset|hinge|door\s*slab|window|glass|glazing|screen|blinds?|shade|gasket|o[- ]ring|washer|bolt|nut|anchor|toggle|lag|hanger|strap|hurricane\s*tie|hurricane\s*clip|laminate|countertops?|cabinets?|base\s*cabinet|upper\s*cabinet|crown\s*molding|molding|drawer\s*slides?|flooring|vinyl\s*flooring|hardwood|soft[- ]?close)\b/i;

const QTY_BEFORE =
  new RegExp(
    `\\b(\\d+(?:\\.\\d+)?)\\s*(${UNIT_WORDS})\\s+(?:of\\s+)?([A-Za-z][A-Za-z0-9 /\\-]{2,60})`,
    'gi',
  );
const QTY_AFTER =
  new RegExp(
    `\\b([A-Za-z][A-Za-z0-9 /\\-]{2,60}?)\\s*[:\\-–]?\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNIT_WORDS})\\b`,
    'gi',
  );
/** Prefer these multi-word phrases when present in a line. */
const KNOWN_MATERIAL_PHRASES: Array<{ re: RegExp; item: string; spec?: string | null }> = [
  { re: /\blaminate\s+countertops?\b/i, item: 'laminate countertop' },
  { re: /\bcountertops?\b/i, item: 'countertop' },
  { re: /\bbase\s+cabinet\b/i, item: 'base cabinet' },
  { re: /\bupper\s+cabinet\b/i, item: 'upper cabinet' },
  { re: /\bmicrowave\s+cabinet\b/i, item: 'microwave cabinet' },
  { re: /\bcrown\s+molding\b/i, item: 'crown molding' },
  { re: /\bfinished\s+nails?\b/i, item: 'finished nails' },
  { re: /\bdrawer\s+slides?\b|\bshim the slides\b|\bthe slides\b/i, item: 'drawer slides' },
  { re: /\bbirch\s+plywood\b/i, item: 'birch plywood' },
  { re: /\bplywood\b/i, item: 'plywood' },
  { re: /\bconstruction\s+adhesive\b|\bliquid\s+nails\b/i, item: 'construction adhesive' },
  { re: /\b(glue|glued|adhesive)\b/i, item: 'construction adhesive' },
  { re: /\bcaulk\b/i, item: 'caulk' },
  { re: /\bflooring\b/i, item: 'flooring' },
  { re: /\barchitectural\s+shingles?\b/i, item: 'architectural shingles' },
  { re: /\bice\s+and\s+water\b/i, item: 'ice and water shield' },
  { re: /\bsynthetic\s+underlayment\b/i, item: 'synthetic underlayment' },
];

function stripTranscriptNoise(text: string): string {
  return text
    .replace(/\[?\d{1,2}:\d{2}(?::\d{2})?\]?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function preferKnownMaterialName(text: string): string | null {
  for (const row of KNOWN_MATERIAL_PHRASES) {
    if (row.re.test(text)) return row.item;
  }
  return null;
}

/** Product colors we recognise by name (shingle lines, laminate finishes). */
const NAMED_COLORS =
  /\b(Weathered Wood|Charcoal|Colonial Slate|Estate Gray|Desert Tan|Driftwood|Shakewood|Barkwood|Onyx Black|Antique Silver|Hunter Green|Pewter|Brite White|Bright White)\b/i;
/** "color: Brite White" / "colour = Pewter". The keyword must be a whole word followed by : or =. */
const LABELED_COLOR = /\b[Cc]olou?r\s*[:=]\s*([A-Z][A-Za-z0-9]*(?:[ /-][A-Za-z0-9]+){0,3})/;
const DIM_UNIT = '(?:in\\.?|inch(?:es)?|"|ft\\.?|feet|foot|mm|cm)';
const DIM_NUM = '(?:\\d+(?:\\.\\d+)?(?:[- ]\\d+\\/\\d+)?|\\d+\\/\\d+)';
/** Sizes and thicknesses: 3/4 in., 4 ft x 8 ft, 2-1/4", 30 x 24 in. */
const DIMENSION = new RegExp(
  `${DIM_NUM}\\s*(?:${DIM_UNIT}\\s*)?(?:(?:x|×|by)\\s*${DIM_NUM}\\s*(?:${DIM_UNIT}\\s*)?)*${DIM_UNIT}|${DIM_NUM}\\s*${DIM_UNIT}`,
  'i',
);
const GRADE = /\b(?:[A-D]{1,2}-grade|grade\s+[A-D0-9]{1,2})\b/i;
const SPEC_FILLER =
  /\b(behind|the|and|with|or|of|is|are|was|were|to|for|it|its|this|that|these|those|we|they|on|at|visible|packaging|box|some|any|there|here)\b/i;

function fullMatch(re: RegExp, s: string): boolean {
  const m = s.match(re);
  return Boolean(m && m.index === 0 && m[0].trim().length === s.length);
}

/**
 * A spec is a real product attribute (size, thickness, color, grade, or a
 * labeled brand/finish name), never a sentence fragment. When in doubt: no.
 */
export function isPlausibleSpec(raw: string | null | undefined): boolean {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 40 || s.split(' ').length > 5) return false;
  if (fullMatch(DIMENSION, s) || fullMatch(GRADE, s)) return true;
  // Fragments ("ed packaging behind") start lowercase or carry filler words.
  if (/^[^A-Z0-9]/.test(s) || SPEC_FILLER.test(s)) return false;
  if (fullMatch(NAMED_COLORS, s)) return true;
  // Labeled names ("Brite White", "Matte Finish 2"): capitalised words only.
  return /^[A-Z][A-Za-z0-9]*(?:[ /-][A-Z0-9][A-Za-z0-9]*){0,3}$/.test(s);
}

function titleCase(s: string): string {
  return s.replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

function itemPattern(item: string): RegExp {
  const known = KNOWN_MATERIAL_PHRASES.filter((row) => row.item === item).map((row) => row.re.source);
  const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(known.length ? known.join('|') : `\\b${escaped}\\b`, 'i');
}

/**
 * Spec for one item, taken only from a sentence that names that item. Colors
 * may be anywhere in that sentence; sizes / grades must sit right next to the
 * item name. Anything else (or anything implausible) gives null.
 */
export function specForItem(item: string, text: string): string | null {
  const re = itemPattern(item);
  // Split on sentence ends only when a new sentence starts, so "3/4 in. birch" stays whole.
  for (const sentence of text.split(/(?<=[.!?;])\s+(?=[A-Z0-9"“(])/)) {
    const m = re.exec(sentence);
    if (!m) continue;
    const labeled = sentence.match(LABELED_COLOR);
    if (labeled && isPlausibleSpec(labeled[1])) return labeled[1].trim();
    const named = sentence.match(NAMED_COLORS);
    if (named) return titleCase(named[1].toLowerCase());
    const before = sentence.slice(0, m.index).trim().split(/\s+/).slice(-5).join(' ');
    const after = sentence.slice(m.index + m[0].length).trim().split(/\s+/).slice(0, 4).join(' ');
    for (const window of [before, after]) {
      const d = window.match(DIMENSION) ?? window.match(GRADE);
      if (!d || d.index == null) continue;
      // "20 ft of crown molding" is a quantity, not a size.
      if (/^\s*of\b/i.test(window.slice(d.index + d[0].length))) continue;
      const value = d[0].trim();
      if (isPlausibleSpec(value)) return value;
    }
  }
  return null;
}

const TIME_MARK = /(?:^|\s)(?:\[)?(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\])?\s/;

function trimItem(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^(?:install|replace|remove|add|provide|furnish|supply)\s+/i, '')
    .replace(/^[\s:.\-–•*]+|[\s:.\-–•*,;]+$/g, '')
    .slice(0, 120);
}

function parseTimestamp(text: string): number | null {
  const m = text.match(TIME_MARK);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = m[3] != null ? Number(m[3]) : null;
  if (c != null) return a * 3600 + b * 60 + c;
  return a * 60 + b;
}

function looksLikeMaterialName(name: string): boolean {
  const n = name.trim();
  if (n.length < 3 || n.length > 80) return false;
  if (/^(the|a|an|and|or|of|to|for|with|from|this|that|they|we|crew|today|need|get|buy|order)$/i.test(n))
    return false;
  // Verb / place noise from transcripts.
  if (/\b(screw it|while screw|birch lane|black and white tile|heads up)\b/i.test(n)) return false;
  if (/^(and|at|while|on|in)\b/i.test(n)) return false;
  if (!MATERIAL_HINT.test(n) && !/\b(material|supply|supplies)\b/i.test(n)) return false;
  return true;
}

function slugId(parts: string[]): string {
  const base = parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return base || 'item';
}

type Acc = Map<
  string,
  {
    item: string;
    spec: string | null;
    quantity: number | null;
    unit: string | null;
    citations: MaterialCitation[];
  }
>;

function mergeItem(
  acc: Acc,
  input: {
    item: string;
    spec?: string | null;
    quantity?: number | null;
    unit?: string | null;
    citation: MaterialCitation;
  },
): void {
  const item = trimItem(input.item);
  if (!looksLikeMaterialName(item) && !MATERIAL_HINT.test(item)) return;
  input = { ...input, spec: isPlausibleSpec(input.spec) ? input.spec!.trim() : null };
  const key = `${item.toLowerCase()}|${(input.spec ?? '').toLowerCase()}`;
  const existing = acc.get(key);
  if (!existing) {
    acc.set(key, {
      item,
      spec: input.spec?.trim() || null,
      quantity: input.quantity ?? null,
      unit: input.unit?.trim() || null,
      citations: [input.citation],
    });
    return;
  }
  if (existing.quantity == null && input.quantity != null) {
    existing.quantity = input.quantity;
    existing.unit = input.unit?.trim() || existing.unit;
  }
  if (!existing.spec && input.spec) existing.spec = input.spec.trim();
  if (!existing.citations.some((c) => c.excerpt === input.citation.excerpt && c.label === input.citation.label)) {
    existing.citations.push(input.citation);
  }
}

function harvestLine(
  acc: Acc,
  line: string,
  citation: Omit<MaterialCitation, 'excerpt'> & { excerpt?: string },
): void {
  const rawLine = line.replace(/\s+/g, ' ').trim();
  const ts = citation.timestampSeconds ?? parseTimestamp(rawLine);
  const text = stripTranscriptNoise(rawLine);
  if (!text || text.length < 4) return;
  if (!MATERIAL_HINT.test(text)) return;
  // Existing floor being covered — not a material to buy.
  if (/\bold\s+black\s+and\s+white\s+tile\b/i.test(text)) return;
  if (/\bscrew(?:s|ed)?\s+it\s+into\b/i.test(text) && !/\bscrews?\b.*\b(box|pack|pound)/i.test(text)) return;

  const citeBase = {
    kind: citation.kind,
    label: citation.label,
    clipId: citation.clipId ?? null,
    timestampSeconds: ts,
  };

  let matchedQty = false;
  for (const re of [QTY_BEFORE, QTY_AFTER]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      let qty: number;
      let unit: string;
      let name: string;
      if (re === QTY_BEFORE) {
        qty = Number(m[1]);
        unit = m[2].replace(/\s+/g, ' ').trim();
        name = m[3];
      } else {
        name = m[1];
        qty = Number(m[2]);
        unit = m[3].replace(/\s+/g, ' ').trim();
      }
      if (!Number.isFinite(qty) || qty <= 0) continue;
      if (!looksLikeMaterialName(name) && !MATERIAL_HINT.test(name)) continue;
      matchedQty = true;
      const preferred = preferKnownMaterialName(name) ?? preferKnownMaterialName(text);
      const itemName = preferred ?? name;
      mergeItem(acc, {
        item: itemName,
        spec: specForItem(trimItem(itemName), text),
        quantity: qty,
        unit,
        citation: { ...citeBase, excerpt: (citation.excerpt ?? text).slice(0, 240) },
      });
    }
  }

  if (!matchedQty) {
    const found: string[] = [];
    for (const row of KNOWN_MATERIAL_PHRASES) {
      if (row.re.test(text)) found.push(row.item);
    }
    if (!found.length) {
      const hint = text.match(MATERIAL_HINT);
      if (!hint) return;
      const idx = hint.index ?? 0;
      const start = Math.max(0, text.lastIndexOf(',', idx - 1) + 1, text.lastIndexOf('.', idx - 1) + 1);
      const end = (() => {
        const semi = text.indexOf(';', idx);
        const period = text.indexOf('.', idx);
        const candidates = [semi, period].filter((n) => n > idx);
        return candidates.length ? Math.min(...candidates) : Math.min(text.length, idx + 60);
      })();
      let name = text.slice(start, end).trim();
      const words = name.split(/\s+/);
      const matIdx = words.findIndex((w) => MATERIAL_HINT.test(w));
      if (matIdx >= 0) {
        name = words.slice(Math.max(0, matIdx - 2), Math.min(words.length, matIdx + 3)).join(' ');
      }
      name = trimItem(
        name
          .replace(/\b(we|they|need|to|get|buy|order|pick\s*up|for|the|this|that|measuring|cutting)\b/gi, ' ')
          .replace(/\s+/g, ' '),
      );
      if (!name || name.length < 3) name = hint[0];
      found.push(preferKnownMaterialName(name) ?? name);
    }

    const singularCabinet =
      /\bthe\s+(?:laminate\s+)?(?:countertop|base\s+cabinet|upper\s+cabinet|microwave\s+cabinet|cabinet)\b/i.test(
        text,
      );

    for (const name of found) {
      if (!looksLikeMaterialName(name) && !MATERIAL_HINT.test(name)) continue;
      let quantity: number | null = null;
      let unit: string | null = null;
      if (singularCabinet && /\b(cabinet|countertop|laminate)\b/i.test(name)) {
        quantity = 1;
        unit = 'each';
      }
      mergeItem(acc, {
        item: name,
        spec: specForItem(name, text),
        quantity,
        unit,
        citation: { ...citeBase, excerpt: (citation.excerpt ?? text).slice(0, 240) },
      });
    }
  }
}

function harvestClip(acc: Acc, clip: CollectionClip, index: number): void {
  const date = String(clip.workDate ?? '').trim() || `clip ${index + 1}`;
  const label = `Clip · ${date}`;
  const clipId = clip.proofId ?? null;
  const blobs: Array<{ kind: MaterialSourceKind; text: string; at?: number | null }> = [];
  if (clip.summary) blobs.push({ kind: 'clip', text: clip.summary });
  if (clip.narration && clip.narration !== clip.summary) blobs.push({ kind: 'clip', text: clip.narration });
  for (const c of clip.changes ?? []) blobs.push({ kind: 'clip', text: c });
  for (const c of clip.concerns ?? []) blobs.push({ kind: 'clip', text: c });
  if (clip.transcript) {
    // Split transcript into sentences, carrying each line's [m:ss] mark so
    // every sentence keeps a seekable timestamp.
    for (const row of clip.transcript.split(/\n+/)) {
      const at = parseTimestamp(` ${row.trim()} `);
      for (const sentence of row.split(/(?<=[.!?])\s+/)) {
        if (MATERIAL_HINT.test(sentence)) blobs.push({ kind: 'transcript', text: sentence, at });
      }
    }
  }
  for (const b of blobs) {
    harvestLine(acc, b.text, {
      kind: b.kind,
      label: b.kind === 'transcript' ? `${label} (transcript)` : label,
      clipId,
      timestampSeconds: b.at ?? null,
    });
  }
}

function harvestScope(acc: Acc, lines: JobFileAskScopeLine[] | null | undefined): void {
  for (const line of lines ?? []) {
    const title = String(line.title ?? '').trim();
    const detail = String(line.detail ?? '').trim();
    const reason = String(line.reason ?? '').trim();
    const state = String(line.state ?? '').trim();
    if (/exclud|do\s*not|don'?t|out\s*of\s*scope/i.test(`${state} ${title}`)) continue;
    const label = title ? `Scope · ${title.slice(0, 60)}` : 'Scope';
    // Prefer "qty unit + title" so "28 squares" attaches to "architectural shingles".
    if (detail && title && /\b\d+(?:\.\d+)?\s+(?:squares?|bundles?|rolls?|sheets?|boxes?|lf|ft)\b/i.test(detail)) {
      harvestLine(acc, `${detail} ${title}`, { kind: 'scope', label });
    }
    const blob = [title, detail, reason].filter(Boolean).join(' — ');
    if (!blob) continue;
    harvestLine(acc, blob, { kind: 'scope', label });
  }
}

function isEstimateDoc(doc: JobFileAskDocument): boolean {
  const hay = `${doc.filename ?? ''} ${doc.kind ?? ''} ${doc.summary ?? ''}`.toLowerCase();
  return /estimate|scope|material|takeoff|bom|bill of material|quantity/.test(hay);
}

function harvestDocuments(acc: Acc, docs: JobFileAskDocument[] | null | undefined): void {
  for (const doc of docs ?? []) {
    if (doc.attached === false) continue;
    const name = String(doc.filename ?? 'document').trim() || 'document';
    const kind: MaterialSourceKind = isEstimateDoc(doc) ? 'estimate' : 'document';
    const label = `${kind === 'estimate' ? 'Estimate' : 'Document'} · ${name}`;
    const texts: string[] = [];
    if (doc.summary) texts.push(doc.summary);
    if (doc.extractedText) texts.push(doc.extractedText.slice(0, 20_000));
    for (const chunk of doc.chunks ?? []) {
      if (chunk.text) texts.push(chunk.text);
    }
    for (const t of texts) {
      for (const line of t.split(/\n+/)) {
        harvestLine(acc, line, { kind, label });
      }
    }
  }
}

function harvestFacts(acc: Acc, facts: Record<string, string> | null | undefined): void {
  for (const [k, v] of Object.entries(facts ?? {})) {
    const blob = `${k}: ${v}`;
    if (!MATERIAL_HINT.test(blob) && !/material|supply|shingle|underlay/i.test(k)) continue;
    harvestLine(acc, blob, {
      kind: 'document',
      label: `Job brief · ${k}`,
      excerpt: blob.slice(0, 240),
    });
  }
}

/** Build a structured materials list from the job file. Never invents quantities. */
export function extractJobMaterials(
  file: JobFileAskContext | null | undefined,
  address?: string | null,
): JobMaterialsList {
  const acc: Acc = new Map();
  for (let i = 0; i < (file?.clips ?? []).length; i++) {
    harvestClip(acc, (file?.clips ?? [])[i], i);
  }
  harvestScope(acc, file?.scope);
  harvestDocuments(acc, file?.documents);
  harvestFacts(acc, file?.facts ?? null);

  let items: JobMaterialItem[] = [];
  let n = 0;
  for (const row of acc.values()) {
    n += 1;
    items.push({
      id: `${slugId([row.item, row.spec ?? ''])}-${n}`,
      item: row.item,
      spec: row.spec,
      quantity: row.quantity,
      unit: row.unit,
      citations: row.citations.slice(0, 6),
    });
  }
  // Prefer birch plywood over generic plywood when both appear.
  const birch = items.find((i) => /^birch plywood$/i.test(i.item));
  if (birch) {
    items = items.filter((i) => !/^plywood$/i.test(i.item));
  }

  // Dedupe by normalized item name (keep first, merge citations/qty).
  {
    const byName = new Map<string, JobMaterialItem>();
    for (const it of items) {
      const key = it.item.toLowerCase();
      const prev = byName.get(key);
      if (!prev) {
        byName.set(key, it);
        continue;
      }
      if (prev.quantity == null && it.quantity != null) {
        prev.quantity = it.quantity;
        prev.unit = it.unit ?? prev.unit;
      }
      if (!prev.spec && it.spec) prev.spec = it.spec;
      for (const c of it.citations) {
        if (!prev.citations.some((x) => x.excerpt === c.excerpt && x.label === c.label)) {
          prev.citations.push(c);
        }
      }
    }
    items = [...byName.values()];
  }

    // Coalesce generic "countertop" into "laminate countertop" when both appear.
  const lam = items.find((i) => /^laminate countertop$/i.test(i.item));
  const plain = items.find((i) => /^countertops?$/i.test(i.item));
  if (lam && plain) {
    if (lam.quantity == null && plain.quantity != null) {
      lam.quantity = plain.quantity;
      lam.unit = plain.unit ?? lam.unit;
    }
    for (const c of plain.citations) {
      if (!lam.citations.some((x) => x.excerpt === c.excerpt)) lam.citations.push(c);
    }
    items = items.filter((i) => i !== plain);
  }

  items.sort((a, b) => a.item.localeCompare(b.item));
  return {
    items,
    jobAddress: String(address ?? '').trim() || null,
    extractedAt: new Date().toISOString(),
  };
}

/** Chip-shaped citation for the Chat materials table (same shape as AskSourceChip). */
export type MaterialsSourceChip = {
  id: string;
  label: string;
  section?: string;
  jobId?: string;
  proofId?: string;
  atSeconds?: number;
  workDate?: string;
};

export type MaterialsListRowPayload = {
  id: string;
  item: string;
  spec: string | null;
  quantity: number | null;
  unit: string | null;
  sources: MaterialsSourceChip[];
};

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function citationToSourceChip(
  cite: MaterialCitation,
  opts?: { jobId?: string | null },
): MaterialsSourceChip {
  const jobId = String(opts?.jobId ?? '').trim() || undefined;
  const proofId = cite.clipId ? String(cite.clipId) : undefined;
  const at =
    cite.timestampSeconds != null && Number.isFinite(cite.timestampSeconds)
      ? Math.floor(cite.timestampSeconds)
      : undefined;
  const dateMatch = cite.label.match(/(\d{4}-\d{2}-\d{2})/);
  const workDate = dateMatch?.[1];

  if (jobId && proofId && at != null) {
    const id = `video/${jobId}/${proofId}@${at}`;
    return {
      id,
      label: `${workDate ? `Clip · ${workDate}` : 'Clip'} · ${formatClock(at)}`,
      section: 'videos',
      jobId,
      proofId,
      atSeconds: at,
      workDate,
    };
  }
  if (workDate) {
    return {
      id: `clip:${workDate}`,
      label: at != null ? `Clip · ${workDate} · ${formatClock(at)}` : `Clip · ${workDate}`,
      section: 'videos',
      workDate,
      proofId,
      atSeconds: at,
      jobId,
    };
  }
  if (cite.kind === 'scope') {
    return { id: 'scope', label: cite.label.replace(/^Scope\s*·\s*/i, 'Scope') || 'Scope', section: 'scope' };
  }
  if (cite.kind === 'estimate' || cite.kind === 'document') {
    return { id: 'document', label: cite.label, section: 'setup' };
  }
  return { id: 'evidence', label: cite.label || 'Evidence', section: 'evidence' };
}

function mentions(cite: MaterialCitation, item: string): boolean {
  return cite.excerpt.toLowerCase().includes(item.toLowerCase());
}

/** Structured rows for the materials card (no raw markdown). */
export function materialsRowsForUi(
  list: JobMaterialsList,
  opts?: { jobId?: string | null },
): MaterialsListRowPayload[] {
  return list.items.map((it) => ({
    id: it.id,
    item: it.item,
    spec: it.spec,
    quantity: it.quantity,
    unit: it.unit,
    sources: dedupeSourceChips(
      [...it.citations]
        // Citations that name the item exactly come first (best moment to seek to).
        .sort((a, b) => Number(mentions(b, it.item)) - Number(mentions(a, it.item)))
        .map((c) => citationToSourceChip(c, opts)),
    ).slice(0, 3),
  }));
}

/**
 * One chip per clip (or per non-clip source). Input is ordered by relevance;
 * a chip without a timestamp is upgraded to one that can seek.
 */
export function dedupeSourceChips(chips: MaterialsSourceChip[]): MaterialsSourceChip[] {
  const out: MaterialsSourceChip[] = [];
  const index = new Map<string, number>();
  for (const chip of chips) {
    const key = chip.proofId || (chip.workDate ? `date:${chip.workDate}` : `id:${chip.id}`);
    const at = index.get(key);
    if (at == null) {
      index.set(key, out.length);
      out.push(chip);
      continue;
    }
    // Keep the first (most relevant) chip; only upgrade one that can't seek.
    if (out[at].atSeconds == null && chip.atSeconds != null) out[at] = chip;
  }
  return out;
}

/**
 * Summary for the Computer action trailer / card.
 * Human lead text plus MATERIALS_JSON so the UI can render a real table + chips.
 * Avoids pipe characters so formatActionsTrailer stays intact.
 */
export function formatMaterialsListForChat(list: JobMaterialsList, opts?: { jobId?: string | null }): string {
  if (!list.items.length) {
    return 'I could not find materials listed in the clips, transcripts, or scope on this job file yet. Add a scope or estimate, or ask after more field video is on file.';
  }
  const rows = materialsRowsForUi(list, opts);
  const lead = `Materials on this job file (${rows.length} item${rows.length === 1 ? '' : 's'}). Quantities marked unknown were not stated in the evidence.`;
  const payload = JSON.stringify({ rows }).replace(/\|/g, '/');
  return `${lead}\nMATERIALS_JSON:${payload}`;
}

/** True when the person is asking to list / find materials (not order yet). */
export function looksLikeMaterialsListAsk(question: string): boolean {
  const q = String(question ?? '').toLowerCase().trim();
  if (!q) return false;
  if (/\b(order|buy|purchase|checkout|place\s+an?\s+order|add\s+to\s+cart)\b/.test(q)) return false;
  return (
    /\b(materials?|supplies|bom|bill of materials?|takeoff|what\s+(?:do\s+we|to)\s+(?:need|buy|order)|shopping\s+list)\b/.test(
      q,
    ) && /\b(list|show|what|find|extract|pull|get|need)\b/.test(q)
  );
}
