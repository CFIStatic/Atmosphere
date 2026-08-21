import type { CaptureTeamMember, OrgMember } from './api';

const SAMPLE_SITUATION =
  'Extract standing water in the living room and hallway. Set drying equipment.';

export const INTAKE_SAMPLE = {
  situation: SAMPLE_SITUATION,
  address: '1842 Meridian Ave, Austin, TX 78702',
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isInviteEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** Prefer field technicians; otherwise people marked for field work. */
export function membersToCaptureTeam(members: OrgMember[]): CaptureTeamMember[] {
  const active = members.filter((m) => m.status === 'active');
  const fieldTechs = active.filter((m) => m.role === 'field_technician');
  const fieldAdjacent = active.filter(
    (m) =>
      m.usageIntents.includes('field_work') ||
      m.workType === 'mitigation' ||
      m.workType === 'construction',
  );
  const pool = fieldTechs.length > 0 ? fieldTechs : fieldAdjacent;
  return pool.map((m) => ({
    userId: m.userId,
    fullName: m.fullName || m.email || 'Field technician',
    email: m.email,
    role: m.role,
    workType: m.workType,
    selected: true,
  }));
}

export function workTypeFromSituation(text: string): 'mitigation' | 'construction' {
  return /mitigat|water|flood|mold|dry|extract/i.test(text) ? 'mitigation' : 'construction';
}

export function scopeFromSituation(text: string): Array<{ title: string; state: 'included' }> {
  const note = text.trim();
  if (note.length < 2) return [];
  return [{ title: note.slice(0, 200), state: 'included' }];
}

/** City + ZIP from a Places-style formatted address when the picker was skipped. */
export function cityPostalFromAddress(formatted: string): { city: string; postalCode: string } {
  const postal = formatted.match(/\b(\d{5})(?:-\d{4})?\b/);
  const bits = formatted.split(',').map((s) => s.trim()).filter(Boolean);
  const city = bits.length >= 2 ? bits[1]!.replace(/\s+[A-Z]{2}$/, '').trim() : '';
  return { city, postalCode: postal?.[1] ?? '' };
}
