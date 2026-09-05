#!/usr/bin/env node
/**
 * Push selected process env vars to the linked Railway service.
 * Values come from GitHub Actions (environment `Keys`). Empty values are skipped
 * so we never wipe a working Railway var with a blank.
 *
 * stdin is used so JWT / base64 secrets that contain `=` are not split.
 *
 * Railway's GraphQL backboard times out under load. One failed `variable set`
 * used to abort the whole backend deploy before `railway up`. Retry those
 * blips; keep failing on real CLI / auth errors.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KEYS = [
  'NODE_ENV',
  'MEDIA_BACKEND',
  'COMPUTER_USE_ENABLED',
  'BACKUP_ENABLED',
  'ALLOW_MOCK_DRIVERS',
  'HOST',
  'PORT',
  'FRONTEND_ORIGIN',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DEVICE_PEPPER',
  'AI_CREDENTIALS_KEY',
  'AGENT_TOKEN_SECRET',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'CAREERS_FROM_EMAIL',
  'CONTACT_TO_EMAIL',
  'CAREERS_TO_EMAIL',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_MAPS_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'VERIFICATION_PRIMARY_MODEL',
  'VERIFICATION_ESCALATION_MODEL',
];

const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DEVICE_PEPPER',
  'CAREERS_FROM_EMAIL',
  'CONTACT_TO_EMAIL',
  'CAREERS_TO_EMAIL',
  'FRONTEND_ORIGIN',
];

export const MAX_RAILWAY_ATTEMPTS = 5;
export const INITIAL_RAILWAY_DELAY_MS = 4000;

export function isRetryableRailwayOutput(text) {
  const s = String(text || '').toLowerCase();
  return (
    s.includes('operation timed out') ||
    s.includes('error sending request') ||
    s.includes('failed to fetch') ||
    s.includes('temporarily unavailable') ||
    s.includes('connection reset') ||
    s.includes('econnreset') ||
    s.includes('etimedout') ||
    s.includes('status 502') ||
    s.includes('status 503') ||
    s.includes('status 504')
  );
}

export function railwayBackoffMs(attempt) {
  return INITIAL_RAILWAY_DELAY_MS * 2 ** Math.max(0, attempt - 1);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function railway(args, input) {
  for (let attempt = 1; attempt <= MAX_RAILWAY_ATTEMPTS; attempt++) {
    const result = spawnSync('railway', args, {
      encoding: 'utf8',
      input,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status === 0) return;

    const output = `${result.stdout || ''}\n${result.stderr || ''}\n${result.error?.message || ''}`;
    const retryable = attempt < MAX_RAILWAY_ATTEMPTS && isRetryableRailwayOutput(output);
    if (!retryable) process.exit(result.status ?? 1);

    const delayMs = railwayBackoffMs(attempt);
    console.warn(
      `Railway CLI timed out. Retrying in ${delayMs / 1000}s (${attempt}/${MAX_RAILWAY_ATTEMPTS})...`,
    );
    sleep(delayMs);
  }
}

function resolveRailwayService(name) {
  const aliases = {
    Atmosphere: 'Atmosphere APIs',
    'Atmosphere-internal': 'Internal Growth Metrics',
    'Atmosphere-web': 'Platform',
    website: 'Corporate Website',
  };
  const wanted = aliases[name] ?? name;
  const resolved = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./resolveRailwayService.mjs', import.meta.url)), wanted],
    {
      encoding: 'utf8',
      env: process.env,
    },
  );
  if (resolved.status === 0 && resolved.stdout?.trim()) {
    return resolved.stdout.trim();
  }
  return wanted;
}

export function main() {
  const missing = REQUIRED.filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    console.error(
      'Missing GitHub Keys values (add them to the Keys environment, then re-run):\n' +
        missing.map((n) => `  - ${n}`).join('\n'),
    );
    process.exit(1);
  }

  const service = resolveRailwayService(process.env.RAILWAY_SERVICE?.trim() || 'Atmosphere APIs');
  console.log(`Railway: targeting service ${service}`);

  for (const name of KEYS) {
    const value = process.env[name]?.trim();
    if (!value) continue;
    console.log(`Railway: set ${name}`);
    const args = ['variable', 'set', name, '--stdin', '--skip-deploys'];
    if (service) args.push('--service', service);
    railway(args, value);
  }

  console.log('Railway variables synced from GitHub Keys.');
}

const invokedDirectly =
  Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main();
}
