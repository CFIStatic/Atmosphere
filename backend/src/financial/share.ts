import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAnonClient } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { finishRun, startRun, step } from './ledger.js';
import {
  buildSharePayloads,
  DEFAULT_SHARE_SECTIONS,
  type ShareSections,
} from './report.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ABSENT_CODES = new Set(['42P01', '42883', 'PGRST202', 'PGRST205']);

function isAbsent(error: { code?: string } | null): boolean {
  return Boolean(error?.code && ABSENT_CODES.has(error.code));
}

function fail(error: { message?: string; code?: string } | null, what: string): never {
  if (error && isAbsent(error)) {
    throw new HttpError(
      503,
      'Financial share tables are not set up yet. Apply supabase/migrations/20260728170000_financial_share_dataroom.sql, then try again.',
      'finance_share_not_configured',
    );
  }
  throw new HttpError(500, error?.message ?? `Could not ${what}.`, 'finance_share_failed');
}

export const SHARE_DOCUMENT_KINDS = [
  'articles_of_incorporation',
  'operating_agreement',
  'ein_letter',
  'business_license',
  'contractor_license',
  'insurance_coi',
  'tax_return',
  'financial_statement',
  'bank_statement',
  'ar_aging',
  'job_cost_summary',
  'org_chart',
  'resume_key_person',
  'other',
] as const;

export type ShareDocumentKind = (typeof SHARE_DOCUMENT_KINDS)[number];

export const SHARE_PURPOSES = [
  'loan',
  'insurance',
  'investor',
  'auditor',
  'partner',
  'other',
] as const;

export interface SharePackage {
  id: string;
  orgId: string;
  title: string;
  purpose: string;
  recipientName: string | null;
  recipientOrg: string | null;
  recipientEmail: string | null;
  coverNote: string | null;
  status: string;
  sections: ShareSections;
  report: Record<string, unknown>;
  companyProfile: Record<string, unknown>;
  publishedAt: string | null;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  documentCount?: number;
  linkCount?: number;
}

