import type { CarrierId, CarrierIdentification, ProgramId } from './types.js';
import type { LossAssessment } from '../types.js';

/**
 * Working out who the estimate is for.
 *
 * The carrier decides the terms, so getting this wrong is not a cosmetic error —
 * it applies the wrong price list, the wrong O&P rule and the wrong equipment
 * cap to the whole job. The identification therefore reports **how** it knows,
 * and refuses to pick when the sources disagree.
 *
 * Two things are being identified, and they are not the same:
 *
 *   - the **carrier**, who ultimately pays; and
 *   - the **program** the job came through, which is what actually carries the
 *     terms. A franchise usually reaches a carrier through a TPA or a national
 *     account, and the same carrier can pay differently depending on which
 *     network assigned the job.
 */

interface CarrierEntry {
  id: CarrierId;
  name: string;
  /** Lowercase substrings that identify this carrier in free text. */
  aliases: string[];
  /** Default program when nothing else identifies one. Often null — ask. */
  defaultProgramId?: ProgramId;
}

/**
 * Carriers commonly seen on residential water losses.
 *
 * Deliberately a *starting* list held as data, not an exhaustive registry.
 * Orgs add their own through estimator settings; an unrecognised carrier is
 * reported as unknown rather than forced into the nearest match, because a wrong
 * carrier is worse than no carrier.
 */
export const CARRIERS: CarrierEntry[] = [
  { id: 'state_farm', name: 'State Farm', aliases: ['state farm', 'statefarm', 'state farm fire', 'sf fire and casualty'] },
  { id: 'allstate', name: 'Allstate', aliases: ['allstate', 'all state'] },
  { id: 'usaa', name: 'USAA', aliases: ['usaa'] },
  { id: 'farmers', name: 'Farmers Insurance', aliases: ['farmers insurance', 'farmers ins', 'farmers group'] },
  { id: 'liberty_mutual', name: 'Liberty Mutual', aliases: ['liberty mutual', 'libertymutual', 'liberty ins'] },
  { id: 'nationwide', name: 'Nationwide', aliases: ['nationwide'] },
  { id: 'travelers', name: 'Travelers', aliases: ['travelers', 'traveler’s', "traveler's"] },
  { id: 'american_family', name: 'American Family', aliases: ['american family', 'amfam'] },
  { id: 'erie', name: 'Erie Insurance', aliases: ['erie insurance', 'erie ins'] },
  { id: 'chubb', name: 'Chubb', aliases: ['chubb'] },
  { id: 'progressive', name: 'Progressive', aliases: ['progressive'] },
  { id: 'geico', name: 'GEICO', aliases: ['geico'] },
  { id: 'the_hartford', name: 'The Hartford', aliases: ['the hartford', 'hartford ins', 'hartford financial'] },
  { id: 'auto_owners', name: 'Auto-Owners', aliases: ['auto-owners', 'auto owners'] },
  { id: 'cincinnati', name: 'Cincinnati Insurance', aliases: ['cincinnati insurance', 'cincinnati fin'] },
  { id: 'citizens', name: 'Citizens Property Insurance', aliases: ['citizens property', 'citizens insurance'] },
];

interface ProgramEntry {
  id: ProgramId;
  name: string;
  aliases: string[];
}

/**
 * Assignment networks and third-party administrators.
 *
 * These are the routes a franchise receives work through. Which one applies
 * changes the terms even when the carrier does not, which is why it is
 * identified separately and why an unidentified program is reported rather than
 * assumed.
 */
export const PROGRAMS: ProgramEntry[] = [
  { id: 'contractor_connection', name: 'Contractor Connection', aliases: ['contractor connection', 'contractor connect', 'crawford contractor'] },
  { id: 'alacrity', name: 'Alacrity Solutions', aliases: ['alacrity'] },
  { id: 'sedgwick', name: 'Sedgwick', aliases: ['sedgwick'] },
  { id: 'crawford', name: 'Crawford & Company', aliases: ['crawford and company', 'crawford & co', 'crawford co'] },
  { id: 'innovation', name: 'Innovation Property Restoration Network', aliases: ['innovation network', 'iprn'] },
  { id: 'national_account', name: 'National account (direct)', aliases: ['national account', 'direct assignment', 'preferred vendor'] },
];

