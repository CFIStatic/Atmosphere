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

/**
 * Pull a usable address-looking line and a claim number when present.
 */
function extractMeta(text: string): {
  address: string;
  city: string;
  postalCode: string;
  claimNumber: string;
  titleHint: string;
} {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let address = '';
  let city = '';
  let postalCode = '';
  let claimNumber = '';
  let titleHint = '';

  for (const line of lines.slice(0, 40)) {
    const claim = line.match(/\b(?:claim|file)\s*(?:#|no\.?|number)?\s*[:\s]?\s*([A-Z0-9-]{5,})\b/i);
    if (claim && !claimNumber) claimNumber = claim[1]!;

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

    if (!titleHint && /(?:water|fire|mold|storm|mitigation|rebuild|restoration)/i.test(line) && line.length < 120) {
      titleHint = line.slice(0, 120);
    }
  }

  return { address, city, postalCode, claimNumber, titleHint };
}

export function proposeIntakeFromText(rawText: string): IntakeProposal {
  const text = rawText.trim();
  if (text.length < 20) {
    throw new Error('Paste more of the scope or claim — a few lines is not enough to propose a job.');
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

  const title =
    meta.titleHint ||
    (meta.address ? `Work at ${meta.address}` : 'New job from scope') ||
    'New job from scope';

  const facts: Record<string, string> = {};
  if (meta.claimNumber) facts['Claim #'] = meta.claimNumber;
  if (meta.address) facts['Site'] = meta.address;
  facts['Source'] = 'Scope / claim text (office intake)';

  const workType: 'mitigation' | 'construction' = /mitigat|water|flood|mold|dry|extract/i.test(text)
    ? 'mitigation'
    : 'construction';

  return {
    title: title.slice(0, 200),
    workType,
    address: meta.address || 'Address to confirm',
    city: meta.city,
    postalCode: meta.postalCode,
    claimNumber: meta.claimNumber,
    briefNote:
      'First published facts for Field Capture. Edit anything wrong before you approve — approving invites your capture team to film this job.',
    facts,
    scope: scope.length
      ? scope
      : [{ title: 'Confirm scope lines with the office before work', state: 'included' }],
  party: {
    company: 'Field Capture',
    trade: 'field_capture',
    contactName: '',
  },
  source: 'heuristic',
  summary: `${scope.length || 1} scope lines drafted from your paste. Nothing is live until you approve and invite Field Capture.`,
};
}
