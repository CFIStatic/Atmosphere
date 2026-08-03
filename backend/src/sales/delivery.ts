/**
 * What Operations and Field are doing, said in Sales' language.
 *
 * The job a salesperson sold lives in `crm_jobs`. The work actually being
 * performed lives somewhere else entirely — `pm_projects` and its children,
 * written by the Operations board and the Field app. Phases, drying readings,
 * equipment on site, milestones, the alerts the project agent raises. Until now
 * none of it reached the person who sold the job.
 *
 * This file translates. Same discipline as workFeed.ts: pure, so the wording
 * can be tested without a database, and conservative about what it claims.
 *
 * The hard part is not fetching. It is that Operations tracks a job in a
 * vocabulary built for delivery — `phase: drying_complete`, `gpp: 41.2` — and
 * a salesperson needs to repeat it to a customer who owns a house, not a
 * drying log. "Drying finished — the affected areas are back to normal" is the
 * same fact, said to the person paying for it.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The phases a project moves through, as somebody outside the crew hears them. */
const PHASE_WORDS: Record<string, string> = {
  intake: 'Logged, not started',
  inspection: 'Inspection',
  approval: 'Waiting on carrier approval',
  scheduled: 'Scheduled',
  mitigation: 'Mitigation under way',
  drying: 'Drying',
  drying_complete: 'Drying finished',
  permitting: 'Permits',
  production: 'Rebuild under way',
  punch_list: 'Punch list',
  final_review: 'Final review',
  invoicing: 'Invoicing',
  paid: 'Paid',
};

/**
 * Roughly how far along, for a progress reading.
 *
 * Deliberately coarse and deliberately not called a percentage complete
 * anywhere a customer can see. A drying job that hits a hidden pocket of
 * moisture goes backwards, and a number that only ever climbs would be a
 * promise the work has not made.
 */
const PHASE_ORDER = [
  'intake', 'inspection', 'approval', 'scheduled',
  'mitigation', 'drying', 'drying_complete',
  'permitting', 'production', 'punch_list',
  'final_review', 'invoicing', 'paid',
];

export function phaseLabel(phase: string | null | undefined): string {
  if (!phase) return 'Not started';
  return PHASE_WORDS[phase] ?? phase.replace(/_/g, ' ');
}

/** 0–1 along the phase ladder, or null when the phase is unrecognised. */
export function phaseProgress(phase: string | null | undefined): number | null {
  if (!phase) return null;
  const at = PHASE_ORDER.indexOf(phase);
  if (at < 0) return null;
  return at / (PHASE_ORDER.length - 1);
}

export interface DryingArea {
  label: string;
  /** Latest material moisture reading, when the area has one. */
  latestPct: number | null;
  /** The dry standard this area is being taken to. */
  goalPct: number | null;
  readingAt: string | null;
}

/**
 * Where drying stands, per area.
 *
 * Readings arrive newest-first and are grouped per area, keeping only the most
 * recent — a customer asking "is my kitchen dry yet" wants today's number, not
 * a chart of the week.
 *
 * An area at or under its goal is reported as dry. Where no goal is recorded
 * this reports the reading and no verdict, rather than inventing a threshold:
 * dry standard depends on the material and the control reading, and guessing it
 * would have somebody tell a customer their floor is dry when it is not.
 */
export function dryingByArea(
  areas: Array<{ id: string; label: string | null; dry_goal_pct?: number | null }>,
  readings: Array<{ area_id: string | null; moisture_pct: number | null; taken_at?: string | null; created_at?: string | null }>,
): DryingArea[] {
  const latest = new Map<string, { pct: number | null; at: string | null }>();
  for (const reading of readings) {
    if (!reading.area_id) continue;
    if (reading.moisture_pct === null || reading.moisture_pct === undefined) continue;
    if (latest.has(reading.area_id)) continue;
    latest.set(reading.area_id, {
      pct: Number(reading.moisture_pct),
      at: reading.taken_at ?? reading.created_at ?? null,
    });
  }

  return areas.map((area) => {
    const hit = latest.get(area.id);
    return {
      label: area.label ?? 'Area',
      latestPct: hit?.pct ?? null,
      goalPct: area.dry_goal_pct ?? null,
      readingAt: hit?.at ?? null,
    };
  });
}

