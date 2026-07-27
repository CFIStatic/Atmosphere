import type { CrmJob, JobMatch, MatchResult, MatchSignal, ScanProject } from '../types.js';

/**
 * Tying a 3D scan to the right CRM job.
 *
 * This is the step where the agent can do real damage. Building an estimate off
 * the wrong job means a carrier receives someone else's loss under this claim
 * number, so the matcher is deliberately conservative: it scores every
 * candidate on independent signals, and it refuses to auto-select unless the
 * winner is both strong on its own terms and clearly ahead of the runner-up.
 *
 * Signals are weighted by how hard they are to collide by accident. A claim
 * number is issued per loss and is nearly unique; a street address is shared by
 * everyone at that address across every loss they have ever had; a surname is
 * shared by strangers. Weighting them equally would let two weak agreements
 * outvote one decisive disagreement.
 */

/** A candidate must reach this to be auto-selected. */
export const AUTO_MATCH_THRESHOLD = 70;
/** …and must beat the runner-up by this much, so near-ties always get a human. */
export const AUTO_MATCH_MARGIN = 20;

const WEIGHTS = {
  claimNumber: 45,
  policyNumber: 20,
  address: 20,
  insuredName: 10,
  lossDate: 5,
} as const;

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

/** Claim numbers pick up spaces, dashes, and case between systems. */
function normaliseIdentifier(value: string | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * US street suffixes and directionals, so "123 N. Maple Street" and
 * "123 North Maple St" compare equal. Without this, address agreement is
 * mostly a coin flip between two systems that were typed into separately.
 */
const STREET_ABBREVIATIONS: Record<string, string> = {
  street: 'st',
  avenue: 'ave',
  boulevard: 'blvd',
  drive: 'dr',
  road: 'rd',
  lane: 'ln',
  court: 'ct',
  circle: 'cir',
  place: 'pl',
  terrace: 'ter',
  parkway: 'pkwy',
  highway: 'hwy',
  trail: 'trl',
  north: 'n',
  south: 's',
  east: 'e',
  west: 'w',
  northeast: 'ne',
  northwest: 'nw',
  southeast: 'se',
  southwest: 'sw',
  apartment: 'apt',
  suite: 'ste',
  unit: 'unit',
};

export function normaliseAddress(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => STREET_ABBREVIATIONS[token] ?? token)
    .join(' ')
    .trim();
}

export function normaliseName(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .trim();
}

/**
 * Sørensen–Dice on character bigrams: tolerant of typos and word order, and
 * cheap enough to run across every candidate. Better here than an edit distance
 * because "Maple St" vs "St Maple" should still score well.
 */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

  const bigrams = (value: string): Map<string, number> => {
    const counts = new Map<string, number>();
    for (let i = 0; i < value.length - 1; i += 1) {
      const pair = value.slice(i, i + 2);
      counts.set(pair, (counts.get(pair) ?? 0) + 1);
    }
    return counts;
  };

  const left = bigrams(a);
  const right = bigrams(b);

  let shared = 0;
  for (const [pair, count] of left) {
    const other = right.get(pair);
    if (other) shared += Math.min(count, other);
  }

  return (2 * shared) / (a.length - 1 + (b.length - 1));
}

