import { randomBytes } from 'node:crypto';
import type { Session, User } from '@supabase/supabase-js';
import { createAdminClient, createAnonClient } from '../lib/supabase.js';
import { HttpError, serviceUnavailable } from '../lib/errors.js';
import { toOrgProductRole } from '../lib/productRoles.js';
import { linkFieldOffice, serializeFieldOrg } from './officeLink.js';

/** Synthetic inbox for Field Capture crew logins — never mailed. */
export const FIELD_CAPTURE_EMAIL_DOMAIN = 'field.atmosphere.app';

export function normalizeCrewName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function crewNameKey(name: string): string {
  return normalizeCrewName(name).toLowerCase();
}

export function isFieldCaptureEmail(email: string | null | undefined): boolean {
  return Boolean(email?.toLowerCase().endsWith(`@${FIELD_CAPTURE_EMAIL_DOMAIN}`));
}

/** Name+code crew login matches Employees (including remapped field techs). */
export function isCrewLoginMember(role: string | undefined, email: string | null | undefined): boolean {
  return toOrgProductRole(role) === 'employee' || isFieldCaptureEmail(email);
}

/**
 * Stable per-person address inside one office. The same name + join code
 * signs Nick back into the same Atmosphere user on a new phone.
 */
export function fieldCaptureEmail(orgId: string, name: string): string {
  const slug = crewNameKey(name)
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 48);
  const org = orgId.replace(/-/g, '').slice(0, 12);
  return `${slug || 'crew'}.${org}@${FIELD_CAPTURE_EMAIL_DOMAIN}`;
}

type OrgRow = {
  id: string;
  name: string;
  join_code: string;
  contractor_type?: string | null;
};

type MemberRow = { user_id: string; role: string };
type ProfileRow = { id: string; full_name: string | null; email: string | null };

function adminOrThrow() {
  const admin = createAdminClient();
  if (!admin) {
    throw serviceUnavailable(
      'Field Capture cannot join an office until the server has a service role key.',
      'admin_unavailable',
    );
  }
  return admin;
}

export async function previewOfficePublic(
  joinCode: string,
): Promise<{ name: string; joinCode: string }> {
  const admin = adminOrThrow();
  const { data, error } = await admin
    .from('orgs')
    .select('name, join_code')
    .eq('join_code', joinCode)
    .maybeSingle();
  if (error) {
    throw new HttpError(400, 'That join code did not match any organization.', 'join_org_failed');
  }
  if (!data?.name) {
    throw new HttpError(400, 'That join code did not match any organization.', 'join_org_failed');
  }
  return { name: data.name as string, joinCode: (data.join_code as string) ?? joinCode };
}

async function loadOffice(joinCode: string): Promise<OrgRow> {
  const admin = adminOrThrow();
  const { data, error } = await admin
    .from('orgs')
    .select('id, name, join_code, contractor_type')
    .eq('join_code', joinCode)
    .maybeSingle();
  if (error || !data?.id) {
    throw new HttpError(400, 'That join code did not match any organization.', 'join_org_failed');
  }
  return data as OrgRow;
}

async function findCrewMember(
  orgId: string,
  name: string,
): Promise<{ userId: string; email: string | null } | null> {
  const admin = adminOrThrow();
  const { data: members, error: memberError } = await admin
    .from('org_members')
    .select('user_id, role')
    .eq('org_id', orgId);
  if (memberError) {
    throw new HttpError(500, memberError.message, 'crew_lookup_failed');
  }
  const rows = (members ?? []) as MemberRow[];
  if (!rows.length) return null;

  const { data: profiles, error: profileError } = await admin
    .from('profiles')
    .select('id, full_name, email')
    .in(
      'id',
      rows.map((m) => m.user_id),
    );
  if (profileError) {
    throw new HttpError(500, profileError.message, 'crew_lookup_failed');
  }

  const key = crewNameKey(name);
  const byId = new Map(rows.map((m) => [m.user_id, m]));
  const matches = ((profiles ?? []) as ProfileRow[]).filter((p) => {
    if (crewNameKey(p.full_name ?? '') !== key) return false;
    const member = byId.get(p.id);
    return isCrewLoginMember(member?.role, p.email);
  });
  if (!matches.length) return null;
  const hit = matches[0];
  return { userId: hit.id, email: hit.email };
}

