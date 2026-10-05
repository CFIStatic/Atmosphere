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
  /\b(shingles?|underlayment|felt|ice\s*and\s*water|drip\s*edge|ridge\s*cap|flashing|step\s*flashing|valley\s*metal|plywood|osb|decking|sheathing|nails?|screws?|caulk|sealant|primer|paint|drywall|joint\s*compound|insulation|vapor\s*barrier|house\s*wrap|siding|gutters?|downspouts?|fascia|soffit|vent(?:ilation)?|pipe\s*boots?|pipe\s*collar|pipe\s*jack|starter\s*strip|ridge\s*vent|lumber|2x4|2x6|studs?|joists?|rafters?|membrane|tpo|epdm|mod(?:ified)?\s*bit(?:umen)?|granules?|mortar|grout|tile|concrete|rebar|mesh|tarp|plastic\s*sheeting|poly|tape|adhesive|glue|foam|spray\s*foam|roofing\s*cement|asphalt|composition|architectural\s*shingles?|3[- ]tab|copper|aluminum|galvanized|pvc|abs|pex|copper\s*pipe|fitting|elbow|coupling|valve|filter|register|grille|duct|flex\s*duct|thermostat|wire|cable|conduit|breaker|outlet|switch|box\s*extender|mud|tape\s*and\s*mud|corner\s*bead|trim|casing|baseboard|quarter\s*round|threshold|weatherstrip|lockset|hinge|door\s*slab|window|glass|glazing|screen|blinds?|shade|gasket|o[- ]ring|washer|bolt|nut|anchor|toggle|lag|hanger|strap|hurricane\s*tie|hurricane\s*clip)\b/i;

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
const COLOR_SPEC =
  /\b(?:color|colour|in)\s+([A-Z][A-Za-z0-9 /-]{2,40})|\b(Weathered Wood|Charcoal|Slate|Driftwood|Estate Gray|Desert Tan|Black|White|Brown|Gray|Grey|Hunter Green|Colonial Slate|Pewter|Shakewood|Barkwood|Onyx Black|Antique Silver)\b/i;

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
  const text = line.replace(/\s+/g, ' ').trim();
  if (!text || text.length < 4) return;
  if (!MATERIAL_HINT.test(text)) return;

  const ts = citation.timestampSeconds ?? parseTimestamp(text);
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
      const color = text.match(COLOR_SPEC);
      mergeItem(acc, {
        item: name,
        spec: color ? (color[1] || color[2] || null) : null,
        quantity: qty,
        unit,
        citation: { ...citeBase, excerpt: (citation.excerpt ?? text).slice(0, 240) },
      });
    }
  }

  if (!matchedQty) {
    // Mention without quantity — still list, quantity unknown.
    const hint = text.match(MATERIAL_HINT);
    if (!hint) return;
    // Prefer a short noun phrase around the hint.
    const idx = hint.index ?? 0;
    const start = Math.max(0, text.lastIndexOf(',', idx - 1) + 1, text.lastIndexOf('.', idx - 1) + 1);
    const end = (() => {
      const semi = text.indexOf(';', idx);
      const period = text.indexOf('.', idx);
      const candidates = [semi, period].filter((n) => n > idx);
      return candidates.length ? Math.min(...candidates) : Math.min(text.length, idx + 60);
    })();
    let name = text.slice(start, end).trim();
    // Tighten to ~words around the material word.
    const words = name.split(/\s+/);
    const matIdx = words.findIndex((w) => MATERIAL_HINT.test(w));
    if (matIdx >= 0) {
      name = words.slice(Math.max(0, matIdx - 3), Math.min(words.length, matIdx + 4)).join(' ');
    }
    name = trimItem(name.replace(/\b(we|they|need|to|get|buy|order|pick\s*up|for)\b/gi, ' ').replace(/\s+/g, ' '));
    if (!name || name.length < 3) name = hint[0];
    const color = text.match(COLOR_SPEC);
    mergeItem(acc, {
      item: name,
      spec: color ? (color[1] || color[2] || null) : null,
      quantity: null,
      unit: null,
      citation: { ...citeBase, excerpt: (citation.excerpt ?? text).slice(0, 240) },
    });
  }
}

function harvestClip(acc: Acc, clip: CollectionClip, index: number): void {
  const date = String(clip.workDate ?? '').trim() || `clip ${index + 1}`;
  const label = `Clip · ${date}`;
  const clipId = clip.proofId ?? null;
  const blobs: Array<{ kind: MaterialSourceKind; text: string }> = [];
  if (clip.summary) blobs.push({ kind: 'clip', text: clip.summary });
  if (clip.narration && clip.narration !== clip.summary) blobs.push({ kind: 'clip', text: clip.narration });
  for (const c of clip.changes ?? []) blobs.push({ kind: 'clip', text: c });
  for (const c of clip.concerns ?? []) blobs.push({ kind: 'clip', text: c });
  if (clip.transcript) {
    // Split transcript into short lines for better citations.
    for (const line of clip.transcript.split(/(?<=[.!?])\s+|\n+/)) {
      if (MATERIAL_HINT.test(line)) blobs.push({ kind: 'transcript', text: line });
    }
  }
  for (const b of blobs) {
    harvestLine(acc, b.text, {
      kind: b.kind,
      label: b.kind === 'transcript' ? `${label} (transcript)` : label,
      clipId,
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

  const items: JobMaterialItem[] = [];
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
  items.sort((a, b) => a.item.localeCompare(b.item));
  return {
    items,
    jobAddress: String(address ?? '').trim() || null,
    extractedAt: new Date().toISOString(),
  };
}

/** Plain professional markdown for Chat. */
export function formatMaterialsListForChat(list: JobMaterialsList): string {
  if (!list.items.length) {
    return 'I could not find materials listed in the clips, transcripts, or scope on this job file yet. Add a scope or estimate, or ask after more field video is on file.';
  }
  const lines = ['Materials on this job file:', ''];
  for (const it of list.items) {
    const qty =
      it.quantity != null
        ? `${it.quantity}${it.unit ? ` ${it.unit}` : ''}`
        : 'quantity unknown';
    const spec = it.spec ? ` · ${it.spec}` : '';
    const cite = it.citations[0];
    const citeBits = [cite?.label];
    if (cite?.timestampSeconds != null && Number.isFinite(cite.timestampSeconds)) {
      const m = Math.floor(cite.timestampSeconds / 60);
      const s = Math.floor(cite.timestampSeconds % 60);
      citeBits.push(`${m}:${String(s).padStart(2, '0')}`);
    }
    lines.push(`- **${it.item}**${spec} — ${qty}${citeBits.filter(Boolean).length ? ` _(source: ${citeBits.filter(Boolean).join(' · ')})_` : ''}`);
  }
  lines.push('');
  lines.push('Quantities marked unknown were not stated in the evidence. I do not guess amounts.');
  return lines.join('\n');
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
