/**
 * File synthetic product-testing videos on an existing organization.
 *
 *   cd backend
 *   SUPABASE_SERVICE_ROLE_KEY=… npm run seed:test-video
 *   SUPABASE_SERVICE_ROLE_KEY=… npm run seed:test-video -- --catalog demo
 *
 * Defaults file one 60s "Cursor 1" clip on Jettx LLC. `--catalog demo` files
 * that clip plus the Cedar Ridge / Meridian / Camden walkthrough set as real
 * job_proofs rows with playable MP4s in `job-proofs`.
 *
 * `--catalog demo` dates clips from today backward so they sit on top of the
 * dashboard (today's job first). Re-running upserts the same party + work_date
 * + phase key and retires older jettx-demo rows that are no longer in the set.
 */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import 'dotenv/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '../lib/supabase.js';
import { verifyProof } from '../shared/proofVerifier.js';

const execFileAsync = promisify(execFile);

const PROOF_BUCKET = 'job-proofs';
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

export interface SeedVideoOptions {
  orgName: string;
  title: string;
  purpose: string;
  durationSeconds: number;
  workDate: string;
  catalog: 'demo' | null;
}

export type SeedProofPhase = 'before' | 'after';
export type SeedProofCategory = 'before' | 'after' | 'condition' | 'issue' | 'completion' | 'other';

export interface SeedClipSpec {
  jobTitle: string;
  jobPurpose: string;
  workType: 'mitigation' | 'construction';
  address: {
    label: string;
    line1: string;
    city: string;
    region: string;
    postal: string;
    lat: number;
    lon: number;
  };
  company: string;
  contactName: string;
  trade: string;
  title: string;
  purpose: string;
  phase: SeedProofPhase;
  category: SeedProofCategory;
  workDate: string;
  capturedAt: string;
  durationSeconds: number;
  color: string;
  legalHold?: boolean;
  holdReason?: string;
  lat?: number | null;
  lon?: number | null;
  accuracyM?: number | null;
}

const CEDAR = {
  jobTitle: 'Cedar Ridge — storm damage, roof tarp + rebuild',
  jobPurpose: 'Storm damage: tarp the north slope, strip to decking, replace rot, underlayment.',
  workType: 'construction' as const,
  address: {
    label: 'Cedar Ridge',
    line1: '4118 Cedar Ridge Dr',
    city: 'Austin',
    region: 'TX',
    postal: '78731',
    lat: 30.4413,
    lon: -97.7218,
  },
};

const MERIDIAN = {
  jobTitle: 'Meridian Ave — water loss, Class 3',
  jobPurpose: 'Category 2 water loss. Dry-out, flood cut, and cavity readings before close-up.',
  workType: 'mitigation' as const,
  address: {
    label: 'Meridian Ave',
    line1: '1841 Meridian Ave',
    city: 'Austin',
    region: 'TX',
    postal: '78704',
    lat: 30.2984,
    lon: -97.7431,
  },
};

const CAMDEN = {
  jobTitle: 'Camden Court — HOA clubhouse rebuild',
  jobPurpose: 'Hang board in the front room, corridor, and back office after the water loss.',
  workType: 'construction' as const,
  address: {
    label: 'Camden Court',
    line1: '900 Camden Ct',
    city: 'Round Rock',
    region: 'TX',
    postal: '78681',
    lat: 30.5083,
    lon: -97.6789,
  },
};

export function utcDayKey(now: Date, daysBack = 0): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysBack));
  return d.toISOString().slice(0, 10);
}

