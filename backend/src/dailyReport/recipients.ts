/* eslint-disable @typescript-eslint/no-explicit-any */
import { isGlobalAdmin } from '../lib/productRoles.js';
import { deriveServiceRole } from '../shared/serviceRole.js';
import type { DailyReportRecipients } from './types.js';

function pushEmail(out: string[], seen: Set<string>, raw: unknown): void {
  if (typeof raw !== 'string') return;
  const email = raw.trim().toLowerCase();
  if (!email || !email.includes('@') || seen.has(email)) return;
  seen.add(email);
  out.push(email);
}

function pushPhone(out: string[], seen: Set<string>, raw: unknown): void {
  if (typeof raw !== 'string') return;
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.length < 8 || seen.has(digits)) return;
  seen.add(digits);
  out.push(digits);
}

/**
 * Homeowner + project manager (+ optional extras) for a job.
 * Homeowner: job_parties role=owner (or derived homeowner).
 * PM: org members with project_manager service/member role, else global admins;
 *     parties derived as project_manager.
 */
export async function resolveDailyReportRecipients(
  admin: any,
  orgId: string,
  jobId: string,
  extraEmails: string[] = [],
): Promise<DailyReportRecipients> {
  const emails: string[] = [];
  const phones: string[] = [];
  const seenEmail = new Set<string>();
  const seenPhone = new Set<string>();

  const { data: parties } = await admin
    .from('job_parties')
    .select('role, email, phone, company, contact_name, trade, service_role, service_role_custom')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .is('revoked_at', null);

  for (const party of (parties ?? []) as any[]) {
    const role = String(party.role ?? '');
    const inferred = deriveServiceRole({
      serviceRole: party.service_role,
      serviceRoleCustom: party.service_role_custom,
      partyRole: role,
      trade: party.trade,
      kind: 'job_party',
    });
    const isHomeowner = role === 'owner' || inferred?.role === 'homeowner';
    const isPm = inferred?.role === 'project_manager';
    if (isHomeowner || isPm) {
      pushEmail(emails, seenEmail, party.email);
      pushPhone(phones, seenPhone, party.phone);
    }
  }

  const { data: members } = await admin
    .from('org_members')
    .select('role, status, profiles(email, service_role, service_role_custom, full_name)')
    .eq('org_id', orgId)
    .eq('status', 'active');

  for (const row of (members ?? []) as any[]) {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    if (!profile) continue;
    const inferred = deriveServiceRole({
      serviceRole: profile.service_role,
      serviceRoleCustom: profile.service_role_custom,
      memberRole: row.role,
      kind: 'org_member',
    });
    const adminSeat = isGlobalAdmin(row.role);
    if (inferred?.role === 'project_manager' || adminSeat) {
      pushEmail(emails, seenEmail, profile.email);
    }
  }

  for (const extra of extraEmails) pushEmail(emails, seenEmail, extra);

  return { emails, phones };
}
