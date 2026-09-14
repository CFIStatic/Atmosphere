/**
 * Person service role titles for Analysis labeling ("Alex — Electrician",
 * "Homeowner"). Distinct from org_members.role (billing / seat product role).
 *
 * Stable shape for speaker-identity / people-matching:
 *   { role: ServiceRoleSlug; displayLabel: string }
 *
 * Precedence when resolving for a job:
 *   1. job_parties.service_role (+ custom) when present
 *   2. profiles.service_role (+ custom)
 *   3. derive from job_parties.trade / party.role / org member_role
 *   4. homeowner kind / progress grant → always Homeowner
 */

export const SERVICE_ROLE_SLUGS = [
  'homeowner',
  'adjuster',
  'estimator',
  'project_manager',
  'electrician',
  'plumber',
  'roofer',
  'technician',
  'crew',
  'inspector',
  'other',
] as const;

export type ServiceRoleSlug = (typeof SERVICE_ROLE_SLUGS)[number];

export type ServiceRoleLabel = {
  /** Curated slug — stable for matching / filters. */
  role: ServiceRoleSlug;
  /** Human label Analysis / UI should show. */
  displayLabel: string;
};

/** Canonical display labels for curated slugs (except `other` → custom or "Other"). */
export const SERVICE_ROLE_LABELS: Record<Exclude<ServiceRoleSlug, 'other'>, string> = {
  homeowner: 'Homeowner',
  adjuster: 'Adjuster',
  estimator: 'Estimator',
  project_manager: 'Project Manager',
  electrician: 'Electrician',
  plumber: 'Plumber',
  roofer: 'Roofer',
  technician: 'Technician',
  crew: 'Crew',
  inspector: 'Inspector',
};

/** Signup / settings list — excludes homeowner (forced by grant/invite path). */
export const SERVICE_ROLE_OPTIONS: { value: ServiceRoleSlug; label: string }[] = [
  { value: 'adjuster', label: 'Adjuster' },
  { value: 'estimator', label: 'Estimator' },
  { value: 'project_manager', label: 'Project Manager' },
  { value: 'electrician', label: 'Electrician' },
  { value: 'plumber', label: 'Plumber' },
  { value: 'roofer', label: 'Roofer' },
  { value: 'technician', label: 'Technician' },
  { value: 'crew', label: 'Crew' },
  { value: 'inspector', label: 'Inspector' },
  { value: 'other', label: 'Other' },
];

export const PICKABLE_SERVICE_ROLES = SERVICE_ROLE_OPTIONS;

const SLUG_SET = new Set<string>(SERVICE_ROLE_SLUGS);

export function isServiceRoleSlug(raw: unknown): raw is ServiceRoleSlug {
  return typeof raw === 'string' && SLUG_SET.has(raw);
}

export function normalizeServiceRoleCustom(raw: string | null | undefined): string | null {
  const s = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return s || null;
}