function shortUtcDay(day: string): string {
  return new Date(`${day}T12:00:00.000Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function at(day: string, hour: number, minute: number): string {
  return `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
}

/**
 * Walkthrough clips dated from today backward so they sit on top of the
 * dashboard (today's job first) instead of under an older Field Capture row.
 */
export function jettxDemoClips(now = new Date()): SeedClipSpec[] {
  const d0 = utcDayKey(now, 0);
  const d1 = utcDayKey(now, 1);
  const d2 = utcDayKey(now, 2);
  const d3 = utcDayKey(now, 3);
  return [
    {
      jobTitle: 'Cursor 1',
      jobPurpose: 'See how the product works — product testing.',
      workType: 'mitigation',
      address: {
        label: 'Product testing',
        line1: '1 Product Testing Lane',
        city: 'Austin',
        region: 'TX',
        postal: '78701',
        lat: 30.2672,
        lon: -97.7431,
      },
      company: 'Field Capture',
      contactName: 'Product Testing',
      trade: 'field_capture',
      title: 'Cursor 1',
      purpose: 'See how the product works — product testing.',
      phase: 'before',
      category: 'other',
      workDate: d0,
      capturedAt: at(d0, 17, 5),
      durationSeconds: 60,
      color: '0x142033',
    },
    {
      ...CEDAR,
      company: 'Delgado Roofing',
      contactName: 'Hector Delgado',
      trade: 'roofing',
      title: `After — ${shortUtcDay(d0)}`,
      purpose: 'North slope stripped, tarp gone, underlayment on two thirds of the slope.',
      phase: 'after',
      category: 'after',
      workDate: d0,
      capturedAt: at(d0, 20, 48),
      durationSeconds: 24,
      color: '0x1a3028',
      lat: 30.4413,
      lon: -97.7218,
      accuracyM: 6,
    },
    {
      ...CEDAR,
      company: 'Delgado Roofing',
      contactName: 'Hector Delgado',
      trade: 'roofing',
      title: `Before — ${shortUtcDay(d0)}`,
      purpose: 'Morning walk of the north slope before the tarp comes off.',
      phase: 'before',
      category: 'before',
      workDate: d0,
      capturedAt: at(d0, 7, 12),
      durationSeconds: 24,
      color: '0x2a2418',
      lat: 30.4413,
      lon: -97.7219,
      accuracyM: 8,
    },
    {
      ...CEDAR,
      company: 'Delgado Roofing',
      contactName: 'Hector Delgado',
      trade: 'roofing',
      title: `Workday — ${shortUtcDay(d1)}`,
      purpose: 'Tear-off, six new decking sheets, underlayment through the afternoon.',
      phase: 'after',
      category: 'after',
      workDate: d1,
      capturedAt: at(d1, 14, 11),
      durationSeconds: 24,
      color: '0x243018',
      lat: 30.4413,
      lon: -97.7218,
      accuracyM: 7,
    },
    {
      ...CEDAR,
      company: 'Brightline Electric',
      contactName: 'Marisol Vega',
      trade: 'electrical',
      title: `Before — ${shortUtcDay(d1)}`,
      purpose: 'Service walk before electrical. No after filed for this day.',
      phase: 'before',
      category: 'before',
      workDate: d1,
      capturedAt: at(d1, 8, 2),
      durationSeconds: 24,
      color: '0x201828',
      lat: 30.4414,
      lon: -97.7217,
      accuracyM: 5,
    },
    {
      ...CEDAR,
      company: 'Delgado Roofing',
      contactName: 'Hector Delgado',
      trade: 'roofing',
      title: `Before — ${shortUtcDay(d2)} (off site)`,
      purpose: 'Filmed 2.14 miles from the job — a different roof.',
      phase: 'before',
      category: 'issue',
      workDate: d2,
      capturedAt: at(d2, 7, 31),
      durationSeconds: 24,
      color: '0x331818',
      lat: 30.4692,
      lon: -97.755,
      accuracyM: 11,
    },
    {
      ...CEDAR,
      company: 'Delgado Roofing',
      contactName: 'Hector Delgado',
      trade: 'roofing',
      title: `After — ${shortUtcDay(d3)}`,
      purpose: 'Emergency tarp across the north and west slopes.',
      phase: 'after',
      category: 'after',
      workDate: d3,
      capturedAt: at(d3, 18, 20),
      durationSeconds: 24,
      color: '0x182030',
      lat: null,
      lon: null,
      accuracyM: null,
    },
    {
      ...MERIDIAN,
      company: 'Coastal Drying LLC',
      contactName: 'Andre Boone',
      trade: 'restoration',
      title: `After — ${shortUtcDay(d1)}`,
      purpose: 'Six air movers and one dehumidifier in the same positions as the morning.',
      phase: 'after',
      category: 'after',
      workDate: d1,
      capturedAt: at(d1, 17, 20),
      durationSeconds: 24,
      color: '0x183040',
      lat: 30.2984,
      lon: -97.7431,
      accuracyM: 7,
    },
    {
      ...MERIDIAN,
      company: 'Coastal Drying LLC',
      contactName: 'Andre Boone',
      trade: 'restoration',
      title: `Pre-conceal — ${shortUtcDay(d2)}`,
      purpose: 'Cavities open, flood cut at 24 in. Legal hold — carrier dispute CLM-88412.',
      phase: 'after',
      category: 'condition',
      workDate: d2,
      capturedAt: at(d2, 15, 44),
      durationSeconds: 24,
      color: '0x102838',
      legalHold: true,
      holdReason: 'Carrier dispute over the extent of the flood cut — CLM-88412.',
      lat: 30.2984,
      lon: -97.743,
      accuracyM: 6,
    },
    {
      ...CAMDEN,
      company: 'Vantage Drywall',
      contactName: 'Luis Marte',
      trade: 'drywall',
      title: `After — ${shortUtcDay(d2)}`,
      purpose: 'Board hung; queued for analysis against the three rooms in scope.',
      phase: 'after',
      category: 'after',
      workDate: d2,
      capturedAt: at(d2, 16, 55),
      durationSeconds: 24,
      color: '0x283018',
      lat: 30.5083,
      lon: -97.6789,
      accuracyM: 9,
    },
    {
      ...CAMDEN,
      company: 'Vantage Drywall',
      contactName: 'Luis Marte',
      trade: 'drywall',
      title: `After — ${shortUtcDay(d3)}`,
      purpose: 'Short pan of one room. Board on a single wall; two rooms never shown.',
      phase: 'after',
      category: 'after',
      workDate: d3,
      capturedAt: at(d3, 17, 41),
      durationSeconds: 24,
      color: '0x302818',
      lat: 30.5083,
      lon: -97.6791,
      accuracyM: 14,
    },
  ];
}

export function parseSeedVideoArgs(
  argv: string[],
  now = new Date(),
): SeedVideoOptions {
  const get = (flag: string, fallback: string): string => {
    const idx = argv.indexOf(flag);
    const value = idx >= 0 ? argv[idx + 1] : undefined;
    return (value && !value.startsWith('--') ? value : fallback).trim();
  };
  const duration = Number(get('--duration', '60'));
  if (!Number.isFinite(duration) || duration < 1 || duration > 3600) {
    throw new Error('--duration must be a number of seconds between 1 and 3600');
  }
  const workDate = get('--work-date', now.toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    throw new Error('--work-date must be YYYY-MM-DD');
  }
  const catalogRaw = get('--catalog', '');
  if (catalogRaw && catalogRaw !== 'demo') {
    throw new Error('--catalog must be demo when set');
  }
  return {
    orgName: get('--org', 'Jettx LLC'),
    title: get('--title', 'Cursor 1'),
    purpose: get(
      '--purpose',
      'See how the product works — product testing.',
    ),
    durationSeconds: duration,
    workDate,
    catalog: catalogRaw === 'demo' ? 'demo' : null,
  };
}

export function clipsForSeed(opts: SeedVideoOptions, now = new Date()): SeedClipSpec[] {
  if (opts.catalog === 'demo') return jettxDemoClips(now);
  return [
    {
      jobTitle: opts.title,
      jobPurpose: opts.purpose,
      workType: 'mitigation',
      address: {
        label: 'Product testing',
        line1: '1 Product Testing Lane',
        city: 'Austin',
        region: 'TX',
        postal: '78701',
        lat: 30.2672,
        lon: -97.7431,
      },
      company: 'Field Capture',
      contactName: 'Product Testing',
      trade: 'field_capture',
      title: opts.title,
      purpose: opts.purpose,
      phase: 'before',
      category: 'other',
      workDate: opts.workDate,
      capturedAt: `${opts.workDate}T17:00:00.000Z`,
      durationSeconds: opts.durationSeconds,
      color: '0x142033',
    },
  ];
}

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function escapeDrawtext(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%');
}

async function generateTestVideo(
  dest: string,
  opts: { title: string; purpose: string; durationSeconds: number; color: string },
): Promise<void> {
  const title = escapeDrawtext(opts.title);
  const purpose = escapeDrawtext(opts.purpose.slice(0, 80));
  const drawtext = [
    `drawtext=fontfile=${FONT}:text='${title}':fontsize=72:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-48`,
    `drawtext=fontfile=${FONT}:text='${purpose}':fontsize=28:fontcolor=0xdddddd:x=(w-text_w)/2:y=(h-text_h)/2+36`,
    `drawtext=fontfile=${FONT}:text='synthetic · %{eif\\:t\\:d}s / ${opts.durationSeconds}s':fontsize=22:fontcolor=0x99aacc:x=(w-text_w)/2:y=h-64`,
  ].join(',');

  await execFileAsync('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=${opts.color}:s=1280x720:d=${opts.durationSeconds}:r=30`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${opts.durationSeconds}`,
    '-vf',
    drawtext,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    '-movflags',
    '+faststart',
    dest,
  ]);
}