async function mintSession(userId: string, email: string): Promise<{ user: User; session: Session }> {
  const admin = adminOrThrow();
  const link = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  const tokenHash = link.data.properties?.hashed_token;
  if (!link.error && tokenHash) {
    const verified = await createAnonClient().auth.verifyOtp({
      type: 'email',
      token_hash: tokenHash,
    });
    if (verified.data.session && verified.data.user) {
      return { user: verified.data.user, session: verified.data.session };
    }
  }

  // Fallback when magic-link exchange is unavailable: rotate a throwaway
  // password. Only used for field-capture inboxes we created.
  if (!isFieldCaptureEmail(email)) {
    throw new HttpError(500, 'Could not open that crew login.', 'crew_session_failed');
  }
  const password = randomBytes(24).toString('base64url');
  const updated = await admin.auth.admin.updateUserById(userId, {
    password,
    email_confirm: true,
  });
  if (updated.error || !updated.data.user) {
    throw new HttpError(500, 'Could not open that crew login.', 'crew_session_failed');
  }

  const signedIn = await createAnonClient().auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session || !signedIn.data.user) {
    throw new HttpError(500, 'Could not open that crew login.', 'crew_session_failed');
  }
  return { user: signedIn.data.user, session: signedIn.data.session };
}

async function createCrewUser(orgId: string, name: string): Promise<{ user: User; session: Session; email: string }> {
  const admin = adminOrThrow();
  const email = fieldCaptureEmail(orgId, name);
  const password = randomBytes(24).toString('base64url');

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
    app_metadata: { field_capture: true },
  });

  if (created.error) {
    if (/already|registered|exists/i.test(created.error.message)) {
      const { data: profile } = await admin
        .from('profiles')
        .select('id, email')
        .eq('email', email)
        .maybeSingle();
      if (profile?.id) {
        const minted = await mintSession(profile.id as string, email);
        return { ...minted, email };
      }
    }
    throw new HttpError(400, 'Could not create that crew login.', 'crew_create_failed');
  }

  if (!created.data.user) {
    throw new HttpError(500, 'Could not create that crew login.', 'crew_create_failed');
  }

  const anon = createAnonClient();
  const signedIn = await anon.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session || !signedIn.data.user) {
    throw new HttpError(500, 'Could not open that crew login.', 'crew_session_failed');
  }
  return { user: signedIn.data.user, session: signedIn.data.session, email };
}

async function authEmailFor(userId: string, profileEmail: string | null): Promise<string> {
  if (profileEmail) return profileEmail;
  const admin = adminOrThrow();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  const email = data.user?.email;
  if (error || !email) {
    throw new HttpError(500, 'That crew login is missing an email on file.', 'crew_session_failed');
  }
  return email;
}

/**
 * Name + office join code → Atmosphere session on that company.
 *
 * Returning the same name and code on a new phone reopens the same
 * field-technician user so the office still assigns work to Nick Smith.
 */
export async function joinCrewByName(input: { fullName: string; joinCode: string }) {
  const fullName = normalizeCrewName(input.fullName);
  const org = await loadOffice(input.joinCode);

  const existing = await findCrewMember(org.id, fullName);
  if (existing) {
    const email = await authEmailFor(existing.userId, existing.email);
    const { user, session } = await mintSession(existing.userId, email);
    await linkFieldOffice(session.access_token, user, {
      fullName,
      joinCode: input.joinCode,
    });
    return { user, session, org: serializeFieldOrg(org), created: false };
  }

  const created = await createCrewUser(org.id, fullName);
  const linked = await linkFieldOffice(created.session.access_token, created.user, {
    fullName,
    joinCode: input.joinCode,
  });
  return {
    user: created.user,
    session: created.session,
    org: linked ?? serializeFieldOrg(org),
    created: true,
  };
}