export interface ShareDocument {
  id: string;
  packageId: string;
  title: string;
  kind: string;
  description: string | null;
  externalRef: string | null;
  periodLabel: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface ShareLink {
  id: string;
  packageId: string;
  tokenPrefix: string;
  label: string | null;
  expiresAt: string;
  maxViews: number | null;
  viewCount: number;
  lastViewedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  /** Only present at mint time. */
  token?: string;
  url?: string;
}

function serializePackage(r: any): SharePackage {
  return {
    id: r.id,
    orgId: r.org_id,
    title: r.title,
    purpose: r.purpose,
    recipientName: r.recipient_name ?? null,
    recipientOrg: r.recipient_org ?? null,
    recipientEmail: r.recipient_email ?? null,
    coverNote: r.cover_note ?? null,
    status: r.status,
    sections: { ...DEFAULT_SHARE_SECTIONS, ...(r.sections ?? {}) },
    report: r.report ?? {},
    companyProfile: r.company_profile ?? {},
    publishedAt: r.published_at ?? null,
    revokedAt: r.revoked_at ?? null,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function serializeDocument(r: any): ShareDocument {
  return {
    id: r.id,
    packageId: r.package_id,
    title: r.title,
    kind: r.kind,
    description: r.description ?? null,
    externalRef: r.external_ref ?? null,
    periodLabel: r.period_label ?? null,
    sortOrder: r.sort_order ?? 0,
    createdAt: r.created_at,
  };
}

function serializeLink(r: any): ShareLink {
  return {
    id: r.id,
    packageId: r.package_id,
    tokenPrefix: r.token_prefix,
    label: r.label ?? null,
    expiresAt: r.expires_at,
    maxViews: r.max_views ?? null,
    viewCount: r.view_count ?? 0,
    lastViewedAt: r.last_viewed_at ?? null,
    revokedAt: r.revoked_at ?? null,
    createdAt: r.created_at,
  };
}

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function mintRawToken(): { token: string; hash: string; prefix: string } {
  const token = `fs_${randomBytes(32).toString('hex')}`;
  return { token, hash: hashShareToken(token), prefix: token.slice(0, 10) };
}

export async function listPackages(
  supabase: SupabaseClient,
  orgId: string,
): Promise<SharePackage[]> {
  const { data, error } = await supabase
    .from('finance_share_packages')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) fail(error, 'list share packages');

  const packages = (data ?? []).map(serializePackage);
  if (packages.length === 0) return packages;

  const ids = packages.map((p) => p.id);
  const [{ data: docs }, { data: links }] = await Promise.all([
    supabase.from('finance_share_documents').select('package_id').in('package_id', ids),
    supabase.from('finance_share_links').select('package_id').in('package_id', ids),
  ]);

  const docCounts = new Map<string, number>();
  for (const d of docs ?? []) {
    docCounts.set(d.package_id, (docCounts.get(d.package_id) ?? 0) + 1);
  }
  const linkCounts = new Map<string, number>();
  for (const l of links ?? []) {
    linkCounts.set(l.package_id, (linkCounts.get(l.package_id) ?? 0) + 1);
  }

  return packages.map((p) => ({
    ...p,
    documentCount: docCounts.get(p.id) ?? 0,
    linkCount: linkCounts.get(p.id) ?? 0,
  }));
}

export async function getPackage(
  supabase: SupabaseClient,
  orgId: string,
  id: string,
): Promise<{
  package: SharePackage;
  documents: ShareDocument[];
  links: ShareLink[];
}> {
  const { data, error } = await supabase
    .from('finance_share_packages')
    .select('*')
    .eq('org_id', orgId)
    .eq('id', id)
    .maybeSingle();
  if (error) fail(error, 'load share package');
  if (!data) throw new HttpError(404, 'Share package not found.', 'finance_share_not_found');

  const [docs, links] = await Promise.all([
    supabase
      .from('finance_share_documents')
      .select('*')
      .eq('package_id', id)
      .order('sort_order', { ascending: true }),
    supabase
      .from('finance_share_links')
      .select('*')
      .eq('package_id', id)
      .order('created_at', { ascending: false }),
  ]);

  if (docs.error) fail(docs.error, 'list documents');
  if (links.error) fail(links.error, 'list links');

  return {
    package: serializePackage(data),
    documents: (docs.data ?? []).map(serializeDocument),
    links: (links.data ?? []).map(serializeLink),
  };
}

export interface CreatePackageInput {
  title: string;
  purpose: string;
  recipientName?: string | null;
  recipientOrg?: string | null;
  recipientEmail?: string | null;
  coverNote?: string | null;
  sections?: Partial<ShareSections>;
  /** When true, freeze report and set status active immediately. */
  publish?: boolean;
  /** Also mint a link when publishing. */
  expiresInDays?: number;
  linkLabel?: string | null;
  maxViews?: number | null;
  publicOrigin?: string;
}

export async function createPackage(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  input: CreatePackageInput,
): Promise<{
  package: SharePackage;
  link: ShareLink | null;
}> {
  const run = await startRun(supabase, {
    orgId,
    title: `Build financial share: ${input.title}`,
    actorType: 'user',
    actorUserId: userId,
    input: { purpose: input.purpose, publish: Boolean(input.publish) },
  });
  const startedAt = Date.now();

  try {
    const { report, companyProfile } = await buildSharePayloads(supabase, orgId);
    await step(supabase, run, {
      type: 'artifact',
      action: 'build_report',
      detail: `Frozen report for ${companyProfile.orgName}.`,
      payload: {
        openArCents: report.receivables.openArCents,
        cashCents: report.cash.onHandCents,
        teamSize: companyProfile.team.length,
      },
    });

    const sections = { ...DEFAULT_SHARE_SECTIONS, ...(input.sections ?? {}) };
    const publish = Boolean(input.publish);
    const { data, error } = await supabase
      .from('finance_share_packages')
      .insert({
        org_id: orgId,
        title: input.title,
        purpose: input.purpose,
        recipient_name: input.recipientName ?? null,
        recipient_org: input.recipientOrg ?? null,
        recipient_email: input.recipientEmail ?? null,
        cover_note: input.coverNote ?? null,
        sections,
        report,
        company_profile: companyProfile,
        status: publish ? 'active' : 'draft',
        published_at: publish ? new Date().toISOString() : null,
        created_by: userId,
      })
      .select('*')
      .single();
    if (error) fail(error, 'create share package');

    let link: ShareLink | null = null;
    if (publish) {
      link = await mintLink(supabase, orgId, userId, data.id, {
        expiresInDays: input.expiresInDays ?? 14,
        label: input.linkLabel ?? input.recipientOrg ?? input.recipientName ?? 'Third party',
        maxViews: input.maxViews ?? null,
        publicOrigin: input.publicOrigin,
      });
    }

    await finishRun(supabase, run, {
      status: 'succeeded',
      summary: publish
        ? `Published financial dataroom "${input.title}".`
        : `Drafted financial dataroom "${input.title}".`,
      result: { packageId: data.id, published: publish },
      startedAt,
    });

    return { package: serializePackage(data), link };
  } catch (err) {
    await finishRun(supabase, run, {
      status: 'failed',
      error: (err as Error).message,
      startedAt,
    });
    throw err;
  }
}

export async function publishPackage(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  packageId: string,
  opts: { refreshReport?: boolean; expiresInDays?: number; linkLabel?: string | null; maxViews?: number | null; publicOrigin?: string } = {},
): Promise<{ package: SharePackage; link: ShareLink }> {
  const existing = await getPackage(supabase, orgId, packageId);
  if (existing.package.status === 'revoked') {
    throw new HttpError(400, 'A revoked package cannot be republished.', 'finance_share_revoked');
  }

  let report = existing.package.report;
  let companyProfile = existing.package.companyProfile;
  if (opts.refreshReport !== false) {
    const built = await buildSharePayloads(supabase, orgId);
    report = built.report as unknown as Record<string, unknown>;
    companyProfile = built.companyProfile as unknown as Record<string, unknown>;
  }

  const { data, error } = await supabase
    .from('finance_share_packages')
    .update({
      report,
      company_profile: companyProfile,
      status: 'active',
      published_at: new Date().toISOString(),
      revoked_at: null,
      revoked_by: null,
    })
    .eq('id', packageId)
    .eq('org_id', orgId)
    .select('*')
    .single();
  if (error) fail(error, 'publish share package');

  const link = await mintLink(supabase, orgId, userId, packageId, {
    expiresInDays: opts.expiresInDays ?? 14,
    label: opts.linkLabel ?? existing.package.recipientOrg ?? 'Third party',
    maxViews: opts.maxViews ?? null,
    publicOrigin: opts.publicOrigin,
  });

  return { package: serializePackage(data), link };
}

export async function revokePackage(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  packageId: string,
): Promise<SharePackage> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('finance_share_packages')
    .update({
      status: 'revoked',
      revoked_at: now,
      revoked_by: userId,
    })
    .eq('id', packageId)
    .eq('org_id', orgId)
    .select('*')
    .single();
  if (error) fail(error, 'revoke share package');

  await supabase
    .from('finance_share_links')
    .update({ revoked_at: now, revoked_by: userId })
    .eq('package_id', packageId)
    .is('revoked_at', null);

  return serializePackage(data);
}

export async function addDocument(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  packageId: string,
  input: {
    title: string;
    kind: string;
    description?: string | null;
    externalRef?: string | null;
    periodLabel?: string | null;
    sortOrder?: number;
  },
): Promise<ShareDocument> {
  const { data: pkg } = await supabase
    .from('finance_share_packages')
    .select('id')
    .eq('id', packageId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (!pkg) throw new HttpError(404, 'Share package not found.', 'finance_share_not_found');

  const { data, error } = await supabase
    .from('finance_share_documents')
    .insert({
      org_id: orgId,
      package_id: packageId,
      title: input.title,
      kind: input.kind,
      description: input.description ?? null,
      external_ref: input.externalRef ?? null,
      period_label: input.periodLabel ?? null,
      sort_order: input.sortOrder ?? 0,
      created_by: userId,
    })
    .select('*')
    .single();
  if (error) fail(error, 'add document');
  return serializeDocument(data);
}

export async function removeDocument(
  supabase: SupabaseClient,
  orgId: string,
  documentId: string,
): Promise<void> {
  const { error } = await supabase
    .from('finance_share_documents')
    .delete()
    .eq('id', documentId)
    .eq('org_id', orgId);
  if (error) fail(error, 'remove document');
}

export async function mintLink(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  packageId: string,
  opts: {
    expiresInDays: number;
    label?: string | null;
    maxViews?: number | null;
    publicOrigin?: string;
  },
): Promise<ShareLink> {
  const { token, hash, prefix } = mintRawToken();
  const expiresAt = new Date(
    Date.now() + Math.max(1, opts.expiresInDays) * 86_400_000,
  ).toISOString();

  const { data, error } = await supabase
    .from('finance_share_links')
    .insert({
      org_id: orgId,
      package_id: packageId,
      token_hash: hash,
      token_prefix: prefix,
      label: opts.label ?? null,
      expires_at: expiresAt,
      max_views: opts.maxViews ?? null,
      created_by: userId,
    })
    .select('*')
    .single();
  if (error) fail(error, 'mint share link');

  const origin = (opts.publicOrigin ?? '').replace(/\/$/, '');
  const url = origin ? `${origin}/share/finance/${token}` : `/share/finance/${token}`;

  return { ...serializeLink(data), token, url };
}

export async function revokeLink(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  linkId: string,
): Promise<ShareLink> {
  const { data, error } = await supabase
    .from('finance_share_links')
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: userId,
    })
    .eq('id', linkId)
    .eq('org_id', orgId)
    .select('*')
    .single();
  if (error) fail(error, 'revoke share link');
  return serializeLink(data);
}

/**
 * Open a share for a third party. Uses the anon client + SECURITY DEFINER RPC
 * so it works without a user session and without the service-role key.
 */
export async function openPublicShare(token: string): Promise<Record<string, unknown>> {
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc('open_finance_share', { p_token: token });
  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('not found') || error.code === 'P0002') {
      throw new HttpError(404, 'This share link is invalid or has been removed.', 'share_not_found');
    }
    if (msg.includes('expired')) {
      throw new HttpError(410, 'This share link has expired.', 'share_expired');
    }
    if (msg.includes('revoked')) {
      throw new HttpError(410, 'This share link has been revoked.', 'share_revoked');
    }
    if (msg.includes('view limit')) {
      throw new HttpError(410, 'This share link has reached its view limit.', 'share_view_limit');
    }
    if (msg.includes('not published')) {
      throw new HttpError(403, 'This package is not published yet.', 'share_not_published');
    }
    if (isAbsent(error)) {
      throw new HttpError(
        503,
        'Financial share viewing is not configured on this project yet.',
        'finance_share_not_configured',
      );
    }
    throw new HttpError(400, error.message, 'share_open_failed');
  }
  return (data ?? {}) as Record<string, unknown>;
}
