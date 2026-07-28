/**
 * Partner network — invites and partnerships that pull vendors / subcontractors
 * onto Atmosphere.
 *
 * The flywheel is deliberate and small:
 *   invite → they create an org → partnership row on both sides → directory
 *   grows → next job prefers an on-platform partner → more invites.
 *
 * Only aggregate counters cross org boundaries. Job content never does.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../../lib/errors.js';
import { config } from '../../config.js';
import * as net from './networkStore.js';
import type { InviteeKind, PartnerInvite, PartnerProfile, Partnership } from './networkTypes.js';
import { createThread, ensureAdaptationApplied } from './threads.js';

export async function ensureOwnProfile(
  supabase: SupabaseClient,
  orgId: string,
  fallbackName: string,
): Promise<PartnerProfile> {
  const existing = await net.getOwnProfile(supabase, orgId);
  if (existing) return existing;
  return net.upsertProfile(supabase, orgId, {
    display_name: fallbackName,
    kind: 'restoration',
    discoverable: true,
  });
}

export async function invitePartner(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  input: {
    inviteeKind: InviteeKind;
    inviteeName: string;
    inviteeEmail?: string | null;
    inviteePhone?: string | null;
    inviteeCompany?: string | null;
    trades?: string[];
    message?: string | null;
    projectId?: string | null;
    crmAccountId?: string | null;
    orgName?: string;
  },
): Promise<{ invite: PartnerInvite; inviteUrl: string; threadId: string | null }> {
  if (!input.inviteeEmail && !input.inviteePhone) {
    throw new HttpError(400, 'Provide an email or phone for the invite.', 'pm_invite_contact_required');
  }

  await ensureOwnProfile(supabase, orgId, input.orgName ?? 'Atmosphere org');

  const invite = await net.createInvite(supabase, orgId, {
    invitee_kind: input.inviteeKind,
    invitee_name: input.inviteeName,
    invitee_email: input.inviteeEmail ?? null,
    invitee_phone: input.inviteePhone ?? null,
    invitee_company: input.inviteeCompany ?? null,
    trades: input.trades ?? [],
    message: input.message ?? null,
    project_id: input.projectId ?? null,
    crm_account_id: input.crmAccountId ?? null,
    invited_by: userId,
    status: 'sent',
  });

  await net.bumpInviteCounters(supabase, orgId, 'invites_sent');

  const origin = `network:invite:${invite.id}`;
  const thread = await createThread(supabase, orgId, userId, {
    kind: 'network',
    mode: 'digest',
    title: `Invite · ${input.inviteeCompany || input.inviteeName}`,
    urgency: 'normal',
    originKey: origin,
    originRef: invite.id,
    projectId: input.projectId,
    seedMessage:
      `Atmosphere drafted an invite for ${input.inviteeName}` +
      (input.inviteeCompany ? ` at ${input.inviteeCompany}` : '') +
      ` (${input.inviteeKind}). When they join, this partnership unlocks on-platform coordination.`,
  });

  const base = config.frontendOrigins[0] ?? 'https://app.atmosphere';
  const inviteUrl = `${base.replace(/\/$/, '')}/join-partner?token=${encodeURIComponent(invite.token)}`;

  return { invite, inviteUrl, threadId: thread.id };
}

/**
 * Accept an invite from the *invitee's* org session.
 *
 * Creates a partnership row under the inviting org (via service path is not
 * used here — the invitee cannot write into the inviter's org under RLS).
 * Instead we mark the invite accepted with accepted_org_id, and the inviter's
 * next load (or an explicit claim endpoint under their JWT) materialises the
 * partnership. For the happy path in-app, `claimAcceptedInvites` does that.
 */
