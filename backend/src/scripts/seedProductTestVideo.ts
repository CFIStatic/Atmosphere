/**
 * File a synthetic product-testing video on an existing organization.
 *
 *   cd backend
 *   SUPABASE_SERVICE_ROLE_KEY=… npm run seed:test-video
 *
 * Defaults match the Cursor 1 / Jettx LLC product-testing clip: a real 60s
 * MP4 uploaded to `job-proofs`, with a job_proofs row titled "Cursor 1".
 *
 * Re-running replaces the same party's same-day before clip (the unique
 * party + work_date + phase key) rather than stacking duplicates.
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
  return {
    orgName: get('--org', 'Jettx LLC'),
    title: get('--title', 'Cursor 1'),
    purpose: get(
      '--purpose',
      'See how the product works — product testing.',
    ),
    durationSeconds: duration,
    workDate,
  };
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
  opts: { title: string; purpose: string; durationSeconds: number },
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
    `color=c=0x142033:s=1280x720:d=${opts.durationSeconds}:r=30`,
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

  const { data: fuzzy, error: fuzzyErr } = await admin
    .from('orgs')
    .select('id, name, created_by')
    .ilike('name', `%${name.split(/\s+/)[0]}%`)
    .limit(20);
  if (fuzzyErr) throw new Error(fuzzyErr.message);
  const names = (fuzzy ?? []).map((o) => `  · ${o.name} (${o.id})`).join('\n');
  fail(
    `No organization named "${name}".` +
      (names ? `\nNearby names:\n${names}` : '\nNo similar organization names were found.'),
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
  opts: SeedVideoOptions,
): Promise<{ id: string; title: string; jobNumber: number | null }> {
  const { data: existing } = await admin
    .from('crm_jobs')
    .select('id, title, job_number')
    .eq('org_id', orgId)
    .eq('title', opts.title)
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
      label: 'Product testing',
      address_line1: '1 Product Testing Lane',
      city: 'Austin',
      region: 'TX',
      postal_code: '78701',
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
      title: opts.title,
      description: opts.purpose,
      work_type: 'mitigation',
      status: 'scheduled',
      property_id: property.id,
      created_by: userId,
    })
    .select('id, title, job_number')
    .single();
  if (jobError || !job) {
    throw new Error(jobError?.message ?? 'Could not create the testing job.');
  }

  await admin.from('job_briefs').insert({
    org_id: orgId,
    job_id: job.id,
    revision: 0,
    facts: { purpose: opts.purpose },
    note: opts.purpose,
    created_by: userId,
  });

  await admin.from('job_scope_items').insert({
    org_id: orgId,
    job_id: job.id,
    title: opts.purpose.slice(0, 200),
    state: 'included',
    revision: 1,
    created_by: userId,
  });

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
): Promise<{ id: string; company: string }> {
  const { data: existing } = await admin
    .from('job_parties')
    .select('id, company')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
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
      company: 'Field Capture',
      trade: 'field_capture',
      contact_name: 'Product Testing',
      role: 'subcontractor',
      invited_at: new Date().toISOString(),
      created_by: userId,
    })
    .select('id, company')
    .single();
  if (error || !party) {
    throw new Error(error?.message ?? 'Could not create the Field Capture party.');
  }
  return { id: party.id as string, company: party.company as string };
}

async function main(): Promise<void> {
  const opts = parseSeedVideoArgs(process.argv.slice(2));
  const admin = createAdminClient();
  if (!admin) {
    fail(
      'SUPABASE_SERVICE_ROLE_KEY is not set. This script writes into the live org and cannot run on the anon key.',
    );
  }

  console.log(`Looking up organization "${opts.orgName}"…`);
  const org = await findOrg(admin, opts.orgName);
  console.log(`  ${org.name}  ${org.id}`);

  const userId = await actorUserId(admin, org);
  const job = await ensureJob(admin, org.id, userId, opts);
  console.log(`  job ${job.title}${job.jobNumber != null ? ` (#${job.jobNumber})` : ''}  ${job.id}`);

  const party = await ensureParty(admin, org.id, job.id, userId);
  console.log(`  party ${party.company}  ${party.id}`);

  const dir = await mkdtemp(join(tmpdir(), 'cursor1-'));
  const videoPath = join(dir, 'cursor-1.mp4');
  try {
    console.log(`Rendering ${opts.durationSeconds}s test video…`);
    await generateTestVideo(videoPath, opts);
    const bytes = await readFile(videoPath);
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const capturedAt = new Date().toISOString();
    const storagePath = `${org.id}/${job.id}/${party.id}/${opts.workDate}-before.mp4`;

    const { error: uploadError } = await admin.storage.from(PROOF_BUCKET).upload(storagePath, bytes, {
      contentType: 'video/mp4',
      upsert: true,
    });
    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);
    console.log(`  uploaded ${bytes.length} bytes → ${storagePath}`);

    const checks = verifyProof(
      {
        id: 'pending',
        phase: 'before',
        workDate: opts.workDate,
        capturedAt,
        receivedAt: capturedAt,
        durationSeconds: opts.durationSeconds,
        contentHash,
        lat: null,
        lon: null,
        accuracyM: null,
      },
      null,
    );

    const { data: proof, error: proofError } = await admin
      .from('job_proofs')
      .upsert(
        {
          org_id: org.id,
          job_id: job.id,
          party_id: party.id,
          work_date: opts.workDate,
          phase: 'before',
          category: 'other',
          title: opts.title,
          tags: ['product-testing', 'cursor'],
          storage_path: storagePath,
          byte_size: bytes.length,
          duration_seconds: opts.durationSeconds,
          content_hash: contentHash,
          captured_at: capturedAt,
          received_at: capturedAt,
          state: 'checked',
          checks,
          ai_summary: opts.purpose,
          narration_text: opts.purpose,
          narration_status: 'done',
          narrated_at: capturedAt,
          labels: ['product-testing', 'cursor', 'before'],
        },
        { onConflict: 'party_id,work_date,phase' },
      )
      .select('id, title, duration_seconds')
      .single();
    if (proofError || !proof) {
      throw new Error(proofError?.message ?? 'Could not write the job_proofs row.');
    }

    const frameAts = [
      1,
      Math.max(1, Math.round(opts.durationSeconds / 3)),
      Math.max(2, Math.round((opts.durationSeconds * 2) / 3)),
      Math.max(3, opts.durationSeconds - 1),
    ];
    for (const at of frameAts) {
      const framePath = join(dir, `f${at}.jpg`);
      await extractJpegFrame(videoPath, at, framePath);
      const jpeg = await readFile(framePath);
      const frameStorage = `${org.id}/${job.id}/${party.id}/${opts.workDate}-before-f${at}.jpg`;
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
      detail: `${opts.title} · ${opts.durationSeconds}s · ${opts.purpose}`.slice(0, 500),
    });

    console.log('\nFiled product-testing video:');
    console.log(`  org      ${org.name}`);
    console.log(`  job      ${job.title}${job.jobNumber != null ? ` (#${job.jobNumber})` : ''}`);
    console.log(`  video    ${proof.title}`);
    console.log(`  duration ${Number(proof.duration_seconds)}s`);
    console.log(`  proof    ${proof.id}`);
    console.log(`  hash     ${contentHash}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const invokedDirectly = /seedProductTestVideo\.(ts|js)$/.test(process.argv[1] ?? '');
if (invokedDirectly) {
  main().catch((err) => {
    fail(err instanceof Error ? err.message : String(err));
  });
}
