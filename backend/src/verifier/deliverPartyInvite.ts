/* eslint-disable @typescript-eslint/no-explicit-any */
import { sendSystemMail } from '../lib/systemMail.js';
import { LIVE_FIELD_CAPTURE_ORIGIN, publicAppOrigin } from '../lib/publicAppOrigin.js';
import { jobSharePagePath } from '../lib/jobSharePath.js';
import { unscopedAdminOrNull, writerForJob } from '../lib/scopedAdmin.js';
import { partyInviteEmail } from './partyInviteEmail.js';

/**
 * Email a contractor the same capture invite from Start a job and from
 * Add people — web office and Field Capture (phone) both use this path.
 */

export async function actorLabelFor(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', userId)
    .maybeSingle();
  return (data as any)?.full_name ?? (data as any)?.email ?? 'Office';
}

export function fieldCaptureInvitePath(token: string): string {
  return `/fieldcapture/index.html?token=${encodeURIComponent(token)}`;
}

export function fieldCaptureInviteUrl(token: string, origin = LIVE_FIELD_CAPTURE_ORIGIN): string {
  const trimmed = origin.replace(/\/$/, '');
  return `${trimmed}/?token=${encodeURIComponent(token)}`;
}

export async function deliverPartyInvite(input: {
  supabase: any;
  orgId: string;
  jobId: string;
  jobTitle: string;
  siteAddress?: string | null;
  userId: string;
  partyId: string;
  company: string;
  contactName: string;
  email: string | null;
  token: string;
}): Promise<{ emailed: boolean; recipientHasAccount: boolean; attachedToAccount: boolean }> {
  const email = input.email?.trim().toLowerCase() || null;
  if (!email) {
    return { emailed: false, recipientHasAccount: false, attachedToAccount: false };
  }

  const admin = unscopedAdminOrNull();
  let recipientHasAccount = false;
  let erased = false;
  let attachedToAccount = false;

  if (admin) {
    const [{ data: existing }, { data: erasure }, { data: identity }] = await Promise.all([
      admin.from('profiles').select('id').ilike('email', email).limit(1).maybeSingle(),
      admin.from('network_erasures').select('email').eq('email', email).maybeSingle(),
      admin
        .from('field_identities')
        .select('id')
        .eq('channel', 'email')
        .eq('address', email)
        .maybeSingle(),
    ]);
    recipientHasAccount = Boolean(existing);
    erased = Boolean(erasure);

    if (identity) {
      const writer = writerForJob({ orgId: input.orgId, jobId: input.jobId }, admin).raw;
      const { error } = await writer.from('job_party_claims').upsert(
        {
          org_id: input.orgId,
          party_id: input.partyId,
          identity_id: (identity as any).id,
        },
        { onConflict: 'party_id' },
      );
      attachedToAccount = !error;
    }
  }

  let emailed = false;
  if (!erased) {
    const [{ data: org }, inviterName] = await Promise.all([
      input.supabase.from('orgs').select('name').eq('id', input.orgId).maybeSingle(),
      actorLabelFor(input.supabase, input.userId),
    ]);
    const emailParam = encodeURIComponent(email);
    const sharePath = jobSharePagePath(input.token, email);
    const origin = publicAppOrigin();
    const mail = partyInviteEmail({
      orgName: (org as any)?.name ?? 'a contractor',
      inviterName,
      jobTitle: input.jobTitle,
      siteAddress: input.siteAddress ?? null,
      recipientName: input.contactName || input.company,
      recipientEmail: email,
      recipientHasAccount,
      origin,
      path: sharePath,
      signupPath: `/signup?email=${emailParam}`,
      fieldCaptureUrl: fieldCaptureInviteUrl(input.token),
    });
    const result = await sendSystemMail({
      to: email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    if (!result.ok) {
      console.warn(`[invite] email to ${email} failed: ${result.why}`);
    }
    emailed = result.ok;
  }

  return { emailed, recipientHasAccount, attachedToAccount };
}
