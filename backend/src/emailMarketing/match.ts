/**
 * Matching CRM map pins against storm footprints.
 */

import { matchPointToStorm } from './geo.js';
import type { MapContact, StormFootprint, StormMatch } from './types.js';

export function matchContactsToStorm(
  contacts: MapContact[],
  storm: StormFootprint,
): StormMatch[] {
  const matches: StormMatch[] = [];

  for (const contact of contacts) {
    const { matched, distanceMiles } = matchPointToStorm(
      { lat: contact.lat, lng: contact.lng },
      storm,
    );
    if (!matched) continue;

    let skipReason: string | null = null;
    if (contact.marketingOptOut) skipReason = 'marketing_opt_out';
    else if (!contact.email?.trim()) skipReason = 'missing_email';

    matches.push({
      contactId: contact.contactId,
      propertyId: contact.propertyId,
      name: contact.name,
      email: contact.email,
      city: contact.city,
      region: contact.region,
      lat: contact.lat,
      lng: contact.lng,
      distanceMiles,
      marketingOptOut: contact.marketingOptOut,
      skipReason,
    });
  }

  matches.sort((a, b) => a.distanceMiles - b.distanceMiles);
  return matches;
}