/** Claim-number shapes that identify a carrier on their own. Conservative. */
const CLAIM_PATTERNS: Array<{ pattern: RegExp; carrierId: CarrierId; note: string }> = [
  // State Farm residential claims are conventionally NN-XXXX-XXX.
  { pattern: /^\d{2}-[A-Z0-9]{4}-[A-Z0-9]{3}$/i, carrierId: 'state_farm', note: 'claim number matches the State Farm NN-XXXX-XXX shape' },
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s&'’-]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Find every carrier whose alias appears in the text, longest alias first. */
function matchCarriers(text: string): Array<{ entry: CarrierEntry; alias: string }> {
  const haystack = normalize(text);
  const hits: Array<{ entry: CarrierEntry; alias: string }> = [];

  for (const entry of CARRIERS) {
    // Longest alias first so "state farm fire" is preferred over "state farm".
    const alias = [...entry.aliases].sort((a, b) => b.length - a.length).find((a) => haystack.includes(a));
    if (alias) hits.push({ entry, alias });
  }
  return hits;
}

function matchProgram(text: string): ProgramEntry | undefined {
  const haystack = normalize(text);
  return PROGRAMS.find((entry) => entry.aliases.some((alias) => haystack.includes(alias)));
}

export interface IdentifyOptions {
  /** Extra carriers the org works with, merged over the built-in list. */
  extraCarriers?: CarrierEntry[];
  /** Forced answer from a human. Always wins, and is recorded as `stated`. */
  override?: { carrierId?: CarrierId; programId?: ProgramId };
}

/**
 * Identify the carrier and program for a loss.
 *
 * Precedence runs: a human override, then the dedicated carrier field a source
 * populated, then free text. The distinction between the last two is preserved
 * in `confidence` because it changes what a reviewer should do — a name read out
 * of a technician's prose deserves a glance before the estimate goes out.
 */
export function identifyCarrier(
  assessment: LossAssessment,
  options: IdentifyOptions = {},
): CarrierIdentification {
  const registry = [...CARRIERS, ...(options.extraCarriers ?? [])];
  const basis: string[] = [];

  /* ---- Human override wins outright ---- */
  if (options.override?.carrierId) {
    const entry = registry.find((c) => c.id === options.override!.carrierId);
    const program = PROGRAMS.find((p) => p.id === options.override?.programId);
    return {
      carrierId: options.override.carrierId,
      carrierName: entry?.name ?? options.override.carrierId,
      programId: program?.id ?? options.override.programId ?? null,
      programName: program?.name ?? null,
      confidence: 'stated',
      basis: ['set by hand on this job'],
      alternatives: [],
    };
  }

  /* ---- The dedicated field, if a source filled it ---- */
  const stated = assessment.carrier?.trim();
  const statedHits = stated ? matchCarriers(stated) : [];

  /* ---- Free text: notes, photo captions, room notes ---- */
  const freeText = [
    ...assessment.evidence.filter((e) => e.kind === 'note' || e.kind === 'photo').map((e) => e.description),
    ...assessment.rooms.map((r) => r.notes ?? ''),
  ].join('\n');

  const textHits = matchCarriers(freeText);
  const programText = [stated ?? '', freeText].join('\n');
  const program = matchProgram(programText);

  /* ---- Claim-number shape ---- */
  const claim = assessment.claimNumber?.trim();
  const patternHit = claim
    ? CLAIM_PATTERNS.find((p) => p.pattern.test(claim))
    : undefined;

  /* ---- Resolve ---- */

  let carrierId: CarrierId | null = null;
  let carrierName: string | null = null;
  let confidence: CarrierIdentification['confidence'] = 'unknown';

  if (statedHits.length > 0) {
    carrierId = statedHits[0].entry.id;
    carrierName = statedHits[0].entry.name;
    confidence = 'stated';
    basis.push(`the carrier field read "${stated}"`);
  } else if (stated) {
    // A carrier field was populated with something we do not recognise. That is
    // *more* informative than silence, not less — the name is real, we simply do
    // not have terms for it, so it is surfaced with its own message.
    carrierName = stated;
    confidence = 'unknown';
    basis.push(`the carrier field read "${stated}", which is not in the carrier registry`);
  } else if (textHits.length > 0) {
    carrierId = textHits[0].entry.id;
    carrierName = textHits[0].entry.name;
    confidence = 'inferred';
    basis.push(`"${textHits[0].alias}" appeared in the notes or a photo caption`);
  } else if (patternHit) {
    const entry = registry.find((c) => c.id === patternHit.carrierId);
    carrierId = patternHit.carrierId;
    carrierName = entry?.name ?? patternHit.carrierId;
    confidence = 'inferred';
    basis.push(patternHit.note);
  }

  // A claim-number shape that disagrees with the named carrier is worth saying
  // out loud rather than silently preferring one of them.
  if (patternHit && carrierId && patternHit.carrierId !== carrierId) {
    basis.push(
      `note: the claim number shape suggests ${patternHit.carrierId.replace(/_/g, ' ')}, which disagrees with the carrier named on the job`,
    );
  }

  if (program) basis.push(`assignment network identified as ${program.name}`);

  /* ---- Alternatives ---- */
  const alternatives = [...statedHits, ...textHits]
    .filter(({ entry }) => entry.id !== carrierId)
    .map(({ entry, alias }) => ({
      carrierId: entry.id,
      carrierName: entry.name,
      basis: `"${alias}" also appears in the sources`,
    }))
    .filter((alt, index, all) => all.findIndex((a) => a.carrierId === alt.carrierId) === index);

  return {
    carrierId,
    carrierName,
    programId: program?.id ?? null,
    programName: program?.name ?? null,
    confidence,
    basis,
    alternatives,
  };
}