export async function acceptPartnerInvite(
  supabase: SupabaseClient,
  inviteeOrgId: string,
  inviteeUserId: string,
  token: string,
  profile: { displayName: string; kind: InviteeKind; trades?: string[] },
): Promise<{ invite: PartnerInvite; profile: PartnerProfile }> {
  // Token lookup must work for the invitee who is not yet a member of the
  // inviting org. The invite row is only selectable by the inviting org under
  // RLS — so acceptance of strangers' tokens goes through a narrow RPC later.
  // Until that RPC ships, managers who share a session (demo / same-tenant
  // tests) can accept; otherwise we return a clear 503 pointing at the gap.
  let invite: PartnerInvite | null = null;
  try {
    invite = await net.findInviteByToken(supabase, token);
  } catch (err) {
    if ((err as { code?: string })?.code === 'pm_forbidden' || (err as { status?: number })?.status === 403) {
      throw new HttpError(
        503,
        'Cross-org invite redemption needs the accept_partner_invite RPC (service-side). Apply it or accept from a shared demo tenant for now.',
        'pm_invite_cross_org',
      );
    }
    throw err;
  }

  if (!invite) throw new HttpError(404, 'Invite not found.', 'pm_invite_not_found');
  if (invite.status === 'accepted') {
    throw new HttpError(409, 'Invite already accepted.', 'pm_invite_already_accepted');
  }
  if (invite.status === 'revoked' || invite.status === 'expired' || invite.status === 'declined') {
    throw new HttpError(410, `Invite is ${invite.status}.`, 'pm_invite_unusable');
  }
  if (new Date(invite.expiresAt).getTime() < Date.now()) {
    await net.updateInvite(supabase, invite.id, { status: 'expired' });
    throw new HttpError(410, 'Invite expired.', 'pm_invite_expired');
  }

  const partnerProfile = await net.upsertProfile(supabase, inviteeOrgId, {
    display_name: profile.displayName,
    kind: profile.kind,
    trades: profile.trades ?? invite.trades,
    discoverable: true,
  });

  const updated = await net.updateInvite(supabase, invite.id, {
    status: 'accepted',
    accepted_org_id: inviteeOrgId,
    accepted_at: new Date().toISOString(),
  });

  // If the acceptor can see the invite (same-tenant / elevated), also write the
  // partnership now. claimAcceptedInvites covers the cross-org case for the inviter.
  try {
    await net.createPartnership(supabase, invite.orgId, {
      partner_org_id: inviteeOrgId,
      partner_kind: invite.inviteeKind,
      status: 'active',
      invite_id: invite.id,
      created_by: inviteeUserId,
    });
    await net.bumpInviteCounters(supabase, invite.orgId, 'invites_accepted');
  } catch {
    // Inviter will claim on their next Network tab load.
  }

  return { invite: updated, profile: partnerProfile };
}

/** Inviter side: turn accepted invites into partnership rows. */
export async function claimAcceptedInvites(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<Partnership[]> {
  const invites = await net.listInvites(supabase, orgId, {
    status: ['accepted'],
  });
  const existing = await net.listPartnerships(supabase, orgId);
  const have = new Set(existing.map((p) => p.partnerOrgId));
  const created: Partnership[] = [];

  for (const invite of invites) {
    if (!invite.acceptedOrgId || have.has(invite.acceptedOrgId)) continue;
    const partnership = await net.createPartnership(supabase, orgId, {
      partner_org_id: invite.acceptedOrgId,
      partner_kind: invite.inviteeKind,
      status: 'active',
      invite_id: invite.id,
      created_by: userId,
    });
    created.push(partnership);
    await net.bumpInviteCounters(supabase, orgId, 'invites_accepted');
    have.add(invite.acceptedOrgId);

    await ensureAdaptationApplied(supabase, orgId, userId, {
      action: 'open',
      kind: 'network',
      mode: 'live',
      urgency: 'normal',
      title: `Partner on board · ${invite.inviteeCompany || invite.inviteeName}`,
      originKey: `network:partnership:${partnership.id}`,
      reason: 'Invite accepted — partnership is live on Atmosphere.',
      projectId: invite.projectId,
      seedMessage: `${invite.inviteeName} joined Atmosphere as a ${invite.inviteeKind}. You can now coordinate on-platform instead of chasing texts.`,
    });
  }

  return created;
}

export async function networkSummary(
  supabase: SupabaseClient,
  orgId: string,
  orgName: string,
): Promise<{
  profile: PartnerProfile;
  partnerships: Partnership[];
  invites: PartnerInvite[];
  counts: {
    partners: number;
    pendingInvites: number;
    preferred: number;
  };
}> {
  const profile = await ensureOwnProfile(supabase, orgId, orgName);
  const [partnerships, invites] = await Promise.all([
    net.listPartnerships(supabase, orgId),
    net.listInvites(supabase, orgId),
  ]);

  return {
    profile,
    partnerships,
    invites,
    counts: {
      partners: partnerships.filter((p) => p.status === 'active').length,
      pendingInvites: invites.filter((i) => i.status === 'pending' || i.status === 'sent').length,
      preferred: partnerships.filter((p) => p.preferred && p.status === 'active').length,
    },
  };
}
