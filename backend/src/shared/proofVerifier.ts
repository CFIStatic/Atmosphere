/**
 * Proof of work, and how much of it is actually proof.
 *
 * A subcontractor films the site before they start and again when they finish,
 * every day they are on the job. The general contractor gets a record of what
 * happened, and money moves against it.
 *
 * That last clause is why this file exists and why it is careful. The moment a
 * video releases a payment, the video is worth money, and the obvious ways to
 * cheat are all cheap:
 *
 *   Film a different house.               Somewhere the crew is genuinely working.
 *   Re-upload yesterday's "after".        As today's "before". Nothing changed, so it matches.
 *   Film at 7am, upload at 7pm.           Claim a full day that was two hours.
 *   Film four seconds of a clean room.    Technically a video.
 *   Film the after first.                 Then do a smaller job than the footage implies.
 *
 * Every one of those is checkable against facts the upload already carries —
 * position, capture time, byte hash, duration, order. So this checks them, and
 * reports each as a separate finding rather than a score.
 *
 * The distinction that runs through the whole file: **verified** and **not
 * contradicted** are different claims. A video with no location data is not
 * suspicious; it is unproven, and saying "verified" about it would be the
 * single most damaging thing this feature could do. Every check can come back
 * `unknown`, and unknown never counts as a pass.
 */

export type CheckVerdict = 'pass' | 'fail' | 'unknown';

export interface ProofCheck {
  key: string;
  verdict: CheckVerdict;
  /** What was actually established, in words that survive being quoted. */
  detail: string;
}

export interface ProofUpload {
  id: string;
  phase: 'before' | 'after';
  /** The work day this is filed against, as YYYY-MM-DD in the site's timezone. */
  workDate: string;
  /** When the device says it was filmed. */
  capturedAt: string | null;
  /** When the server received it. Not forgeable. */
  receivedAt: string;
  durationSeconds: number | null;
  /** SHA-256 of the file. The same bytes twice is the cheapest fraud there is. */
  contentHash: string | null;
  lat: number | null;
  lon: number | null;
  accuracyM: number | null;
}

export interface SiteLocation {
  lat: number;
  lon: number;
}

export interface VerifyOptions {
  /** How far from the site still counts as on it. A large lot is a big number. */
  radiusMiles?: number;
  /** Below this, a clip is a gesture rather than a record. */
  minSeconds?: number;
  /** Uploading a day later is normal on a bad signal; a week later is not. */
  maxUploadLagHours?: number;
  /** Hashes already seen on this job, to catch a re-upload. */
  seenHashes?: Set<string>;
}

const DEFAULTS = {
  radiusMiles: 0.25,
  minSeconds: 20,
  maxUploadLagHours: 36,
};

/** Great-circle miles between two points. */
export function milesBetween(a: SiteLocation, b: SiteLocation): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The calendar date of a timestamp, in UTC. */
function dateOf(iso: string | null): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return new Date(at).toISOString().slice(0, 10);
}

function hoursBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const x = Date.parse(a);
  const y = Date.parse(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return (y - x) / 3_600_000;
}

/**
 * Check one upload against everything knowable about it.
 *
 * Returns findings, not a verdict. A general contractor deciding whether to pay
 * wants to know *which* thing could not be established — "no location on the
 * file" and "filmed two miles away" both stop a payment, and they are entirely
 * different conversations with the sub.
 */
