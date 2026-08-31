/**
 * Shape a resolved (or typed) site address into crm_properties columns.
 * Lengths match the table checks so a Google-formatted line cannot fail
 * the insert with "Could not save the address."
 */

import type { ResolvedAddress } from './osmPlaces.js';

const US_ZIP = /\b(\d{5})(?:-\d{4})?\b/;
const UK_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

export function cityPostalFromAddress(formatted: string): { city: string; postalCode: string } {
  const uk = formatted.match(UK_POSTCODE);
  const postal = uk ? `${uk[1]!.toUpperCase()} ${uk[2]!.toUpperCase()}` : (formatted.match(US_ZIP)?.[1] ?? '');
  const bits = formatted.split(',').map((s) => s.trim()).filter(Boolean);
  let city = '';
  if (bits.length >= 2) {
    city = bits[1]!.replace(/\s+[A-Z]{2}$/, '').replace(UK_POSTCODE, '').trim();
  }
  return { city, postalCode: postal };
}

export function normalizeCountry(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw) return 'US';
  const t = raw.toUpperCase();
  if (t === 'UK' || t === 'UNITED KINGDOM' || t === 'GREAT BRITAIN' || t === 'WALES' || t === 'ENGLAND' || t === 'SCOTLAND' || t === 'NORTHERN IRELAND') {
    return 'GB';
  }
  if (t === 'UNITED STATES' || t === 'USA' || t === 'U.S.' || t === 'U.S.A.') return 'US';
  if (t.length === 2) return t;
  return raw.slice(0, 2).toUpperCase() || 'US';
}

function finiteCoord(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function propertyRowFromResolved(
  orgId: string,
  resolved: ResolvedAddress,
  fallbackLine: string,
): Record<string, unknown> {
  const line1 = (resolved.addressLine1 || resolved.formatted || fallbackLine).trim().slice(0, 200);
  const parsed = cityPostalFromAddress(resolved.formatted || fallbackLine);
  return {
    org_id: orgId,
    address_line1: line1 || fallbackLine.trim().slice(0, 200),
    city: (resolved.city || parsed.city).trim().slice(0, 120) || null,
    region: (resolved.state || '').trim().slice(0, 120) || null,
    postal_code: (resolved.postalCode || parsed.postalCode).trim().slice(0, 20) || null,
    country: normalizeCountry(resolved.country),
    latitude: finiteCoord(resolved.lat),
    longitude: finiteCoord(resolved.lng),
  };
}

export function siteAddressFacts(
  site: { line: string; city?: string | null; postalCode?: string | null },
  extra?: Record<string, string>,
): Record<string, string> {
  const display = [site.line, site.city, site.postalCode].filter(Boolean).join(', ');
  return {
    ...(extra ?? {}),
    Site: site.line,
    'Site address': display,
  };
}

export function propertyRowFromTyped(
  orgId: string,
  address: string,
  city?: string | null,
  postalCode?: string | null,
): Record<string, unknown> {
  const parsed = cityPostalFromAddress(address);
  return {
    org_id: orgId,
    address_line1: address.trim().slice(0, 200),
    city: (city || parsed.city).trim().slice(0, 120) || null,
    postal_code: (postalCode || parsed.postalCode).trim().slice(0, 20) || null,
  };
}
