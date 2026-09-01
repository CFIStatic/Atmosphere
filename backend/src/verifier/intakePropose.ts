/**
 * Turn pasted scope / claim text into an editable intake package.
 *
 * When a model is available, callers can replace this with richer extraction.
 * The heuristic path keeps the office unblocked: lines become proposals the
 * human still approves before anything is published to a crew.
 *
 * No money fields — this product handoff is facts + scope + invite only.
 */

export type ProposedScopeLine = {
  title: string;
  state: 'included' | 'excluded';
  reason?: string;
};

export type IntakeProposal = {
  title: string;
  workType: 'mitigation' | 'construction';
  address: string;
  city: string;
  postalCode: string;
  claimNumber: string;
  briefNote: string;
  facts: Record<string, string>;
  scope: ProposedScopeLine[];
  party: {
    company: string;
    trade: string;
    contactName: string;
  };
  /** How the proposal was built — honest about heuristic vs model. */
  source: 'heuristic' | 'model';
  summary: string;
};

function cleanLine(raw: string): string {
  return raw
    .replace(/^[\s•\-–—*]+/, '')
    .replace(/^\d+[.)]\s*/, '')
    .replace(/^(do\s*not|exclude[d]?|exclusion)\s*[:\-–]\s*/i, '')
    .trim();
}

function looksExcluded(raw: string): boolean {
  return /^(do\s*not|exclude|exclusion|out of scope|not in scope)\b/i.test(raw.trim());
}

/** Street line only — the job file is the site, not a scope bullet. */
export function titleFromSiteAddress(address: string): string {
  const raw = address.trim();
  if (!raw || /^address to confirm$/i.test(raw)) return 'New job';
  return (raw.split(',')[0] || raw).trim().slice(0, 200);
}

export function looksLikeScopeTitle(title: string): boolean {
  const t = title.trim();
  if (/^\d+[.)]\s+/.test(t)) return true;
  return /^(do\s*not|extract|remove|demo|set |monitor|replace|install|dry |contain|paint|clean)\b/i.test(
    t,
  );
}

/** Prefer a human-edited title; a scope-like name yields to the street when one exists. */
export function jobTitleForIntake(title: string | undefined, address: string): string {
  const t = (title ?? '').trim();
  const fromSite = titleFromSiteAddress(address);
  if (t && (!looksLikeScopeTitle(t) || fromSite === 'New job')) return t.slice(0, 200);
  return fromSite;
}

function addressOnlyProposal(address: string): IntakeProposal {
  const site = address.slice(0, 200);
  return {
    title: titleFromSiteAddress(site),
    workType: 'mitigation',
    address: site,
    city: '',
    postalCode: '',
    claimNumber: '',
    briefNote:
      'No work description yet. Field Capture can still film — AI will describe what happened from the video.',
    facts: {
      Site: site,
      Source: 'Address only — work description optional',
    },
    scope: [],
    party: {
      company: 'Field Capture',
      trade: 'field_capture',
      contactName: '',
    },
    source: 'heuristic',
    summary:
      'Job drafted from the address. Approve to put it on the dashboard — AI will describe the day film.',
  };
}

function descriptionProposal(address: string, description: string): IntakeProposal {
  const site = address.slice(0, 200);
  const note = description.trim().slice(0, 2000);
  const scope: ProposedScopeLine[] =
    note.length >= 2 ? [{ title: note.slice(0, 200), state: 'included' }] : [];
  return {
    title: titleFromSiteAddress(site),
    workType: /mitigat|water|flood|mold|dry|extract/i.test(note) ? 'mitigation' : 'construction',
    address: site,
    city: '',
    postalCode: '',
    claimNumber: '',
    briefNote: note || addressOnlyProposal(site).briefNote,
    facts: {
      Site: site,
      ...(note ? { Work: note.slice(0, 500) } : {}),
      Source: 'Address and work description',
    },
    scope,
    party: {
      company: 'Field Capture',
      trade: 'field_capture',
      contactName: '',
    },
    source: 'heuristic',
    summary: note
      ? 'Job drafted from the address and what needs to be done. Approve to put it on the dashboard.'
      : addressOnlyProposal(site).summary,
  };
}

/**
 * Pull a usable address-looking line when present.
 */
