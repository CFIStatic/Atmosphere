/**
 * Field Capture "new job" form → the same job-file payload office intake
 * approves. Crew name the job and the site; a situation note is optional.
 */

import { cityPostalFromAddress } from '../lib/propertyAddress.js';

export const FIELD_DEFAULT_BRIEF =
  'No work description yet. Field Capture can still film — AI will describe what happened from the video.';

export { cityPostalFromAddress };

export function workTypeFromSituation(text: string): 'mitigation' | 'construction' {
  return /mitigat|water|flood|mold|dry|extract/i.test(text) ? 'mitigation' : 'construction';
}

export function scopeFromSituation(text: string): Array<{ title: string; state: 'included' }> {
  const note = text.trim();
  if (note.length < 2) return [];
  return [{ title: note.slice(0, 200), state: 'included' }];
}

export type FieldStartJobBody = {
  title: string;
  address: string;
  city?: string;
  postalCode?: string;
  situation?: string;
};

/** Shape `createJobFile` expects from office intake approve. */
export function intakeFromFieldStart(input: FieldStartJobBody) {
  const address = input.address.trim();
  const parsed = cityPostalFromAddress(address);
  const note = (input.situation ?? '').trim();
  return {
    title: input.title.trim(),
    workType: workTypeFromSituation(note),
    address,
    city: (input.city ?? '').trim() || parsed.city || undefined,
    postalCode: (input.postalCode ?? '').trim() || parsed.postalCode || undefined,
    briefNote: note || FIELD_DEFAULT_BRIEF,
    facts: {
      Site: address,
      ...(note ? { Work: note.slice(0, 500) } : {}),
      Source: note
        ? 'Field Capture — address and work description'
        : 'Field Capture — address only',
    },
    scope: scopeFromSituation(note),
    invitees: [],
  };
}