async function extractJpegFrame(videoPath: string, atSeconds: number, dest: string): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-ss',
    String(atSeconds),
    '-i',
    videoPath,
    '-frames:v',
    '1',
    '-q:v',
    '4',
    dest,
  ]);
}

async function findOrg(admin: SupabaseClient, name: string) {
  const { data: exact, error: exactErr } = await admin
    .from('orgs')
    .select('id, name, created_by')
    .ilike('name', name)
    .limit(5);
  if (exactErr) throw new Error(exactErr.message);
  const hit =
    (exact ?? []).find((o) => String(o.name).trim().toLowerCase() === name.toLowerCase()) ??
    (exact ?? [])[0];
  if (hit) return hit as { id: string; name: string; created_by: string | null };

  const { data: all, error: allErr } = await admin.from('orgs').select('id, name').limit(80);
  if (allErr) throw new Error(allErr.message);
  const names = (all ?? []).map((o) => `  · ${o.name} (${o.id})`).join('\n');
  fail(
    `No organization named "${name}".` +
      (names ? `\nOrganizations on this project:\n${names}` : '\nNo organizations were found.'),
  );
}

async function actorUserId(
  admin: SupabaseClient,
  org: { id: string; created_by: string | null },
): Promise<string | null> {
  if (org.created_by) return org.created_by;
  const { data } = await admin
    .from('org_members')
    .select('user_id')
    .eq('org_id', org.id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  return (data as { user_id?: string } | null)?.user_id ?? null;
}

async function ensureJob(
  admin: SupabaseClient,
  orgId: string,
  userId: string | null,
  clip: SeedClipSpec,
): Promise<{ id: string; title: string; jobNumber: number | null }> {
  const { data: existing } = await admin
    .from('crm_jobs')
    .select('id, title, job_number')
    .eq('org_id', orgId)
    .eq('title', clip.jobTitle)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    return {
      id: existing.id as string,
      title: existing.title as string,
      jobNumber: (existing.job_number as number | null) ?? null,
    };
  }

  const { data: property, error: propertyError } = await admin
    .from('crm_properties')
    .insert({
      org_id: orgId,
      label: clip.address.label,
      address_line1: clip.address.line1,
      city: clip.address.city,
      region: clip.address.region,
      postal_code: clip.address.postal,
      created_by: userId,
    })
    .select('id')
    .single();
  if (propertyError || !property) {
    throw new Error(propertyError?.message ?? 'Could not create the testing property.');
  }

  const { data: job, error: jobError } = await admin
    .from('crm_jobs')
    .insert({
      org_id: orgId,
      title: clip.jobTitle,
      description: clip.jobPurpose,
      work_type: clip.workType,
      status: 'scheduled',
      property_id: property.id,
      created_by: userId,
    })
    .select('id, title, job_number')
    .single();
  if (jobError || !job) {
    throw new Error(jobError?.message ?? 'Could not create the testing job.');
  }

  const { error: briefError } = await admin.from('job_briefs').insert({
    org_id: orgId,
    job_id: job.id,
    revision: 0,
    facts: { purpose: clip.jobPurpose },
    note: clip.jobPurpose,
    created_by: userId,
  });
  if (briefError) console.warn(`  brief skipped: ${briefError.message}`);

  const { error: scopeError } = await admin.from('job_scope_items').insert({
    org_id: orgId,
    job_id: job.id,
    title: clip.jobPurpose.slice(0, 200),
    state: 'included',
    revision: 1,
    created_by: userId,
  });
  if (scopeError) console.warn(`  scope skipped: ${scopeError.message}`);

  return {
    id: job.id as string,
    title: job.title as string,
    jobNumber: (job.job_number as number | null) ?? null,
  };
}

