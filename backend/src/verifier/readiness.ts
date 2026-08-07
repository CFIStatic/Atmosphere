/**
 * Is this job ready to be verified — and if not, what will that cost?
 *
 * A job file arrives one of three ways: synced from the customer's CRM, read
 * out of an uploaded scope document, or typed by somebody before the crew
 * leaves. All three are legitimate. They are not equally complete, and the
 * gaps are invisible until the moment they matter, which is after the crew
 * has driven home.
 *
 * The rule this module exists to enforce is the one the analyst already
 * follows, moved earlier in time: unknown is never a pass. If nobody gave the
 * job an address, no amount of footage establishes that the work happened at
 * the right house — so instead of discovering that in the report, the office
 * is told before the truck leaves.
 *
 * What it deliberately does NOT do is block. Filming always works. A crew
 * standing in a flooded basement must never be stopped by a missing field,
 * and evidence captured against a thin job file is still sealed, still
 * timestamped, still better than nothing. Readiness is a forecast of the
 * strongest conclusion this job can currently support, not a gate.
 */

export type IntakeSource = 'crm_sync' | 'scope_document' | 'manual';

/**
 * What the footage will be able to establish.
 *
 *   filed_only — sealed, timestamped, attributable. Nothing is judged,
 *                because there is nothing to judge it against.
 *   work_only  — the model can say which scope lines appear worked, but not
 *                that any of it happened at the right address.
 *   full       — work, place and time all carry.
 */
export type Ceiling = 'filed_only' | 'work_only' | 'full';

export type Level = 'blocked' | 'limited' | 'ready';

export interface JobFacts {
  scopeLineCount: number;
  /** Whether any scope line traces to an uploaded document rather than typing. */
  scopeFromDocument: boolean;
  hasAddress: boolean;
  /** Coordinates, without which no geofence and so no on-site check. */
  hasCoordinates: boolean;
  scheduledStart: string | null;
  /** Invited subcontractors. Zero is normal for a job your own crew films. */
  partyCount: number;
  intakeSource: IntakeSource | null;
}

export interface Gap {
  key: 'scope' | 'address' | 'coordinates' | 'schedule';
  /** What is missing, in the words the office would use. */
  what: string;
  /** The concrete consequence — a named check that will not run. */
  costs: string;
  /** The shortest path out, phrased as an action. */
  fix: string;
  severity: 'blocking' | 'weakening';
}

export interface Readiness {
  level: Level;
  ceiling: Ceiling;
  /** One sentence, safe to render alone. */
  headline: string;
  gaps: Gap[];
  /** What this job already has going for it. Shown because a list of only
   *  problems reads as broken when the job is mostly fine. */
  strengths: string[];
  source: IntakeSource | null;
}

const SOURCE_WORD: Record<IntakeSource, string> = {
  crm_sync: 'synced from your CRM',
  scope_document: 'read from an uploaded document',
  manual: 'entered by hand',
};

/**
 * Compute the forecast.
 *
 * Ordering of the gaps is by what actually costs the most: scope first,
 * because without it nothing is verified at all; then place; then time. The
 * office reads the first line and stops, so the first line has to be the
 * expensive one.
 */
export function assessReadiness(facts: JobFacts): Readiness {
  const gaps: Gap[] = [];
  const strengths: string[] = [];

  if (facts.scopeLineCount === 0) {
    gaps.push({
      key: 'scope',
      what: 'No scope of work',
      costs:
        'Footage will be sealed and filed, but nothing is judged — there is no agreed list of work to check it against.',
      fix: 'Upload the work order or estimate, or type the lines. Either one takes a minute and unlocks every verdict.',
      severity: 'blocking',
    });
  } else {
    strengths.push(
      facts.scopeFromDocument
        ? `${facts.scopeLineCount} scope ${facts.scopeLineCount === 1 ? 'line' : 'lines'}, traced to the uploaded document`
        : `${facts.scopeLineCount} scope ${facts.scopeLineCount === 1 ? 'line' : 'lines'}`,
    );
  }

  if (!facts.hasAddress) {
    gaps.push({
      key: 'address',
      what: 'No site address',
      costs: 'Every clip will read "location unknown" — the on-site check cannot run without somewhere to check against.',
      fix: 'Add the address. If the job came from your CRM, the property record may already have one.',
      severity: 'weakening',
    });
  } else if (!facts.hasCoordinates) {
    // Having the street address but no coordinates is its own state, and a
    // different fix: nothing is missing from the office's paperwork, the
    // address simply has not been resolved to a point yet.
    gaps.push({
      key: 'coordinates',
      what: 'Address not placed on the map',
      costs: 'The on-site check needs coordinates, not a street line, so it will not run and clips will read "location unknown".',
      fix: 'Confirm the address so it can be resolved to a point.',
      severity: 'weakening',
    });
  } else {
    strengths.push('Address placed, so on-site can be checked');
  }

  if (!facts.scheduledStart) {
    gaps.push({
      key: 'schedule',
      what: 'Not scheduled',
      costs:
        'The job will not appear in anyone\'s day, so a crew has to be told about it some other way.',
      fix: 'Set a start date.',
      severity: 'weakening',
    });
  } else {
    strengths.push('Scheduled, so it shows up in the crew\'s day');
  }

  if (facts.partyCount > 0) {
    strengths.push(
      `${facts.partyCount} ${facts.partyCount === 1 ? 'subcontractor' : 'subcontractors'} invited`,
    );
  }

  const blocked = gaps.some((g) => g.severity === 'blocking');
  const placeKnown = facts.hasAddress && facts.hasCoordinates;

  // The ceiling falls out of the facts rather than the gap list, so it stays
  // correct even if the wording above changes.
  const ceiling: Ceiling = blocked ? 'filed_only' : placeKnown ? 'full' : 'work_only';
  const level: Level = blocked ? 'blocked' : gaps.length ? 'limited' : 'ready';

  return {
    level,
    ceiling,
    headline: headlineFor(level, ceiling, facts),
    gaps,
    strengths,
    source: facts.intakeSource,
  };
}

function headlineFor(level: Level, ceiling: Ceiling, facts: JobFacts): string {
  const provenance = facts.intakeSource ? ` This job was ${SOURCE_WORD[facts.intakeSource]}.` : '';
  if (level === 'ready') {
    return `Ready to verify. Footage can establish the work, the place and the time.${provenance}`;
  }
  if (ceiling === 'filed_only') {
    return `Film it — the footage will be sealed and filed. Nothing will be verified yet, because this job has no scope to check against.${provenance}`;
  }
  return `Film it — the work can be verified. What is missing is the place, so clips will read "location unknown".${provenance}`;
}

/** Plain-words label for a ceiling, for a chip or a column. */
export function ceilingLabel(ceiling: Ceiling): string {
  switch (ceiling) {
    case 'full':
      return 'Work, place and time';
    case 'work_only':
      return 'Work only — no location';
    case 'filed_only':
      return 'Filed, not verified';
  }
}
