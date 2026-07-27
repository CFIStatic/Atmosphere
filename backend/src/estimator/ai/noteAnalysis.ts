import { z } from 'zod';
import { config } from '../../config.js';
import { anthropic, readStructuredJson } from './client.js';
import type { CrmJob, RoomMeasurements } from '../types.js';

/**
 * Reading the CRM job notes.
 *
 * The scan measures the building; the notes say what the job *is*. Whether the
 * carrier approved a full replacement or a flood cut, which rooms the
 * homeowner asked to leave alone, whether mitigation has already run, what
 * category of water it was — none of that is visible in a photo, and all of it
 * changes the scope. An estimator reads the notes before scoping. So does this.
 *
 * The output is deliberately narrow: rooms in and out of scope, the facts that
 * change how a room is scoped, and any explicit carrier direction. The model is
 * not asked to write scope, only to extract what a human wrote down.
 */

const SYSTEM_PROMPT = `You extract scope-relevant facts from restoration job notes written by field techs, project managers, and adjusters.

Return only what the notes actually state or clearly imply. Do not infer standard practice, do not add typical restoration steps, and do not carry over knowledge about how these jobs usually go. If the notes are silent on something, say so by leaving the field empty or null.

What matters:
- Rooms or areas explicitly named as affected, in scope, or to be rebuilt.
- Rooms or areas explicitly excluded — homeowner declined, not affected, handled separately, out of scope.
- Water category (1 clean, 2 grey, 3 black) or the fire/smoke equivalent, if stated.
- Whether mitigation or demolition has already been performed.
- Directions that change the scope: approved flood cut heights, carrier caps, "replace like for like", "customer will supply flooring", "do not touch the kitchen cabinets".
- Materials named for a room, e.g. "LVP throughout the main level".

Quote or closely paraphrase the note. Do not editorialise, and do not resolve contradictions between notes — report both.`;

const NOTES_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    roomsInScope: { type: 'array', items: { type: 'string' } },
    roomsOutOfScope: { type: 'array', items: { type: 'string' } },
    waterCategory: { type: ['integer', 'null'] },
    mitigationAlreadyPerformed: { type: ['boolean', 'null'] },
    floodCutHeightFt: { type: ['number', 'null'] },
    materialsByRoom: {
      type: 'array',
      items: {
        type: 'object',
        properties: { room: { type: 'string' }, material: { type: 'string' } },
        required: ['room', 'material'],
        additionalProperties: false,
      },
    },
    directives: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'summary',
    'roomsInScope',
    'roomsOutOfScope',
    'waterCategory',
    'mitigationAlreadyPerformed',
    'floodCutHeightFt',
    'materialsByRoom',
    'directives',
  ],
  additionalProperties: false,
} as const;

const responseSchema = z.object({
  summary: z.string(),
  roomsInScope: z.array(z.string()),
  roomsOutOfScope: z.array(z.string()),
  waterCategory: z.number().int().min(1).max(3).nullable(),
  mitigationAlreadyPerformed: z.boolean().nullable(),
  floodCutHeightFt: z.number().positive().max(12).nullable(),
  materialsByRoom: z.array(z.object({ room: z.string(), material: z.string() })),
  directives: z.array(z.string()),
});

export type JobDirectives = z.infer<typeof responseSchema>;

/** What the pipeline falls back to when notes cannot be read. */
export const EMPTY_DIRECTIVES: JobDirectives = {
  summary: '',
  roomsInScope: [],
  roomsOutOfScope: [],
  waterCategory: null,
  mitigationAlreadyPerformed: null,
  floodCutHeightFt: null,
  materialsByRoom: [],
  directives: [],
};

export async function readJobNotes(
  job: CrmJob,
  rooms: RoomMeasurements[],
): Promise<JobDirectives> {
  if (job.notes.length === 0) return EMPTY_DIRECTIVES;

  const notes = job.notes
    .map((note) => `[${note.createdAt ?? 'undated'}${note.author ? ` · ${note.author}` : ''}]\n${note.body}`)
    .join('\n\n---\n\n');

  const header = [
    `Claim: ${job.claimNumber ?? '—'}`,
    `Loss type: ${job.lossType ?? '—'}`,
    `Loss date: ${job.lossDate ?? '—'}`,
    `Rooms measured on site: ${rooms.map((r) => r.name).join(', ') || '—'}`,
  ].join('\n');

  const message = await anthropic().messages.create({
    model: config.estimator.model,
    max_tokens: 8_000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    output_config: {
      effort: config.estimator.effort,
      format: { type: 'json_schema', schema: NOTES_SCHEMA },
    },
    messages: [
      { role: 'user', content: `${header}\n\nJob notes:\n\n${notes}` },
    ],
  });

  return responseSchema.parse(readStructuredJson(message, `notes for job ${job.id}`));
}