export function displayLabelForServiceRole(
  role: ServiceRoleSlug | string | null | undefined,
  custom?: string | null,
): string {
  const slug = String(role || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (slug === 'homeowner' || slug === 'owner') return 'Homeowner';
  if (slug === 'other') {
    return normalizeServiceRoleCustom(custom) || 'Other';
  }
  if (isServiceRoleSlug(slug) && slug !== 'other') {
    return SERVICE_ROLE_LABELS[slug];
  }
  const customLabel = normalizeServiceRoleCustom(custom);
  if (customLabel) return customLabel;
  if (!slug) return '';
  return titleCaseWords(slug.replace(/_/g, ' ')).slice(0, 60);
}

export function toServiceRoleLabel(
  role: ServiceRoleSlug | string | null | undefined,
  custom?: string | null,
): ServiceRoleLabel | null {
  const raw = String(role || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const customNorm = normalizeServiceRoleCustom(custom);

  if (!raw && !customNorm) return null;

  if (raw === 'homeowner' || raw === 'owner') {
    return { role: 'homeowner', displayLabel: 'Homeowner' };
  }

  if (isServiceRoleSlug(raw)) {
    return {
      role: raw,
      displayLabel: displayLabelForServiceRole(raw, customNorm),
    };
  }

  // Unknown slug → treat as other with best-effort label.
  return {
    role: 'other',
    displayLabel: customNorm || titleCaseWords(raw.replace(/_/g, ' ')).slice(0, 60) || 'Other',
  };
}

/** Homeowner progress grants / shares always resolve to this. */
export const HOMEOWNER_SERVICE_ROLE: ServiceRoleLabel = {
  role: 'homeowner',
  displayLabel: 'Homeowner',
};

/**
 * "Alex — Electrician" when both known; Homeowner never becomes a legal name;
 * title alone or name alone otherwise.
 */
export function formatPersonRoleLabel(
  name: string | null | undefined,
  label: ServiceRoleLabel | null | undefined,
): string | null {
  if (label?.role === 'homeowner') return 'Homeowner';
  const n = String(name || '').trim();
  const t = label?.displayLabel?.trim() || '';
  if (n && t && !n.toLowerCase().includes(t.toLowerCase())) {
    return `${n.slice(0, 48)} — ${t.slice(0, 40)}`.slice(0, 80);
  }
  if (n) return n.slice(0, 80);
  if (t) return t.slice(0, 80);
  return null;
}

/** Alias used by speaker-identity hooks (`serviceTitle` === displayLabel). */
export function serviceTitleFromLabel(label: ServiceRoleLabel | null | undefined): string | null {
  return label?.displayLabel ?? null;
}

/**
 * Derive a service role from existing trade / party role / seat role when no
 * explicit profiles.service_role is set.
 */
export function deriveServiceRole(hint: {
  serviceRole?: string | null;
  serviceRoleCustom?: string | null;
  trade?: string | null;
  partyRole?: string | null;
  memberRole?: string | null;
  kind?: 'org_member' | 'job_party' | 'homeowner' | null;
}): ServiceRoleLabel | null {
  if (hint.kind === 'homeowner') return HOMEOWNER_SERVICE_ROLE;

  const explicit = toServiceRoleLabel(hint.serviceRole, hint.serviceRoleCustom);
  if (explicit) return explicit;

  const trade = String(hint.trade || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
  if (trade) {
    const fromTrade = tradeToServiceRole(trade);
    if (fromTrade) return fromTrade;
  }

  const party = String(hint.partyRole || '')
    .trim()
    .toLowerCase();
  switch (party) {
    case 'adjuster':
      return { role: 'adjuster', displayLabel: 'Adjuster' };
    case 'owner':
      return HOMEOWNER_SERVICE_ROLE;
    case 'general_contractor':
      return { role: 'other', displayLabel: 'General Contractor' };
    case 'subcontractor':
      return { role: 'crew', displayLabel: 'Crew' };
    default:
      break;
  }

  const member = String(hint.memberRole || '')
    .trim()
    .toLowerCase();
  switch (member) {
    case 'project_manager':
      return { role: 'project_manager', displayLabel: 'Project Manager' };
    case 'field_technician':
      return { role: 'technician', displayLabel: 'Technician' };
    case 'sales':
      return { role: 'estimator', displayLabel: 'Estimator' };
    case 'employee':
      return { role: 'crew', displayLabel: 'Crew' };
    case 'office_manager':
      return { role: 'other', displayLabel: 'Office Manager' };
    case 'accountant':
      return { role: 'other', displayLabel: 'Accountant' };
    case 'adjuster':
      return { role: 'adjuster', displayLabel: 'Adjuster' };
    case 'homeowner':
    case 'owner':
      return HOMEOWNER_SERVICE_ROLE;
    default:
      return null;
  }
}

function tradeToServiceRole(trade: string): ServiceRoleLabel | null {
  const t = trade.trim();
  if (/plumb/.test(t)) return { role: 'plumber', displayLabel: 'Plumber' };
  if (/electr/.test(t)) return { role: 'electrician', displayLabel: 'Electrician' };
  if (/roof/.test(t)) return { role: 'roofer', displayLabel: 'Roofer' };
  if (/estimat/.test(t)) return { role: 'estimator', displayLabel: 'Estimator' };
  if (/project\s*manag|\bpm\b/.test(t)) return { role: 'project_manager', displayLabel: 'Project Manager' };
  if (/adjust/.test(t)) return { role: 'adjuster', displayLabel: 'Adjuster' };
  if (/inspect/.test(t)) return { role: 'inspector', displayLabel: 'Inspector' };
  if (/hvac|heating|cooling/.test(t)) return { role: 'technician', displayLabel: 'HVAC' };
  if (/tech/.test(t)) return { role: 'technician', displayLabel: 'Technician' };
  if (
    /crew|labor|worker|mitigation|restoration|field\s*capture|drywall|paint|fram|floor|carpentr|mason|insulat|sid(ing)?|landscap|clean|facilit|security|pest|appliance|sub/.test(
      t,
    )
  ) {
    return { role: 'crew', displayLabel: 'Crew' };
  }
  return { role: 'other', displayLabel: titleCaseWords(t).slice(0, 60) };
}

function titleCaseWords(raw: string): string {
  return raw
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** Normalize API input for profile / invite / party writes. */
export function normalizeServiceRoleInput(input: {
  serviceRole?: string | null;
  serviceRoleCustom?: string | null;
  /** When true, force homeowner (progress grant / homeowner invite). */
  forceHomeowner?: boolean;
}): { service_role: ServiceRoleSlug | null; service_role_custom: string | null } {
  if (input.forceHomeowner) {
    return { service_role: 'homeowner', service_role_custom: null };
  }
  const raw = String(input.serviceRole ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!raw) {
    return { service_role: null, service_role_custom: null };
  }
  if (raw === 'homeowner' || raw === 'owner') {
    return { service_role: 'homeowner', service_role_custom: null };
  }
  if (!isServiceRoleSlug(raw)) {
    const custom = normalizeServiceRoleCustom(input.serviceRoleCustom ?? input.serviceRole);
    return { service_role: 'other', service_role_custom: custom };
  }
  if (raw === 'other') {
    return {
      service_role: 'other',
      service_role_custom: normalizeServiceRoleCustom(input.serviceRoleCustom),
    };
  }
  return { service_role: raw, service_role_custom: null };
}
