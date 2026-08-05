/**
 * Where to point the camera, and in what order.
 *
 * The verification pipeline is only as strong as the footage it gets, and the
 * single highest-leverage instruction is the first one: start outside, facing
 * the front of the building. An opening shot that establishes the property is
 * what lets the location check, the identity of the site, and the day-to-day
 * comparison all anchor to something — footage that opens on a bare wall
 * could be any wall in any building, and every check downstream of that is
 * weaker for it.
 *
 * The guide is built from the job's scope, and it deliberately includes the
 * exclusions: walking past a DO-NOT area untouched, on camera, is the
 * cheapest liability protection a crew will ever record. The day somebody
 * asks "did you touch the skylights", the answer is a timestamped pan of
 * intact skylights.
 *
 * Pure, because the ordering rules are product decisions worth testing:
 * anchor first, work areas next, exclusions before the wrap, and wording that
 * changes with the phase — a before films what you are about to do, an after
 * films what you did.
 */

export interface GuideScopeItem {
  title: string;
  state: 'included' | 'excluded' | 'proposed' | 'approved' | 'declined';
  reason?: string | null;
}

export type StepKind = 'anchor' | 'scope' | 'exclusion' | 'wrap';

export interface CaptureStep {
  kind: StepKind;
  instruction: string;
  why: string;
}

export interface CaptureGuide {
  phase: 'before' | 'after';
  steps: CaptureStep[];
  /** A realistic total, so "39 seconds for an 8-hour day" is visibly short. */
  targetSeconds: number;
}

export function buildCaptureGuide(input: {
  phase: 'before' | 'after';
  scope: GuideScopeItem[];
}): CaptureGuide {
  const { phase } = input;
  const steps: CaptureStep[] = [];

  // 1. The anchor. Always first, phase-independent, non-negotiable.
  steps.push({
    kind: 'anchor',
    instruction:
      'Start outside, facing the front of the building. Hold steady for a few seconds — get the house number, the mailbox, or anything that makes the property unmistakable.',
    why:
      'The first thing verification does is prove this footage is this site. A video that opens indoors could be any building anywhere, and every check after that is weaker for it.',
  });

  // 2. The work. Included and approved lines are what the day is for.
  //    Proposed lines are deliberately absent: they are not cleared to start,
  //    and a filming guide that mentions them reads as permission.
  const work = input.scope.filter((s) => s.state === 'included' || s.state === 'approved');
  for (const line of work) {
    steps.push({
      kind: 'scope',
      instruction:
        phase === 'before'
          ? `Walk the area for “${line.title}” before touching it. Slow pan, arm's length, corners included.`
          : `Show the finished state of “${line.title}”. Slow pan across the whole area — the edges matter more than the middle.`,
      why:
        phase === 'before'
          ? 'The before is the baseline the after gets compared against. An area skipped now cannot show change later.'
          : 'The comparison can only credit what it can see. Work off-camera reads as work not done.',
    });
  }

  // 3. The exclusions — filmed untouched. This is protection, not busywork.
  for (const line of input.scope.filter((s) => s.state === 'excluded')) {
    steps.push({
      kind: 'exclusion',
      instruction: `Pass the excluded area — “${line.title}” — and film it untouched.${
        line.reason ? ` (${line.reason})` : ''
      }`,
      why:
        'The day somebody asks whether you touched it, the answer is this timestamped pan of it intact.',
    });
  }

  // 4. The wrap.
  steps.push({
    kind: 'wrap',
    instruction:
      phase === 'before'
        ? 'Finish on anything unexpected you found — damage, water, access problems. Keep location on for the whole clip.'
        : 'Finish on any meter or reading in use — numbers on camera count as documentation. Then stop recording before you leave the site.',
    why:
      phase === 'before'
        ? 'A surprise filmed at 7am is a change order. The same surprise mentioned at 5pm is an argument.'
        : 'A reading in the video is evidence; a reading remembered later is a claim.',
  });

  // Pacing: the anchor and wrap take ~15s each; a work area deserves ~20s of
  // slow pan; an exclusion needs ~8s of walking past. Floored at 45s because
  // no honest day fits under that, capped at 5 minutes because nobody watches
  // more and the upload has to survive a truck's signal.
  const targetSeconds = Math.min(
    300,
    Math.max(45, 30 + work.length * 20 + (steps.filter((s) => s.kind === 'exclusion').length) * 8),
  );

  return { phase, steps, targetSeconds };
}