async function ensureParty(
  admin: SupabaseClient,
  orgId: string,
  jobId: string,
  userId: string | null,
  clip: SeedClipSpec,
): Promise<{ id: string; company: string }> {
  const { data: existing } = await admin
    .from('job_parties')
    .select('id, company')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .eq('company', clip.company)
    .is('revoked_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing) {
    return { id: existing.id as string, company: existing.company as string };
  }

  const { data: party, error } = await admin
    .from('job_parties')
    .insert({
      org_id: orgId,
      job_id: jobId,
      company: clip.company,
      trade: clip.trade,
      contact_name: clip.contactName,
      role: 'subcontractor',
      invited_at: new Date().toISOString(),
      created_by: userId,
    })
    .select('id, company')
    .single();
  if (error || !party) {
    throw new Error(error?.message ?? `Could not create the ${clip.company} party.`);
  }
  return { id: party.id as string, company: party.company as string };
}

async function fileClip(
  admin: SupabaseClient,
  org: { id: string; name: string },
  userId: string | null,
  clip: SeedClipSpec,
): Promise<void> {
  const job = await ensureJob(admin, org.id, userId, clip);
  const party = await ensureParty(admin, org.id, job.id, userId, clip);
  console.log(`  job ${job.title}${job.jobNumber != null ? ` (#${job.jobNumber})` : ''}  ${job.id}`);
  console.log(`  party ${party.company}  ${party.id}`);

  const dir = await mkdtemp(join(tmpdir(), 'jettx-seed-'));
  const videoPath = join(dir, 'clip.mp4');
  try {
    console.log(`  rendering ${clip.durationSeconds}s · ${clip.title}`);
    await generateTestVideo(videoPath, clip);
    const bytes = await readFile(videoPath);
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const capturedAt = clip.capturedAt;
    const storagePath = `${org.id}/${job.id}/${party.id}/${clip.workDate}-${clip.phase}.mp4`;

    const { error: uploadError } = await admin.storage.from(PROOF_BUCKET).upload(storagePath, bytes, {
      contentType: 'video/mp4',
      upsert: true,
    });
    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);
    console.log(`  uploaded ${bytes.length} bytes → ${storagePath}`);

    const checks = verifyProof(
      {
        id: 'pending',
        phase: clip.phase,
        workDate: clip.workDate,
        capturedAt,
        receivedAt: capturedAt,
        durationSeconds: clip.durationSeconds,
        contentHash,
        lat: clip.lat ?? null,
        lon: clip.lon ?? null,
        accuracyM: clip.accuracyM ?? null,
      },
      clip.lat != null && clip.lon != null
        ? { lat: clip.address.lat, lon: clip.address.lon }
        : null,
    );

    const proofRow = {
      org_id: org.id,
      job_id: job.id,
      party_id: party.id,
      work_date: clip.workDate,
      phase: clip.phase,
      category: clip.category,
      title: clip.title,
      tags: ['product-testing', 'jettx-demo'],
      storage_path: storagePath,
      byte_size: bytes.length,
      duration_seconds: clip.durationSeconds,
      content_hash: contentHash,
      captured_at: capturedAt,
      received_at: new Date().toISOString(),
      lat: clip.lat ?? null,
      lon: clip.lon ?? null,
      accuracy_m: clip.accuracyM ?? null,
      state: 'checked',
      checks,
      ai_summary: clip.purpose,
      narration_text: clip.purpose,
      narration_status: 'done',
      narrated_at: capturedAt,
      labels: ['product-testing', 'jettx-demo', clip.phase],
      legal_hold: Boolean(clip.legalHold),
      hold_reason: clip.holdReason ?? null,
    };

    // Visible unique key is a partial index (deleted_at is null). PostgREST
    // ON CONFLICT cannot target that, so replace the live row by id.
    const { data: existingVisible } = await admin
      .from('job_proofs')
      .select('id')
      .eq('party_id', party.id)
      .eq('work_date', clip.workDate)
      .eq('phase', clip.phase)
      .is('deleted_at', null)
      .maybeSingle();

    const write = existingVisible?.id
      ? admin.from('job_proofs').update(proofRow).eq('id', existingVisible.id)
      : admin.from('job_proofs').insert(proofRow);
    const { data: proof, error: proofError } = await write
      .select('id, title, duration_seconds')
      .single();
    if (proofError || !proof) {
      throw new Error(proofError?.message ?? 'Could not write the job_proofs row.');
    }

    const frameAts = [
      1,
      Math.max(1, Math.round(clip.durationSeconds / 3)),
      Math.max(2, Math.round((clip.durationSeconds * 2) / 3)),
      Math.max(3, clip.durationSeconds - 1),
    ];
    for (const at of [...new Set(frameAts)]) {
      const framePath = join(dir, `f${at}.jpg`);
      await extractJpegFrame(videoPath, at, framePath);
      const jpeg = await readFile(framePath);
      const frameStorage = `${org.id}/${job.id}/${party.id}/${clip.workDate}-${clip.phase}-f${at}.jpg`;
      await admin.storage.from(PROOF_BUCKET).upload(frameStorage, jpeg, {
        contentType: 'image/jpeg',
        upsert: true,
      });
      await admin.from('job_proof_frames').upsert(
        {
          org_id: org.id,
          proof_id: proof.id,
          at_seconds: at,
          storage_path: frameStorage,
        },
        { onConflict: 'proof_id,at_seconds' },
      );
    }

    await admin.from('job_evidence_access').insert({
      org_id: org.id,
      job_id: job.id,
      proof_id: proof.id,
      action: 'uploaded',
      party_id: party.id,
      actor_label: 'Product testing seed',
      actor_role: 'system',
      detail: `${clip.title} · ${clip.durationSeconds}s · ${clip.purpose}`.slice(0, 500),
    });

    console.log(`  filed ${proof.title}  ${proof.id}  ${Number(proof.duration_seconds)}s`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function retireStaleDemoProofs(
  admin: SupabaseClient,
  orgId: string,
  keepDates: Set<string>,
): Promise<number> {
  const { data: rows, error } = await admin
    .from('job_proofs')
    .select('id, work_date, tags')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .contains('tags', ['jettx-demo']);
  if (error) {
    console.warn(`  could not list older demo clips: ${error.message}`);
    return 0;
  }
  const stale = (rows ?? []).filter((row) => !keepDates.has(String(row.work_date ?? '')));
  if (!stale.length) return 0;
  const { error: retireError } = await admin
    .from('job_proofs')
    .update({ deleted_at: new Date().toISOString() })
    .in(
      'id',
      stale.map((row) => row.id),
    );
  if (retireError) {
    console.warn(`  could not retire older demo clips: ${retireError.message}`);
    return 0;
  }
  return stale.length;
}

async function main(): Promise<void> {
  const now = new Date();
  const opts = parseSeedVideoArgs(process.argv.slice(2), now);
  const admin = createAdminClient();
  if (!admin) {
    fail(
      'SUPABASE_SERVICE_ROLE_KEY is not set. This script writes into the live org and cannot run on the anon key.',
    );
  }

  const clips = clipsForSeed(opts, now);
  console.log(`Looking up organization "${opts.orgName}"…`);
  const org = await findOrg(admin, opts.orgName);
  console.log(`  ${org.name}  ${org.id}`);
  console.log(`Filing ${clips.length} clip${clips.length === 1 ? '' : 's'}…`);

  const userId = await actorUserId(admin, org);
  for (const clip of clips) {
    console.log(`\n${clip.jobTitle} · ${clip.title}`);
    await fileClip(admin, org, userId, clip);
  }

  if (opts.catalog === 'demo') {
    const retired = await retireStaleDemoProofs(
      admin,
      org.id,
      new Set(clips.map((clip) => clip.workDate)),
    );
    if (retired) {
      console.log(`Retired ${retired} older demo clip${retired === 1 ? '' : 's'} that used historical dates.`);
    }
  }

  console.log(`\nFiled ${clips.length} product-testing video${clips.length === 1 ? '' : 's'} on ${org.name}.`);
}

const invokedDirectly = /seedProductTestVideo\.(ts|js)$/.test(process.argv[1] ?? '');
if (invokedDirectly) {
  main().catch((err) => {
    fail(err instanceof Error ? err.message : String(err));
  });
}
