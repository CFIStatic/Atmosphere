import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { nameFromMetadata } from './display';

/** Same marketing contact form the /hardware Support button opens. */
export const CONTACT_PUBLIC_URL = 'https://atmosphereteam.com/contact.html';

export const PLATFORM_SUPPORT_NOTE = 'I need help with Atmosphere Platform.';

export type PlatformSupportContext = {
  email?: string | null;
  name?: string | null;
  orgName?: string | null;
  orgId?: string | null;
  plan?: string | null;
  path?: string | null;
};

function compactLine(label: string, value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? `${label}: ${trimmed}` : null;
}

/** Prefill note for the shared contact form, with Platform context for Support Bot. */
export function buildPlatformSupportNote(ctx: PlatformSupportContext = {}): string {
  const org =
    ctx.orgName?.trim() && ctx.orgId?.trim()
      ? `${ctx.orgName.trim()} (${ctx.orgId.trim()})`
      : ctx.orgName?.trim() || (ctx.orgId?.trim() ? `(${ctx.orgId.trim()})` : null);
  const details = [
    compactLine('Organization', org),
    compactLine('Plan', ctx.plan),
    compactLine('Page', ctx.path),
    compactLine('Email', ctx.email),
  ].filter((line): line is string => Boolean(line));

  if (details.length === 0) return PLATFORM_SUPPORT_NOTE;
  return `${PLATFORM_SUPPORT_NOTE}\n\n${details.join('\n')}`;
}

export function buildPlatformSupportUrl(ctx: PlatformSupportContext = {}): string {
  const url = new URL(CONTACT_PUBLIC_URL);
  url.searchParams.set('note', buildPlatformSupportNote(ctx));
  const email = ctx.email?.trim();
  const name = ctx.name?.trim();
  const company = ctx.orgName?.trim();
  if (email) url.searchParams.set('email', email);
  if (name) url.searchParams.set('name', name);
  if (company) url.searchParams.set('company', company);
  return url.toString();
}

export function openPlatformSupport(ctx: PlatformSupportContext = {}): void {
  window.open(buildPlatformSupportUrl(ctx), '_blank', 'noopener,noreferrer');
}

/** Build the Support URL from the signed-in Platform session and current route. */
export function usePlatformSupportUrl(): string {
  const { user, profile, membership } = useAuth();
  const { pathname, search } = useLocation();
  return buildPlatformSupportUrl({
    email: profile?.email ?? user?.email ?? null,
    name: profile?.fullName || nameFromMetadata(user?.metadata),
    orgName: membership?.org?.name ?? null,
    orgId: membership?.org?.id ?? null,
    path: `${pathname}${search || ''}`,
  });
}
