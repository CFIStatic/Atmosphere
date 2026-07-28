import type { Request, Response } from 'express';
import { cyberStore } from './store.js';

/**
 * Deception layer — convincing decoys that waste attacker time.
 *
 * Real Atmosphere data never appears here. Tokens and "credentials" are
 * ephemeral values rotated by the auto-patcher so anything scraped goes stale.
 * The point is to make probes look successful enough that scanners linger on
 * fake surfaces instead of hammering real /api routes.
 */

export type DecoyKind =
  | 'env'
  | 'git'
  | 'aws'
  | 'php'
  | 'admin_json'
  | 'sql'
  | 'generic';

export interface DecoyResponse {
  kind: DecoyKind;
  status: number;
  contentType: string;
  body: string;
  /** Delay before responding — slows automated scanners (tarpit). */
  delayMs: number;
}

export function classifyDecoy(path: string): DecoyKind {
  const p = path.toLowerCase();
  if (p.includes('.env')) return 'env';
  if (p.includes('.git')) return 'git';
  if (p.includes('.aws') || p.includes('credentials')) return 'aws';
  if (p.endsWith('.sql') || p.includes('dump') || p.includes('backup.sql')) return 'sql';
  if (
    p.includes('php') ||
    p.includes('wp-') ||
    p.includes('xmlrpc') ||
    p.includes('adminer') ||
    p.includes('phpinfo')
  ) {
    return 'php';
  }
  if (p.startsWith('/api/') || p.includes('actuator') || p.includes('graphql') || p.includes('console')) {
    return 'admin_json';
  }
  return 'generic';
}

export function buildDecoy(path: string): DecoyResponse {
  const kind = classifyDecoy(path);
  const token = cyberStore.getDecoyToken();
  const rotated = cyberStore.getDecoyRotatedAt();

  switch (kind) {
    case 'env':
      return {
        kind,
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        delayMs: 180,
        body: [
          '# Atmosphere runtime (staging mirror)',
          'NODE_ENV=staging',
          'PORT=4000',
          `DECOY_SESSION=${token}`,
          `SUPABASE_URL=https://decoy-${token.slice(0, 8)}.invalid`,
          'SUPABASE_ANON_KEY=eyJhbGciOiJub25lIn0.decoy',
          'DATABASE_URL=postgres://readonly:not-a-real-password@127.0.0.1:5432/atmosphere_decoy',
          `AWS_ACCESS_KEY_ID=AKIA${token.slice(0, 16).toUpperCase()}`,
          `AWS_SECRET_ACCESS_KEY=${token}`,
          `# rotated_at=${rotated}`,
          '',
        ].join('\n'),
      };
    case 'git':
      return {
        kind,
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        delayMs: 120,
        body:
          path.toLowerCase().includes('HEAD')
            ? 'ref: refs/heads/decoy\n'
            : [
                '[core]',
                '\trepositoryformatversion = 0',
                '\tfilemode = true',
                '\tbare = false',
                '[remote "origin"]',
                `\turl = https://git.decoy.invalid/atmosphere-${token.slice(0, 6)}.git`,
                '\tfetch = +refs/heads/*:refs/remotes/origin/*',
                `[branch "decoy"]`,
                '\tremote = origin',
                '\tmerge = refs/heads/decoy',
                '',
              ].join('\n'),
      };
    case 'aws':
      return {
        kind,
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        delayMs: 200,
        body: [
          '[default]',
          `aws_access_key_id = AKIA${token.slice(0, 16).toUpperCase()}`,
          `aws_secret_access_key = ${token}`,
          'region = us-east-1',
          '',
          '[decoy]',
          `aws_access_key_id = ASIA${token.slice(8, 24).toUpperCase()}`,
          `aws_secret_access_key = ${token.split('').reverse().join('')}`,
          '',
        ].join('\n'),
      };
    case 'sql':
      return {
        kind,
        status: 200,
        contentType: 'application/sql; charset=utf-8',
        delayMs: 250,
        body: [
          '-- Atmosphere decoy dump — not a real database',
          `CREATE TABLE decoy_users (id uuid PRIMARY KEY, email text, password_hash text);`,
          `INSERT INTO decoy_users VALUES ('00000000-0000-4000-8000-${token.slice(0, 12)}', 'admin@decoy.invalid', '${token}');`,
          `-- rotated_at=${rotated}`,
          '',
        ].join('\n'),
      };
    case 'php':
      return {
        kind,
        status: 200,
        contentType: 'text/html; charset=utf-8',
        delayMs: 220,
        body: `<!DOCTYPE html><html><head><title>Login</title></head><body><h1>Administration</h1><form method="post"><label>User <input name="user" value="admin"/></label><label>Password <input name="pass" type="password"/></label><button>Sign in</button></form><!-- decoy:${token.slice(0, 8)} --></body></html>`,
      };
    case 'admin_json':
      return {
        kind,
        status: 200,
        contentType: 'application/json; charset=utf-8',
        delayMs: 150,
        body: JSON.stringify(
          {
            ok: true,
            service: 'atmosphere-internal',
            environment: 'decoy',
            secrets: {
              session: token,
              database: `postgres://decoy:${token}@127.0.0.1/atmosphere`,
            },
            users: [{ id: 1, role: 'admin', email: 'root@decoy.invalid' }],
            rotatedAt: rotated,
            note: 'This endpoint is a honeypot. Credentials here are worthless.',
          },
          null,
          2,
        ),
      };
    default:
      return {
        kind: 'generic',
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        delayMs: 100,
        body: `OK\ndecoy=${token.slice(0, 12)}\n`,
      };
  }
}

export async function sendDecoy(req: Request, res: Response): Promise<DecoyResponse> {
  const decoy = buildDecoy(req.path || '/');
  if (decoy.delayMs > 0) {
    await sleep(decoy.delayMs);
  }
  // Never cache decoys — attackers share dumps; stale tokens help us.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Deliberately do NOT set a header that advertises "honeypot".
  res.status(decoy.status).type(decoy.contentType).send(decoy.body);
  return decoy;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
