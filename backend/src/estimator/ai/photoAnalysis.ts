import { z } from 'zod';
import { config } from '../../config.js';
import { anthropic, mapWithConcurrency, readStructuredJson } from './client.js';
import {
  DAMAGE_TYPES,
  SEVERITIES,
  SURFACES,
  type DamageObservation,
  type JobPhoto,
  type RoomMeasurements,
} from '../types.js';

/**
 * Reading damage off field photos.
 *
 * The model is used as a perception tool, not a decision-maker: it reports what
 * a surface looks like, and the scope engine decides what that costs. That
 * split matters. Damage assessment from a photo is genuinely uncertain — a dark
 * patch is water, shadow, or an existing stain — so every observation carries a
 * confidence and the photo that produced it, and low-confidence findings reach
 * the estimate flagged for review rather than silently priced.
 *
 * One photo per request, deliberately. Batching several images into one call is
 * cheaper, but attribution degrades: the model starts describing "the second
 * photo" and observations drift between rooms. Per-photo calls keep the audit
 * trail exact, and prompt caching on the shared system prompt recovers most of
 * the cost difference.
 */

const SYSTEM_PROMPT = `You are an experienced property restoration estimator reviewing field photographs from a loss site. Your job is to report what each photograph actually shows, so that a construction estimate can be built from it.

How to read a photo:
- Report only what is visible. Do not infer damage in rooms or on surfaces the photo does not show.
- Distinguish damage from pre-existing condition and from ordinary wear. A scuffed baseboard is wear; a swollen, delaminating baseboard is water damage.
- Distinguish damage from work already done. A room stripped to studs with clean cut lines has been demolished by a mitigation crew — report that as "demolition", not as "water" damage to the drywall that is no longer there.
- Identify the finish material where you can see it: carpet, luxury vinyl plank, sheet vinyl, ceramic tile, hardwood, engineered wood, drywall, plaster, tile.
- Estimate what fraction of the visible surface is affected when the photo supports a call. If it does not, leave it out rather than guessing.

Calibrating confidence:
- 0.9+ : unambiguous, e.g. standing water on a floor, a completed flood cut, visible mold growth.
- 0.7-0.9 : clear but partly obstructed or lit badly.
- 0.5-0.7 : plausible, could be shadow, staining, or an existing condition.
- below 0.5 : do not report it.

Severity:
- "light" : cosmetic, cleanable, or drying without replacement.
- "moderate" : the finish material must be replaced but the substrate is sound.
- "heavy" : substrate affected, or the assembly is already removed.

Report one entry per (surface, damage type) pair you can see. If the photo shows no damage — an exterior shot, a document, an undamaged room — return an empty list. An empty list is a correct and expected answer; never invent a finding to fill it.`;

