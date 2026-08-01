/**
 * Lightweight insurance / property-claim guidance keyed by US state and
 * common carriers. This is educational context for the homeowner assistant —
 * not legal advice — and is deliberately conservative.
 */

export interface RegulationBrief {
  regionLabel: string;
  carrierLabel: string | null;
  bullets: string[];
  disclaimer: string;
}

const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  DC: 'District of Columbia',
};

/** Normalize "TX", "Texas", "tx " → TX when possible. */
export function normalizeRegion(region: string | null | undefined): string | null {
  if (!region) return null;
  const raw = region.trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (US_STATE_NAMES[upper]) return upper;
  const match = Object.entries(US_STATE_NAMES).find(
    ([, name]) => name.toLowerCase() === raw.toLowerCase(),
  );
  return match?.[0] ?? raw;
}

function regionDisplay(code: string | null): string {
  if (!code) return 'your state';
  return US_STATE_NAMES[code] ?? code;
}

const STATE_NOTES: Record<string, string[]> = {
  CA: [
    'California requires insurers to acknowledge claims promptly and explain coverage decisions in writing.',
    'Department of Insurance consumer help is available if a claim stalls without a clear reason.',
    'Keep copies of every estimate, authorization, and mitigation invoice — carriers often request them.',
  ],
  TX: [
    'Texas has prompt-payment rules for accepted claims; ask your adjuster for the decision timeline in writing.',
    'Document weather or sudden-loss facts early — storm and water claims are frequently disputed on timing.',
    'You may request a reinspection if new damage is found after the first walkthrough.',
  ],
  FL: [
    'Florida homeowners policies and hurricane deductibles can differ from standard deductibles — confirm which applies.',
    'Emergency mitigation to prevent further damage is usually expected; save receipts and photos.',
    'Deadlines for supplemental claims can be short after a catastrophe — ask your carrier what clock applies.',
  ],
  NY: [
    'New York insurers generally must acknowledge and investigate claims within set timeframes.',
    'Ask for a written explanation if coverage is limited or denied on a specific room or trade.',
    'Keep a claim diary: who you spoke with, when, and what was promised.',
  ],
  LA: [
    'Louisiana storm and flood situations often involve separate flood policies — confirm what covers what.',
    'Mitigation and drying logs help prove the scope of water damage to the adjuster.',
    'Ask whether ALE (additional living expense) applies if the home is uninhabitable.',
  ],
};

const GENERAL_NOTES = [
  'Most homeowners policies require you to mitigate further damage (for example, stopping active leaks) and to document the loss.',
  'Your deductible and coverage limits are in your declarations page — upload the policy here if you want help reading it.',
  'The restoration company works the repair; coverage decisions belong to your insurer and adjuster.',
  'This portal explains progress and general insurance concepts. It is not legal advice and does not bind your carrier.',
];

const CARRIER_NOTES: Record<string, string[]> = {
  statefarm: [
    'State Farm claims often assign a claim number and preferred vendors early — keep both handy when you call.',
  ],
  allstate: [
    'Allstate may separate property damage from contents; ask which adjuster owns which part of the loss.',
  ],
  usaa: [
    'USAA members can usually track claim status in the USAA app in parallel with this restoration portal.',
  ],
  farmers: [
    'Farmers claims frequently request photos and moisture logs — the drying summary here can help you share progress.',
  ],
  liberty: [
    'Liberty Mutual / Safeco claims: confirm whether your policy uses actual cash value or replacement cost.',
  ],
  nationwide: [
    'Nationwide claims: ask for the estimate version number whenever numbers change so supplements stay clear.',
  ],
};

function matchCarrierKey(carrier: string | null | undefined): string | null {
  if (!carrier) return null;
  const c = carrier.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const key of Object.keys(CARRIER_NOTES)) {
    if (c.includes(key)) return key;
  }
  if (c.includes('safeco')) return 'liberty';
  return null;
}

export function buildRegulationBrief(input: {
  region: string | null;
  carrier: string | null;
  lossType: string | null;
}): RegulationBrief {
  const code = normalizeRegion(input.region);
  const bullets = [
    ...GENERAL_NOTES,
    ...(code && STATE_NOTES[code] ? STATE_NOTES[code] : [
      `Rules and timelines vary in ${regionDisplay(code)}. Ask your adjuster for written claim-handling timelines that apply to your policy.`,
    ]),
  ];

  const carrierKey = matchCarrierKey(input.carrier);
  if (carrierKey) bullets.push(...CARRIER_NOTES[carrierKey]!);
  else if (input.carrier) {
    bullets.push(
      `Your carrier is listed as ${input.carrier}. Ask them which claim guidelines and preferred-vendor rules apply to this loss.`,
    );
  }

  if (input.lossType === 'water' || input.lossType === 'mold') {
    bullets.push(
      'Water and mold losses usually need drying documentation. Progress here reflects mitigation work, not a coverage decision.',
    );
  }
  if (input.lossType === 'fire') {
    bullets.push(
      'Fire losses often involve contents, structural, and smoke remediation scopes — clarify what has been approved so far.',
    );
  }
  if (input.lossType === 'storm') {
    bullets.push(
      'Storm claims may involve separate wind vs. flood coverages. Confirm which policy responds before assuming everything is covered.',
    );
  }

  return {
    regionLabel: regionDisplay(code),
    carrierLabel: input.carrier,
    bullets: bullets.slice(0, 10),
    disclaimer:
      'Educational only — not legal, coverage, or claims advice. Confirm everything with your insurer and adjuster.',
  };
}

/** Compact text block injected into the assistant system prompt. */
export function regulationPromptBlock(brief: RegulationBrief): string {
  return [
    `Property location context: ${brief.regionLabel}.`,
    brief.carrierLabel ? `Carrier on this job: ${brief.carrierLabel}.` : 'Carrier not listed yet.',
    'Relevant guidance bullets:',
    ...brief.bullets.map((b) => `- ${b}`),
    brief.disclaimer,
  ].join('\n');
}