function extractMeta(text: string): {
  address: string;
  city: string;
  postalCode: string;
} {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let address = '';
  let city = '';
  let postalCode = '';

  for (const line of lines.slice(0, 40)) {
    if (
      !address
      && /\d{1,5}\s+\w+/.test(line)
      && /(st|street|ave|avenue|rd|road|blvd|dr|drive|ln|lane|ct|court)\b/i.test(line)
      && !/\b[A-Z]{2}\s+\d{5}\b/.test(line)
    ) {
      address = line.replace(/^(property|address|site)\s*[:\-]\s*/i, '').slice(0, 200);
    }

    if (!city && /^[A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(-\d{4})?$/.test(line)) {
      const m = line.match(/^(.+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
      if (m) {
        city = m[1]!.trim();
        postalCode = m[3]!;
      }
    }
  }

  return { address, city, postalCode };
}

export function proposeIntakeFromText(
  rawText: string,
  opts?: { address?: string | null },
): IntakeProposal {
  const text = rawText.trim();
  const forcedAddress = (opts?.address ?? '').trim();

  // Address is the only required field. A short "what needs to be done" note
  // is optional — it becomes one scope line, not a claim-packet parse.
  if (!text) {
    if (!forcedAddress) {
      throw new Error(
        'Enter a site address, or paste more of the scope — a few lines is not enough to propose a job.',
      );
    }
    return addressOnlyProposal(forcedAddress);
  }

  const looksLikePacket =
    text.split(/\r?\n/).filter((line) => line.trim()).length >= 3 ||
    /^\d+[.)]/.test(text) ||
    /\b(do\s*not|scope of work|exclusions?)\b/i.test(text);

  if (forcedAddress && !looksLikePacket) {
    return descriptionProposal(forcedAddress, text);
  }

  if (text.length < 20) {
    if (!forcedAddress) {
      throw new Error(
        'Enter a site address, or paste more of the scope — a few lines is not enough to propose a job.',
      );
    }
    return descriptionProposal(forcedAddress, text);
  }

  const meta = extractMeta(text);
  const scope: ProposedScopeLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length < 4) continue;
    if (/^(scope|exclusions?|inclusions?|notes?|claim|property|address|insured)\b/i.test(trimmed) && trimmed.length < 40) {
      continue;
    }
    // Prefer bullet / numbered / exclusion-looking lines
    const isBullet = /^(\d+[.)]\s+|[-*•–—]\s+)/.test(trimmed) || looksExcluded(trimmed);
    if (!isBullet && scope.length >= 8) continue;
    if (!isBullet && !/^(remove|demo|dry|replace|install|paint|clean|extract|contain|set|monitor)/i.test(trimmed)) {
      continue;
    }
    const title = cleanLine(trimmed).slice(0, 200);
    if (title.length < 4) continue;
    if (looksExcluded(trimmed)) {
      scope.push({ title, state: 'excluded', reason: 'Called out as exclusion in the source text.' });
    } else {
      scope.push({ title, state: 'included' });
    }
    if (scope.length >= 40) break;
  }

  if (!scope.length) {
    // Fall back: split sentences so the office still has something to edit.
    for (const part of text.split(/[.;\n]+/)) {
      const title = cleanLine(part).slice(0, 200);
      if (title.length < 12 || title.length > 180) continue;
      scope.push({ title, state: 'included' });
      if (scope.length >= 12) break;
    }
  }

  const address = forcedAddress || meta.address || 'Address to confirm';
  const title = jobTitleForIntake('', address);

  const facts: Record<string, string> = {};
  if (address && address !== 'Address to confirm') facts['Site'] = address;
  facts['Source'] = scope.length
    ? 'Scope / claim text (office intake)'
    : 'Office intake — no scope lines extracted';

  const workType: 'mitigation' | 'construction' = /mitigat|water|flood|mold|dry|extract/i.test(text)
    ? 'mitigation'
    : 'construction';

  return {
    title: title.slice(0, 200),
    workType,
    address,
    city: meta.city,
    postalCode: meta.postalCode,
    claimNumber: '',
    briefNote: scope.length
      ? 'First published facts for Field Capture. Edit anything wrong before you approve — approving invites your capture team to film this job.'
      : 'No clear scope lines in the paste. You can add lines below, or approve without scope — AI will describe the video.',
    facts,
    scope,
    party: {
      company: 'Field Capture',
      trade: 'field_capture',
      contactName: '',
    },
    source: 'heuristic',
    summary: scope.length
      ? `${scope.length} scope lines drafted from your paste. Nothing is live until you approve and invite Field Capture.`
      : 'No scope lines drafted. You can still approve and invite — AI will describe what happened from the video.',
  };
}