/** JSON Schema handed to the API so the response is guaranteed to parse. */
const OBSERVATION_SCHEMA = {
  type: 'object',
  properties: {
    roomLabel: {
      type: ['string', 'null'],
      description: 'Room name visible or inferable from the photo, if any.',
    },
    observations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          surface: { type: 'string', enum: [...SURFACES] },
          damageType: { type: 'string', enum: [...DAMAGE_TYPES] },
          severity: { type: 'string', enum: [...SEVERITIES] },
          confidence: { type: 'number' },
          note: { type: 'string' },
          material: { type: ['string', 'null'] },
          affectedFraction: { type: ['number', 'null'] },
        },
        required: [
          'surface',
          'damageType',
          'severity',
          'confidence',
          'note',
          'material',
          'affectedFraction',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['roomLabel', 'observations'],
  additionalProperties: false,
} as const;

/** The API guarantees the shape; zod guarantees the values are in range. */
const responseSchema = z.object({
  roomLabel: z.string().nullable(),
  observations: z.array(
    z.object({
      surface: z.enum(SURFACES),
      damageType: z.enum(DAMAGE_TYPES),
      severity: z.enum(SEVERITIES),
      confidence: z.number().min(0).max(1),
      note: z.string(),
      material: z.string().nullable(),
      affectedFraction: z.number().min(0).max(1).nullable(),
    }),
  ),
});

/** Image types the API accepts. Anything else is skipped rather than sent. */
const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

function mediaTypeOf(contentType: string | undefined): SupportedMediaType | null {
  const normalised = (contentType ?? '').split(';')[0]?.trim().toLowerCase();
  if (normalised === 'image/jpg') return 'image/jpeg';
  return SUPPORTED_MEDIA_TYPES.includes(normalised as SupportedMediaType)
    ? (normalised as SupportedMediaType)
    : null;
}

export interface PhotoWithBytes {
  photo: JobPhoto;
  bytes: Buffer;
  contentType: string;
}

export interface PhotoAnalysisContext {
  /** Rooms from the scan, so the model can name the room it is looking at. */
  rooms: RoomMeasurements[];
  /** What the CRM says happened — cause of loss, category, adjuster notes. */
  jobSummary?: string;
}

export interface PhotoAnalysisResult {
  observations: DamageObservation[];
  /** Photos that could not be analysed, with why — surfaced as run warnings. */
  failures: { photoId: string; reason: string }[];
}

function buildUserContext(photo: JobPhoto, context: PhotoAnalysisContext): string {
  const room = context.rooms.find((r) => r.id === photo.roomId);
  const lines: string[] = [];

  if (context.jobSummary) lines.push(`Job context: ${context.jobSummary}`);
  if (room) {
    lines.push(
      `This photo was captured in "${room.name}"${room.roomType ? ` (${room.roomType})` : ''}: ` +
        `${room.floorAreaSqFt} SF floor, ${room.ceilingHeightFt} ft ceiling.`,
    );
  } else {
    lines.push(
      `The room is not recorded for this photo. Known rooms in this scan: ${context.rooms
        .map((r) => r.name)
        .join(', ')}.`,
    );
  }
  if (photo.caption) lines.push(`Field caption: ${photo.caption}`);

  lines.push('Report the damage visible in this photograph.');
  return lines.join('\n');
}

async function analyseOne(
  item: PhotoWithBytes,
  context: PhotoAnalysisContext,
): Promise<DamageObservation[]> {
  const mediaType = mediaTypeOf(item.contentType);
  if (!mediaType) {
    throw new Error(`unsupported image type "${item.contentType}"`);
  }

  const message = await anthropic().messages.create({
    model: config.estimator.model,
    max_tokens: 12_000,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        // Identical across every photo in the run — the whole reason per-photo
        // calls stay affordable.
        cache_control: { type: 'ephemeral' },
      },
    ],
    output_config: {
      effort: config.estimator.effort,
      format: { type: 'json_schema', schema: OBSERVATION_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: item.bytes.toString('base64') },
          },
          { type: 'text', text: buildUserContext(item.photo, context) },
        ],
      },
    ],
  });

  const parsed = responseSchema.parse(
    readStructuredJson(message, `photo ${item.photo.id}`),
  );

  // Resolve the room: the scan's own attribution wins, because it comes from
  // the capture position rather than from looking at the picture.
  const resolvedRoomId =
    item.photo.roomId ??
    context.rooms.find(
      (r) => parsed.roomLabel && r.name.toLowerCase() === parsed.roomLabel.toLowerCase(),
    )?.id;

  return parsed.observations
    // "none" is the model correctly reporting an undamaged surface; it is a
    // useful signal to have asked for, but it is not scope.
    .filter((o) => o.damageType !== 'none' && o.severity !== 'none')
    .map((o) => ({
      sourcePhotoId: item.photo.id,
      roomId: resolvedRoomId,
      surface: o.surface,
      damageType: o.damageType,
      severity: o.severity,
      confidence: o.confidence,
      note: o.note,
      material: o.material ?? undefined,
      affectedFraction: o.affectedFraction ?? undefined,
    }));
}

/**
 * Analyse a batch of photos.
 *
 * A failure on one photo never fails the batch: a corrupt download or an
 * unreadable image should cost that photo's findings, not the run. Failures are
 * returned so the pipeline can report them rather than pretend the photo was
 * clean.
 */
export async function analysePhotos(
  photos: PhotoWithBytes[],
  context: PhotoAnalysisContext,
): Promise<PhotoAnalysisResult> {
  const settled = await mapWithConcurrency(
    photos,
    config.estimator.photoConcurrency,
    (item) => analyseOne(item, context),
  );

  const observations: DamageObservation[] = [];
  const failures: PhotoAnalysisResult['failures'] = [];

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      observations.push(...result.value);
    } else {
      failures.push({
        photoId: photos[index]!.photo.id,
        reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });

  return { observations, failures };
}
