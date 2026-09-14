/**
 * Person service role titles — keep slugs/labels in sync with
 * backend/src/shared/serviceRole.ts and docs/user-service-role-titles.md.
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
  role: ServiceRoleSlug;
  displayLabel: string;
};

/** Picker options — homeowner is forced by progress-grant path, not picked here. */
export const PICKABLE_SERVICE_ROLES: { value: ServiceRoleSlug; label: string }[] = [
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

export function displayLabelForServiceRole(
  role: string | null | undefined,
  custom?: string | null,
): string {
  const slug = String(role || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const labels: Record<string, string> = {
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
  if (slug === 'other') {
    const c = String(custom ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    return c || 'Other';
  }
  return labels[slug] || '';
}

export function formatPersonRoleLabel(
  name: string | null | undefined,
  label: ServiceRoleLabel | null | undefined,
): string {
  if (label?.role === 'homeowner') return 'Homeowner';
  const n = String(name || '').trim();
  const t = label?.displayLabel?.trim() || '';
  if (n && t && !n.toLowerCase().includes(t.toLowerCase())) return `${n} — ${t}`;
  return n || t || '';
}