/** True only when there is both a reading and a goal to judge it against. */
export function areaIsDry(area: DryingArea): boolean | null {
  if (area.latestPct === null || area.goalPct === null) return null;
  return area.latestPct <= area.goalPct;
}

export interface DeliveryEvent {
  id: string;
  text: string;
  tone: 'progress' | 'money' | 'crew' | 'attention' | 'other';
  /** Which platform recorded it, so the feed can say where a line came from. */
  source: 'operations' | 'field' | 'sales';
  at: string;
}

/**
 * Turn the delivery-side rows into feed lines.
 *
 * Everything here is something an outsider would recognise as news. Internal
 * churn — an equipment rate corrected, a task reordered — is left out, because
 * a feed that reports everything is one nobody reads, and the whole value of
 * this page is that the important thing is visible without scrolling.
 */
export function deliveryEvents(input: {
  milestones?: Array<{ id: string; label: string; kind: string; completed_at: string | null; due_at: string }>;
  placements?: Array<{ id: string; area_label: string | null; placed_at: string; removed_at: string | null }>;
  readings?: Array<{ id: string; area_id: string | null; moisture_pct: number | null; taken_at?: string | null; created_at?: string | null }>;
  areas?: Array<{ id: string; label: string | null }>;
  alerts?: Array<{ id: string; title: string; severity: string; category: string; status: string; created_at: string }>;
  updates?: Array<{ id: string; audience: string; subject: string | null; status: string; sent_at: string | null; created_at: string }>;
}): DeliveryEvent[] {
  const out: DeliveryEvent[] = [];
  const areaName = new Map((input.areas ?? []).map((a) => [a.id, a.label ?? 'Area']));

  for (const milestone of input.milestones ?? []) {
    if (!milestone.completed_at) continue;
    out.push({
      id: `ms-${milestone.id}`,
      text: `${milestone.label} — done`,
      tone: milestone.kind === 'billing' ? 'money' : 'progress',
      source: 'operations',
      at: milestone.completed_at,
    });
  }

  for (const placement of input.placements ?? []) {
    const where = placement.area_label ? ` in ${placement.area_label}` : '';
    if (placement.removed_at) {
      // Equipment coming off site is the signal a customer notices and asks
      // about, so it is worth a line of its own rather than folding into the
      // phase change that usually follows it.
      out.push({
        id: `eq-out-${placement.id}`,
        text: `Equipment pulled${where}`,
        tone: 'progress',
        source: 'field',
        at: placement.removed_at,
      });
    } else {
      out.push({
        id: `eq-in-${placement.id}`,
        text: `Equipment set${where}`,
        tone: 'crew',
        source: 'field',
        at: placement.placed_at,
      });
    }
  }

  // Readings are the highest-volume thing on a drying job by an order of
  // magnitude — one per area per day, sometimes hourly. Only the most recent
  // makes the feed; the rest are summarised by dryingByArea instead of drowning
  // everything else.
  const newest = (input.readings ?? [])
    .filter((r) => r.moisture_pct !== null && r.moisture_pct !== undefined)
    .slice(0, 1);
  for (const reading of newest) {
    const where = reading.area_id ? areaName.get(reading.area_id) ?? 'an area' : 'site';
    out.push({
      id: `rd-${reading.id}`,
      text: `Moisture reading — ${where} at ${Number(reading.moisture_pct).toFixed(1)}%`,
      tone: 'progress',
      source: 'field',
      at: reading.taken_at ?? reading.created_at ?? new Date(0).toISOString(),
    });
  }

  for (const alert of input.alerts ?? []) {
    // Only what is still open and serious. A resolved warning is history the
    // office already dealt with, and surfacing it would have a salesperson
    // apologise for a problem that no longer exists.
    if (alert.status !== 'open') continue;
    if (alert.severity === 'info') continue;
    out.push({
      id: `al-${alert.id}`,
      text: alert.title,
      tone: 'attention',
      source: 'operations',
      at: alert.created_at,
    });
  }

  for (const update of input.updates ?? []) {
    if (update.status !== 'sent') continue;
    const who = update.audience === 'customer' ? 'the customer' : update.audience;
    out.push({
      id: `up-${update.id}`,
      text: `Update sent to ${who}${update.subject ? ` — ${update.subject}` : ''}`,
      tone: 'other',
      source: 'operations',
      at: update.sent_at ?? update.created_at,
    });
  }

  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * A one-line answer to "how is it going", for a job with a project behind it.
 *
 * Used at the top of a job and in a drafted customer update, which is why it
 * has to survive being read by the customer: no jargon, no percentage, and
 * nothing asserted that the readings do not support.
 */
export function deliverySentence(input: {
  phase: string | null;
  areas: DryingArea[];
  targetCompletion?: string | null;
}): string {
  const phase = phaseLabel(input.phase);
  const judged = input.areas.map(areaIsDry).filter((v): v is boolean => v !== null);
  const dry = judged.filter(Boolean).length;

  if (judged.length > 0 && dry === judged.length) {
    return `${phase} — all ${judged.length} area${judged.length === 1 ? '' : 's'} are at dry standard.`;
  }
  if (judged.length > 0) {
    return `${phase} — ${dry} of ${judged.length} areas at dry standard.`;
  }
  return phase;
}

/**
 * A customer update, written for them.
 *
 * This is the "automate the outreach" half, and the automation stops at
 * composing. The message is put in front of a person with everything filled in;
 * nothing is delivered until somebody presses send. That is a deliberate line:
 * these go to customers with live jobs, and the failure mode of an automatic
 * send is telling somebody their house is dry when a reading says otherwise.
 *
 * Written only from things that are recorded. No promises about dates that
 * are not in the plan, no "almost done", no percentage. If the delivery side
 * knows little, the draft says little, and the salesperson fills in the rest —
 * which is a better outcome than a confident paragraph nobody can stand behind.
 */
export function draftCustomerUpdate(input: {
  customerName: string | null;
  jobTitle: string;
  phase: string | null;
  areas: DryingArea[];
  recentEvents: DeliveryEvent[];
  senderName?: string | null;
  companyName?: string | null;
}): { subject: string; body: string } {
  const first = (input.customerName ?? '').trim().split(/\s+/)[0] || 'there';
  const judged = input.areas.map(areaIsDry).filter((v): v is boolean => v !== null);
  const dry = judged.filter(Boolean).length;

  const lines: string[] = [`Hi ${first},`, ''];
  lines.push(`Wanted to give you a quick update on ${input.jobTitle.toLowerCase()}.`);
  lines.push('');
  lines.push(`Where things stand: ${phaseLabel(input.phase).toLowerCase()}.`);

  if (judged.length > 0) {
    lines.push(
      dry === judged.length
        ? `All ${judged.length} of the affected area${judged.length === 1 ? '' : 's'} are now reading at dry standard.`
        : `${dry} of ${judged.length} affected areas are at dry standard so far.`,
    );
  }

  // Two or three concrete things, because "we're making progress" is what
  // everybody says and "equipment pulled from the kitchen" is what makes
  // somebody believe it.
  const notable = input.recentEvents
    .filter((e) => e.tone === 'progress' || e.tone === 'crew')
    .slice(0, 3);
  if (notable.length) {
    lines.push('');
    lines.push('Recently:');
    for (const event of notable) lines.push(`  • ${event.text}`);
  }

  lines.push('');
  lines.push('Anything you want to ask about, just reply to this and it comes straight to me.');
  lines.push('');
  lines.push(`— ${input.senderName?.trim() || 'Your team'}${input.companyName ? `, ${input.companyName}` : ''}`);

  return {
    // Non-deceptive and specific, which is both the legal requirement and the
    // reason it gets opened.
    subject: `Update on your ${input.jobTitle.toLowerCase()}`,
    body: lines.join('\n'),
  };
}
