/**
 * Field Capture "new job" form → the same job-file payload office intake
 * approves. Crew name the job; a situation note is optional.
 */

export const FIELD_DEFAULT_BRIEF =
  'No work description yet. Field Capture can still film — AI will describe what happened from the video.';

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
  situation?: string;
};

/** Shape `createJobFile` expects from office intake approve. */
export function intakeFromFieldStart(input: FieldStartJobBody) {
  const note = (input.situation ?? '').trim();
  return {
    title: input.title.trim(),
    workType: workTypeFromSituation(note),
    address: '',
    briefNote: note || FIELD_DEFAULT_BRIEF,
    facts: {
      ...(note ? { Work: note.slice(0, 500) } : {}),
      Source: note
        ? 'Field Capture — name and work description'
        : 'Field Capture — name only',
    },
    scope: scopeFromSituation(note),
    invitees: [],
  };
}
