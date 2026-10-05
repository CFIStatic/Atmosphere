/**
 * Daily "what got done on site" digest per job.
 *
 * Surfaces missing-work flags, safety issues seen in video (explicitly
 * requested), and an auto-drafted homeowner update that must never send
 * without a contractor Approve click.
 */

export type SiteDigestClip = {
  workDate?: string | null;
  title?: string | null;
  summary?: string | null;
  narration?: string | null;
  transcript?: string | null;
  concerns?: string[] | null;
  changes?: string[] | null;
};

export type SiteDigestScopeLine = {
  title?: string | null;
  status?: string | null;
};

export type SiteDigestInput = {
  jobTitle?: string | null;
  claimNumber?: string | null;
  address?: string | null;
  workDate?: string | null;
  clips?: SiteDigestClip[] | null;
  scope?: SiteDigestScopeLine[] | null;
  notes?: string[] | null;
};

export type SiteDigestFlag = {
  kind: 'missing_work' | 'safety';
  text: string;
  source: 'video' | 'scope' | 'notes';
};

export type SiteDigest = {
  dayLabel: string;
  headline: string;
  done: string[];
  flags: SiteDigestFlag[];
  homeownerDraft: {
    subject: string;
    body: string;
    /** Always true — Send requires a separate Computer Approve. */
    requiresApprove: true;
  };
};

const SAFETY_RE =
  /\b(unsafe|safety|hazard|ppe|hard hat|fall protection|asbestos|lead paint|gas leak|structural|collapse|exposed wiring|open hole|unguarded)\b/i;

function clean(text: string, max = 180): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+\S*$/, '').trim() || t.slice(0, max);
}

function dayLabel(iso?: string | null): string {
  if (!iso) {
    const d = new Date();
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });
  }
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** Build the daily site digest from job file evidence. Never invents names or roles. */
export function buildSiteDigest(input: SiteDigestInput): SiteDigest {
  const clips = input.clips ?? [];
  const scope = input.scope ?? [];
  const day = dayLabel(input.workDate ?? clips[0]?.workDate ?? null);
  const title = String(input.jobTitle ?? '').trim() || 'this job';

  const done: string[] = [];
  const flags: SiteDigestFlag[] = [];

  for (const clip of clips) {
    const seen = clean(String(clip.summary ?? clip.narration ?? ''));
    if (seen) done.push(`${clip.workDate ? `${clip.workDate}: ` : ''}${seen}`);
    for (const change of clip.changes ?? []) {
      const c = clean(String(change));
      if (c) done.push(c);
    }
    for (const concern of clip.concerns ?? []) {
      const text = clean(String(concern));
      if (!text) continue;
      flags.push({
        kind: SAFETY_RE.test(text) ? 'safety' : 'missing_work',
        text,
        source: 'video',
      });
    }
    const transcript = String(clip.transcript ?? '');
    if (SAFETY_RE.test(transcript)) {
      const line = transcript
        .split(/\n|(?<=[.!?])\s+/)
        .map((l) => l.trim())
        .find((l) => SAFETY_RE.test(l));
      if (line) {
        flags.push({ kind: 'safety', text: clean(line), source: 'video' });
      }
    }
  }

  for (const line of scope) {
    const name = String(line.title ?? '').trim();
    const status = String(line.status ?? '').trim().toLowerCase();
    if (!name) continue;
    if (/incomplete|pending|open|not\s*started|missing|todo/.test(status) || !status) {
      if (/incomplete|pending|open|not\s*started|missing|todo/.test(status)) {
        flags.push({ kind: 'missing_work', text: `${name} (${status || 'open'})`, source: 'scope' });
      }
    }
  }

  // De-dupe flags
  const seenFlag = new Set<string>();
  const uniqueFlags = flags.filter((f) => {
    const key = `${f.kind}:${f.text.toLowerCase()}`;
    if (seenFlag.has(key)) return false;
    seenFlag.add(key);
    return true;
  });

  const uniqueDone = [...new Set(done)].slice(0, 8);
  const safety = uniqueFlags.filter((f) => f.kind === 'safety');
  const missing = uniqueFlags.filter((f) => f.kind === 'missing_work');

  const headline =
    uniqueDone.length > 0
      ? `On ${day}, crew work was recorded on ${title}.`
      : `On ${day}, no new field video was filed for ${title}.`;

  const subject = `Update: ${title}${input.claimNumber ? ` (${input.claimNumber})` : ''}`;
  const bodyLines = [
    'Hello,',
    '',
    `Here is a short update on ${title}${input.address ? ` at ${input.address}` : ''} for ${day}.`,
    '',
  ];
  if (uniqueDone.length) {
    bodyLines.push('What got done:');
    for (const d of uniqueDone.slice(0, 5)) bodyLines.push(`• ${d}`);
    bodyLines.push('');
  } else {
    bodyLines.push('We do not have new field video for this day yet.');
    bodyLines.push('');
  }
  if (missing.length) {
    bodyLines.push('Still open on our side:');
    for (const f of missing.slice(0, 4)) bodyLines.push(`• ${f.text}`);
    bodyLines.push('');
  }
  // Safety flags stay on the contractor digest; homeowner draft stays calm and omits raw hazard jargon
  // unless the contractor explicitly includes them after Approve review.
  bodyLines.push('Please reply if you have questions.');
  bodyLines.push('');
  bodyLines.push('Thank you,');

  return {
    dayLabel: day,
    headline,
    done: uniqueDone,
    flags: uniqueFlags,
    homeownerDraft: {
      subject,
      body: bodyLines.join('\n'),
      requiresApprove: true,
    },
  };
}

/** Contractor-facing digest text (includes safety + missing-work flags). */
export function formatSiteDigestForContractor(digest: SiteDigest): string {
  const lines = [digest.headline, ''];
  if (digest.done.length) {
    lines.push('What got done:');
    for (const d of digest.done) lines.push(`• ${d}`);
    lines.push('');
  }
  const safety = digest.flags.filter((f) => f.kind === 'safety');
  const missing = digest.flags.filter((f) => f.kind === 'missing_work');
  if (safety.length) {
    lines.push('Safety flags from video:');
    for (const f of safety) lines.push(`• ${f.text}`);
    lines.push('');
  }
  if (missing.length) {
    lines.push('Missing / incomplete work:');
    for (const f of missing) lines.push(`• ${f.text}`);
    lines.push('');
  }
  lines.push('Homeowner update draft (sends only after you Approve):');
  lines.push(`Subject: ${digest.homeownerDraft.subject}`);
  lines.push('');
  lines.push(digest.homeownerDraft.body);
  return lines.join('\n');
}