/** Whole days between two dates, or null when either is unparseable. */
function daysApart(a: string | undefined, b: string | undefined): number | null {
  if (!a || !b) return null;
  const left = Date.parse(a);
  const right = Date.parse(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return Math.abs(left - right) / 86_400_000;
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

function scoreIdentifier(
  field: string,
  weight: number,
  scanValue: string | undefined,
  jobValue: string | undefined,
): MatchSignal | null {
  const scan = normaliseIdentifier(scanValue);
  const job = normaliseIdentifier(jobValue);
  if (!scan || !job) return null;

  if (scan === job) {
    return { field, weight, score: 1, detail: `${field} matches exactly (${jobValue})` };
  }

  // Systems truncate long claim numbers differently, so a containment match is
  // worth partial credit — but only partial, because a prefix can collide.
  if (scan.length >= 6 && (scan.includes(job) || job.includes(scan))) {
    return { field, weight, score: 0.6, detail: `${field} partially matches (${jobValue})` };
  }

  return { field, weight, score: 0, detail: `${field} differs (scan ${scanValue}, job ${jobValue})` };
}

function scoreAddress(scan: ScanProject, job: CrmJob): MatchSignal | null {
  const scanStreet = normaliseAddress(scan.address.street);
  const jobStreet = normaliseAddress(job.address.street);
  if (!scanStreet || !jobStreet) return null;

  let score = similarity(scanStreet, jobStreet);

  // The house number is the part of an address that actually distinguishes
  // neighbours, so a mismatch there caps the score no matter how well the
  // street name agrees.
  const scanNumber = scanStreet.match(/^\d+/)?.[0];
  const jobNumber = jobStreet.match(/^\d+/)?.[0];
  if (scanNumber && jobNumber && scanNumber !== jobNumber) score = Math.min(score, 0.3);

  // Agreeing postal codes raise confidence; disagreeing ones are decisive.
  const scanZip = normaliseIdentifier(scan.address.postalCode);
  const jobZip = normaliseIdentifier(job.address.postalCode);
  if (scanZip && jobZip) {
    if (scanZip === jobZip) score = Math.min(1, score + 0.15);
    else score = Math.min(score, 0.2);
  }

  return {
    field: 'address',
    weight: WEIGHTS.address,
    score: Math.max(0, Math.min(1, score)),
    detail: `address "${job.address.street ?? '—'}" vs scan "${scan.address.street ?? '—'}"`,
  };
}

function scoreName(scan: ScanProject, job: CrmJob): MatchSignal | null {
  const scanName = normaliseName(scan.insuredName);
  const jobName = normaliseName(job.insuredName);
  if (!scanName || !jobName) return null;

  const whole = similarity(scanName, jobName);

  // Surnames survive the "Bob"/"Robert" and "Smith Family Trust" variations
  // that wreck a full-string comparison, so the better of the two wins.
  const surname = (value: string) => value.split(' ').at(-1) ?? '';
  const surnameScore = similarity(surname(scanName), surname(jobName));

  return {
    field: 'insuredName',
    weight: WEIGHTS.insuredName,
    score: Math.max(whole, surnameScore * 0.9),
    detail: `insured "${job.insuredName}" vs scan "${scan.insuredName}"`,
  };
}

function scoreLossDate(scan: ScanProject, job: CrmJob): MatchSignal | null {
  const gap = daysApart(scan.lossDate ?? scan.capturedAt, job.lossDate);
  if (gap === null) return null;

  // A scan happens after the loss, usually within a couple of weeks. Decay to
  // zero over 30 days rather than cutting off sharply — a slow first notice of
  // loss is common and should weaken the signal, not eliminate the candidate.
  const score = Math.max(0, 1 - gap / 30);
  return {
    field: 'lossDate',
    weight: WEIGHTS.lossDate,
    score,
    detail: `loss date ${job.lossDate} is ${Math.round(gap)} day(s) from the scan`,
  };
}

/** Score one candidate job against the scan. */
export function scoreJob(scan: ScanProject, job: CrmJob): JobMatch {
  const signals = [
    scoreIdentifier('claimNumber', WEIGHTS.claimNumber, scan.claimNumber, job.claimNumber),
    scoreIdentifier('policyNumber', WEIGHTS.policyNumber, scan.policyNumber, job.policyNumber),
    scoreAddress(scan, job),
    scoreName(scan, job),
    scoreLossDate(scan, job),
  ].filter((signal): signal is MatchSignal => signal !== null);

  // Normalise by the weight actually available. A scan carrying no claim number
  // must still be able to reach a high score on address and name alone —
  // otherwise the absence of a field reads as disagreement.
  const availableWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const earned = signals.reduce((sum, s) => sum + s.weight * s.score, 0);
  const score = availableWeight === 0 ? 0 : (earned / availableWeight) * 100;

  return { job, score: Math.round(score * 10) / 10, signals };
}

/**
 * Pick the job, or decline to.
 *
 * `needsReview` is the whole point of the return value: the pipeline pauses on
 * it rather than proceeding on a guess.
 */
export function matchJob(scan: ScanProject, candidates: CrmJob[]): MatchResult {
  if (candidates.length === 0) {
    return {
      best: null,
      runnerUp: null,
      needsReview: true,
      reason: 'No CRM jobs matched this scan — search by claim number or address and pick one.',
    };
  }

  const ranked = candidates
    .map((job) => scoreJob(scan, job))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0]!;
  const runnerUp = ranked[1] ?? null;

  // A decisive claim-number agreement stands on its own: it is the one
  // identifier issued per loss, and demanding a margin over a near-duplicate
  // record would send every re-opened claim to a human for no benefit.
  const claimSignal = best.signals.find((s) => s.field === 'claimNumber');
  if (claimSignal?.score === 1) {
    return {
      best,
      runnerUp,
      needsReview: false,
      reason: `Claim number ${best.job.claimNumber} matches exactly.`,
    };
  }

  if (best.score < AUTO_MATCH_THRESHOLD) {
    return {
      best,
      runnerUp,
      needsReview: true,
      reason: `Best candidate scored ${best.score}, below the ${AUTO_MATCH_THRESHOLD} needed to select a job automatically.`,
    };
  }

  const margin = runnerUp ? best.score - runnerUp.score : Number.POSITIVE_INFINITY;
  if (margin < AUTO_MATCH_MARGIN) {
    return {
      best,
      runnerUp,
      needsReview: true,
      reason: `Two jobs scored within ${Math.round(margin)} points of each other — confirm which one is right.`,
    };
  }

  return {
    best,
    runnerUp,
    needsReview: false,
    reason: `Matched on ${best.signals
      .filter((s) => s.score > 0.7)
      .map((s) => s.field)
      .join(', ')}.`,
  };
}
