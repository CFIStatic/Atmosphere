#!/usr/bin/env node
/**
 * Push selected process env vars to the linked Railway service.
 * Values come from GitHub Actions (environment `Keys`). Empty values are skipped
 * so we never wipe a working Railway var with a blank.
 *
 * stdin is used so JWT / base64 secrets that contain `=` are not split.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KEYS = [
  'NODE_ENV',
  'MEDIA_BACKEND',
  'COMPUTER_USE_ENABLED',
  'BACKUP_ENABLED',
  'ALLOW_MOCK_DRIVERS',
  'HOST',
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

const missing = REQUIRED.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error(
    'Missing GitHub Keys values (add them to the Keys environment, then re-run):\n' +
      missing.map((n) => `  - ${n}`).join('\n'),
  );
  process.exit(1);
}

function railway(args, input) {
  const result = spawnSync('railway', args, {
    stdio: input == null ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    encoding: 'utf8',
    input,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveRailwayService(name) {
  const aliases = {
    Atmosphere: 'Atmosphere APIs',
    'Atmosphere-internal': 'Internal Growth Metrics',
    'Atmosphere-web': 'Login & Dashboard',
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
