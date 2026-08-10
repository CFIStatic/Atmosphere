import { HttpError } from '../lib/errors.js';

/**
 * Company-wide Field Capture browse/upload (today, search, capture-link, proof)
 * is for the general contractor’s own Field Capture seats — not for outside
 * trades working on the GC’s behalf.
 *
 * Anyone filming for a GC from outside the company must be invited to each
 * job with the subcontractor designation (share token / My jobs claim).
 */
export const FIELD_APP_INTERNAL_ROLES = new Set([
  'field_technician',
  'owner',
  'admin',
  'project_manager',
]);

export function assertInternalFieldAppSeat(role: string): void {
  if (!FIELD_APP_INTERNAL_ROLES.has(role)) {
    throw new HttpError(
      403,
      'Company job search is for your Field Capture team. Subcontractors working for a general contractor must be invited to each job with the subcontractor designation.',
      'field_app_internal_only',
    );
  }
}

/** Normalize intake invite designation for job_parties. */
export function partyDesignationForInvite(input: {
  external?: boolean;
  userId?: string | null;
  trade?: string | null;
}): { external: boolean; trade: string; role: 'subcontractor' | 'general_contractor' } {
  const external = Boolean(input.external || !input.userId);
  if (external) {
    return { external: true, trade: 'subcontractor', role: 'subcontractor' };
  }
  const trade = (input.trade || 'field_capture').trim() || 'field_capture';
  // Internal Field Capture crew sits on the GC side of the job record.
  return { external: false, trade, role: 'general_contractor' };
}

export function assertExternalIsSubcontractor(input: {
  external?: boolean;
  userId?: string | null;
  trade?: string | null;
}): void {
  const external = Boolean(input.external || !input.userId);
  if (!external) return;
  const trade = (input.trade || 'subcontractor').trim().toLowerCase();
  if (trade && trade !== 'subcontractor') {
    throw new HttpError(
      400,
      'Workers outside the company must be invited as subcontractors.',
      'subcontractor_designation_required',
    );
  }
}