export function verifyProof(
  upload: ProofUpload,
  site: SiteLocation | null,
  options: VerifyOptions = {},
): ProofCheck[] {
  const radius = options.radiusMiles ?? DEFAULTS.radiusMiles;
  const minSeconds = options.minSeconds ?? DEFAULTS.minSeconds;
  const maxLag = options.maxUploadLagHours ?? DEFAULTS.maxUploadLagHours;
  const checks: ProofCheck[] = [];

  // Where. The single most useful check, and the one most often unavailable —
  // phones withhold location when the permission was declined, and that is a
  // missing fact rather than a lie.
  if (!site) {
    checks.push({
      key: 'on_site',
      verdict: 'unknown',
      detail: 'No location on file for the job site, so nothing can be checked against it.',
    });
  } else if (upload.lat === null || upload.lon === null) {
    checks.push({
      key: 'on_site',
      verdict: 'unknown',
      detail: 'The video carries no location. Ask them to allow location in the app.',
    });
  } else {
    const miles = milesBetween(site, { lat: upload.lat, lon: upload.lon });
    // A poor fix is not evidence of anything. Widening the radius by the
    // reported accuracy stops a legitimate video failing because the phone was
    // indoors and the fix was to the nearest cell tower.
    const slack = (upload.accuracyM ?? 0) / 1609.34;
    checks.push(
      miles <= radius + slack
        ? {
            key: 'on_site',
            verdict: 'pass',
            detail: `Filmed ${miles < 0.05 ? 'at' : `${miles.toFixed(2)} miles from`} the site.`,
          }
        : {
            key: 'on_site',
            verdict: 'fail',
            detail: `Filmed ${miles.toFixed(2)} miles from the site — outside the ${radius}-mile radius.`,
          },
    );
  }

  // When it was filmed, against the day it is filed for.
  const capturedDate = dateOf(upload.capturedAt);
  if (!capturedDate) {
    checks.push({
      key: 'same_day',
      verdict: 'unknown',
      detail: 'No capture time on the file, so only the upload time is known.',
    });
  } else if (capturedDate === upload.workDate) {
    checks.push({ key: 'same_day', verdict: 'pass', detail: `Filmed on ${capturedDate}.` });
  } else {
    checks.push({
      key: 'same_day',
      verdict: 'fail',
      detail: `Filmed on ${capturedDate} but filed against ${upload.workDate}.`,
    });
  }

  // How long between filming and uploading. A day on a bad signal is normal; a
  // week is a story about where the footage has been.
  const lag = hoursBetween(upload.capturedAt, upload.receivedAt);
  if (lag === null) {
    checks.push({
      key: 'uploaded_promptly',
      verdict: 'unknown',
      detail: 'No capture time, so the delay before upload cannot be measured.',
    });
  } else if (lag < -1) {
    // Filmed in the future. The device clock is wrong, which also means the
    // capture time above is not worth much.
    checks.push({
      key: 'uploaded_promptly',
      verdict: 'fail',
      detail: 'The device clock says this was filmed after it was uploaded.',
    });
  } else if (lag <= maxLag) {
    checks.push({
      key: 'uploaded_promptly',
      verdict: 'pass',
      detail: lag < 1 ? 'Uploaded straight away.' : `Uploaded ${Math.round(lag)}h after filming.`,
    });
  } else {
    checks.push({
      key: 'uploaded_promptly',
      verdict: 'fail',
      detail: `Uploaded ${Math.round(lag / 24)} days after filming.`,
    });
  }

  // Long enough to show anything.
  if (upload.durationSeconds === null) {
    checks.push({
      key: 'long_enough',
      verdict: 'unknown',
      detail: 'Length unknown.',
    });
  } else if (upload.durationSeconds >= minSeconds) {
    checks.push({
      key: 'long_enough',
      verdict: 'pass',
      detail: `${Math.round(upload.durationSeconds)} seconds.`,
    });
  } else {
    checks.push({
      key: 'long_enough',
      verdict: 'fail',
      detail: `Only ${Math.round(upload.durationSeconds)} seconds — too short to show the work.`,
    });
  }

  // The same bytes twice. Yesterday's "after" filed as today's "before" is the
  // cheapest fraud available and the easiest to catch.
  if (!upload.contentHash) {
    checks.push({
      key: 'not_a_reupload',
      verdict: 'unknown',
      detail: 'No file fingerprint, so a re-upload cannot be ruled out.',
    });
  } else if (options.seenHashes?.has(upload.contentHash)) {
    checks.push({
      key: 'not_a_reupload',
      verdict: 'fail',
      detail: 'This is byte-for-byte a video already uploaded on this job.',
    });
  } else {
    checks.push({
      key: 'not_a_reupload',
      verdict: 'pass',
      detail: 'Not a copy of anything already on this job.',
    });
  }

  return checks;
}

export interface DayVerdict {
  workDate: string;
  hasBefore: boolean;
  hasAfter: boolean;
  checks: ProofCheck[];
  /** Nothing failed and nothing important is missing. */
  complete: boolean;
  /** Something is provably wrong. Distinct from merely unproven. */
  contradicted: boolean;
  /** One line for the dashboard, and for the payment decision. */
  summary: string;
}

