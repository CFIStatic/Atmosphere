/**
 * What the file is, the facts printed on it, and whether it belongs to a job.
 * Facts are exact substrings of the extracted text. Relevance never attaches
 * a weak or contradictory match on its own.
 */
import {
  KIND_LABEL,
  type DocumentFacts,
  type DocumentKind,
  type JobMatchProfile,
  type QuotedFact,
  type RelevanceDecision,
  type RoomFact,
} from './types.js';

const KIND_RULES: Array<{ kind: DocumentKind; pattern: RegExp; weight: number }> = [
  { kind: 'change_order', pattern: /\bchange\s+orders?\b/i, weight: 5 },
  { kind: 'insurance_claim', pattern: /\b(insurance\s+claim|claim\s+number|proof\s+of\s+loss)\b/i, weight: 5 },
  { kind: 'estimate', pattern: /\b(estimate|quotation|quote\s+no|line\s+items?)\b/i, weight: 4 },
  { kind: 'invoice', pattern: /\b(invoice|amount\s+due|balance\s+due)\b/i, weight: 4 },
  { kind: 'contract', pattern: /\b(agreement|contract|hereby\s+agree)\b/i, weight: 4 },
  { kind: 'floor_plan', pattern: /\b(floor\s*plan|room\s+schedule)\b/i, weight: 5 },
  { kind: 'sketch', pattern: /\b(sketch|hand\s*drawn|elevation)\b/i, weight: 3 },
  { kind: 'permit', pattern: /\b(building\s+permit|permit\s+(no|number|#))\b/i, weight: 5 },
  { kind: 'scope', pattern: /\b(scope\s+of\s+work|work\s+order)\b/i, weight: 4 },
  { kind: 'photo', pattern: /\b(visible\s+text|photo|photograph)\b/i, weight: 1 },
];

export function classifyDocument(filename: string, text: string): DocumentKind {
  const hay = `${filename}\n${text}`;
  let best: DocumentKind = 'other';
  let score = 0;
  for (const rule of KIND_RULES) {
    if (!rule.pattern.test(hay)) continue;
    const weight = rule.weight + (rule.pattern.test(filename) ? 2 : 0);
    if (weight > score) {
      score = weight;
      best = rule.kind;
    }
  }
  if (best === 'other' && /\b(\d{1,3}\s*'\s*[x×]\s*\d{1,3})\b/.test(text) && /\b(kitchen|bath|bedroom|living|room)\b/i.test(text)) {
    return 'floor_plan';
  }
  if (best === 'sketch' && /\bfloor\s*plan\b/i.test(hay)) return 'floor_plan';
  return best;
}

export function extractFacts(text: string, locations: Array<{ location: string; text: string }>): DocumentFacts {
  const facts: DocumentFacts = {
    totals: [],
    lineItems: [],
    dates: [],
    addresses: [],
    parties: [],
    claimNumbers: [],
    rooms: [],
  };
  for (const block of locations.length ? locations : [{ location: 'document', text }]) {
    collectTotals(block.text, block.location, facts.totals);
    collectLineItems(block.text, block.location, facts.lineItems);
    collectMatches(block.text, block.location, /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/gi, 'Date', facts.dates);
    collectMatches(
      block.text,
      block.location,
      /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Court|Ct)\b\.?/gi,
      'Address',
      facts.addresses,
    );
    collectLabeled(block.text, block.location, /\b(?:prepared\s+for|customer|client|insured|owner|from|contractor)\s*:\s*([^\n]{2,80})/gi, facts.parties);
    collectLabeled(block.text, block.location, /\bclaim\s*(?:number|no|#)?\s*[:#]?\s*([A-Z0-9-]{4,})/gi, facts.claimNumbers);
    collectRooms(block.text, block.location, facts.rooms);
  }
  facts.totals = uniqueFacts(facts.totals).slice(0, 8);
  facts.lineItems = uniqueFacts(facts.lineItems).slice(0, 40);
  facts.dates = uniqueFacts(facts.dates).slice(0, 8);
  facts.addresses = uniqueFacts(facts.addresses).slice(0, 6);
  facts.parties = uniqueFacts(facts.parties).slice(0, 8);
  facts.claimNumbers = uniqueFacts(facts.claimNumbers).slice(0, 4);
  facts.rooms = uniqueRooms(facts.rooms).slice(0, 30);
  return facts;
}

export function summarizeDocument(kind: DocumentKind, facts: DocumentFacts, text: string): string {
  const bits: string[] = [];
  if (facts.addresses[0]) bits.push(facts.addresses[0].value);
  const total = facts.totals.find((row) => /total/i.test(row.label)) ?? facts.totals[0];
  if (total) bits.push(`${total.label} ${total.value}`);
  if (facts.rooms.length) bits.push(facts.rooms.slice(0, 4).map((room) => room.name).join(', '));
  if (facts.claimNumbers[0]) bits.push(`Claim ${facts.claimNumbers[0].value}`);
  const head = KIND_LABEL[kind];
  if (!bits.length) {
    const sentence = text.replace(/\s+/g, ' ').slice(0, 160);
    return `${head}. ${sentence}`.slice(0, 280);
  }
  return `${head}. ${bits.join('. ')}.`.slice(0, 280);
}

export function decideRelevance(input: {
  facts: DocumentFacts;
  text: string;
  filename: string;
  /** The job the file was uploaded into, if any. */
  job: JobMatchProfile | null;
  /** Other jobs in the org, used only when the upload is outside a job. */
  candidates: JobMatchProfile[];
}): RelevanceDecision {
  if (input.job) {
    const scored = scoreJob(input, input.job);
    if (scored.score >= 0.5) {
      return {
        verdict: 'related',
        score: scored.score,
        reason: scored.reason,
        suggestedJobId: null,
        attach: true,
      };
    }
    return {
      verdict: 'not_related',
      score: scored.score,
      reason: scored.reason || 'Not enough of this document matches the job on screen, so it was not attached.',
      suggestedJobId: null,
      attach: false,
    };
  }
  let best: { job: JobMatchProfile; score: number; reason: string } | null = null;
  for (const job of input.candidates) {
    const scored = scoreJob(input, job);
    if (!best || scored.score > best.score) best = { job, score: scored.score, reason: scored.reason };
  }
  if (best && best.score >= 0.5) {
    const title = best.job.title?.trim() || 'a job';
    return {
      verdict: 'pending_confirm',
      score: best.score,
      reason: `This looks like ${title}. ${best.reason} Attach it only after you confirm.`,
      suggestedJobId: best.job.id,
      attach: false,
    };
  }
  return {
    verdict: 'not_related',
    score: best?.score ?? 0,
    reason: 'No open job matches this document, so it was not attached.',
    suggestedJobId: null,
    attach: false,
  };
}

function scoreJob(input: { facts: DocumentFacts; text: string; filename: string }, job: JobMatchProfile): { score: number; reason: string } {
  let score = 0;
  const reasons: string[] = [];
  const address = input.facts.addresses[0]?.value ?? '';
  if (address && job.address && addressesMatch(address, job.address)) {
    score += 0.6;
    reasons.push(`The address ${address} matches this job.`);
  } else if (address && job.address && !addressesMatch(address, job.address)) {
    score -= 0.2;
    reasons.push(`The address ${address} does not match this job.`);
  }
  const claim = input.facts.claimNumbers[0]?.value ?? '';
  if (claim && job.claimNumber && claim.toLowerCase() === job.claimNumber.toLowerCase()) {
    score += 0.55;
    reasons.push(`Claim ${claim} matches this job.`);
  }
  const titleHits = tokenOverlap(`${job.title ?? ''} ${job.customerName ?? ''}`, `${input.text}\n${input.filename}`);
  if (titleHits >= 2) {
    score += 0.35;
    reasons.push('The name on the document matches this job.');
  } else if (titleHits === 1) {
    score += 0.15;
  }
  const scopeHits = tokenOverlap(job.scopeText ?? job.description ?? '', input.text);
  if (scopeHits >= 2) {
    score += 0.2;
    reasons.push('The scope lines overlap this job.');
  }
  if (!reasons.length) reasons.push('Nothing on the document matches the job name, address, or claim.');
  return { score: Math.max(0, Math.min(1, score)), reason: reasons[0]! };
}

export function addressesMatch(left: string, right: string): boolean {
  const a = normalizeAddress(left);
  const b = normalizeAddress(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const aNum = a.match(/\d{1,6}/)?.[0];
  const bNum = b.match(/\d{1,6}/)?.[0];
  if (!aNum || aNum !== bNum) return false;
  const aStreet = a.replace(aNum, '').trim().split(' ').filter((word) => word.length > 2);
  const bStreet = b.replace(bNum, '').trim().split(' ').filter((word) => word.length > 2);
  return aStreet.some((word) => bStreet.includes(word));
}

function normalizeAddress(value: string): string {
  return value
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\bstreet\b/g, 'st')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\broad\b/g, 'rd')
    .replace(/\bdrive\b/g, 'dr')
    .replace(/\blane\b/g, 'ln')
    .replace(/\bboulevard\b/g, 'blvd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenOverlap(left: string, right: string): number {
  const stop = new Set(['the', 'and', 'for', 'job', 'this', 'that', 'with', 'from']);
  const words = new Set(
    left.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !stop.has(word)),
  );
  if (!words.size) return 0;
  const hay = right.toLowerCase();
  let hits = 0;
  for (const word of words) if (hay.includes(word)) hits += 1;
  return hits;
}

function collectTotals(text: string, location: string, into: QuotedFact[]) {
  const re = /((?:grand\s+)?total|amount\s+due|balance\s+due)\s*[:\-]\s*(\$[\d,]+(?:\.\d{2})?)/gi;
  for (const match of text.matchAll(re)) {
    const quote = match[0]!.replace(/\s+/g, ' ').trim();
    if (!text.includes(match[0]! ) && !text.includes(quote)) continue;
    const exact = text.includes(match[0]!) ? match[0]!.trim() : quote;
    into.push({ label: titleCase(match[1]!), value: match[2]!, quote: exact, location });
  }
}

function collectLineItems(text: string, location: string, into: QuotedFact[]) {
  for (const line of text.split('\n')) {
    const match = line.match(/^(.{3,80}?)\s+(\$[\d,]+(?:\.\d{2})?)\s*$/);
    if (!match) continue;
    const quote = line.trim();
    if (/^total\b/i.test(match[1]!.trim())) continue;
    into.push({ label: match[1]!.trim(), value: match[2]!, quote, location });
  }
}

function collectMatches(text: string, location: string, re: RegExp, label: string, into: QuotedFact[]) {
  for (const match of text.matchAll(re)) {
    const quote = match[0]!.trim();
    if (quote) into.push({ label, value: quote, quote, location });
  }
}

function collectLabeled(text: string, location: string, re: RegExp, into: QuotedFact[]) {
  for (const match of text.matchAll(re)) {
    const value = (match[1] ?? '').trim().replace(/[.,;]+$/, '');
    const quote = match[0]!.trim();
    if (value && text.includes(quote)) into.push({ label: value, value, quote, location });
  }
}

function collectRooms(text: string, location: string, into: RoomFact[]) {
  const re = /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\s+(\d{1,3}\s*(?:'|ft|feet)\s*[x×]\s*\d{1,3}(?:\s*(?:'|ft|feet))?)/g;
  for (const match of text.matchAll(re)) {
    const name = match[1]!.trim();
    if (/^(Total|Page|Sheet|Date)$/.test(name)) continue;
    const quote = match[0]!.trim();
    into.push({
      name,
      dimensions: match[2]!.replace(/\s+/g, ' ').trim(),
      notes: null,
      quote,
      sourceLocation: location,
    });
  }
}

function uniqueFacts(rows: QuotedFact[]): QuotedFact[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.quote.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueRooms(rows: RoomFact[]): RoomFact[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function titleCase(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/\b\w/g, (ch) => ch.toUpperCase());
}