/**
 * A day's proof, taken as a pair.
 *
 * Some things are only checkable across the two: that the after was filmed
 * after the before, and that they are not the same file. Those are the checks
 * that matter most, because a single video proves somebody was there and a
 * matched pair is the only thing that shows work happened between them.
 */
export function verifyDay(input: {
  workDate: string;
  before: ProofUpload | null;
  after: ProofUpload | null;
  site: SiteLocation | null;
  options?: VerifyOptions;
}): DayVerdict {
  const checks: ProofCheck[] = [];
  const { before, after } = input;

  if (before) {
    checks.push(
      ...verifyProof(before, input.site, input.options).map((c) => ({
        ...c,
        key: `before.${c.key}`,
      })),
    );
  }
  if (after) {
    // The after is checked against the before's hash too, so filing the same
    // file twice in one day is caught even on a job with no history.
    const seen = new Set(input.options?.seenHashes ?? []);
    if (before?.contentHash) seen.add(before.contentHash);
    checks.push(
      ...verifyProof(after, input.site, { ...input.options, seenHashes: seen }).map((c) => ({
        ...c,
        key: `after.${c.key}`,
      })),
    );
  }

  if (before && after) {
    const b = Date.parse(before.capturedAt ?? '');
    const a = Date.parse(after.capturedAt ?? '');
    if (!Number.isFinite(b) || !Number.isFinite(a)) {
      checks.push({
        key: 'ordered',
        verdict: 'unknown',
        detail: 'Without capture times, the order of the two videos cannot be established.',
      });
    } else if (a > b) {
      const hours = (a - b) / 3_600_000;
      checks.push({
        key: 'ordered',
        verdict: 'pass',
        detail: `${hours.toFixed(1)} hours of work between the two.`,
      });
    } else {
      checks.push({
        key: 'ordered',
        verdict: 'fail',
        detail: 'The after was filmed before the before.',
      });
    }
  }

  const failed = checks.filter((c) => c.verdict === 'fail');
  const unknown = checks.filter((c) => c.verdict === 'unknown');
  const complete = Boolean(before && after) && failed.length === 0 && unknown.length === 0;

  let summary: string;
  if (!before && !after) summary = 'Nothing filed for this day.';
  else if (!before) summary = 'Only an after video — nothing to compare it against.';
  else if (!after) summary = 'Started but not finished: no after video yet.';
  else if (failed.length) summary = `${failed.length} check${failed.length === 1 ? '' : 's'} failed. Do not pay against this without asking.`;
  else if (unknown.length) summary = `Nothing contradicts it, but ${unknown.length} thing${unknown.length === 1 ? '' : 's'} could not be checked.`;
  else summary = 'Before and after both check out.';

  return {
    workDate: input.workDate,
    hasBefore: Boolean(before),
    hasAfter: Boolean(after),
    checks,
    complete,
    contradicted: failed.length > 0,
    summary,
  };
}

/**
 * Is this day's proof good enough to release money against?
 *
 * Deliberately a separate function from `verifyDay`, and deliberately strict.
 * Showing a general contractor a day that "looks fine" is one thing; telling
 * them it is safe to pay is another, and the second should refuse whenever the
 * record cannot actually carry the weight.
 *
 * Unknowns block. A missing location is not evidence of fraud, but paying
 * against a video that could have been filmed anywhere is exactly the outcome
 * this feature was built to stop.
 */
export function payable(day: DayVerdict): { ok: boolean; because: string } {
  if (!day.hasBefore || !day.hasAfter) {
    return { ok: false, because: 'A day needs both a before and an after.' };
  }
  if (day.contradicted) {
    const failed = day.checks.filter((c) => c.verdict === 'fail');
    return { ok: false, because: failed[0].detail };
  }
  const unknown = day.checks.filter((c) => c.verdict === 'unknown');
  if (unknown.length) {
    return {
      ok: false,
      because: `${unknown.length} thing${unknown.length === 1 ? '' : 's'} could not be checked — ${unknown[0].detail}`,
    };
  }
  return { ok: true, because: 'Before and after both check out on every count.' };
}
