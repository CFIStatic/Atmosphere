import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const backendRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

describe('production boot liveness', () => {
  it('answers GET /api/health even when production config throws', async () => {
    const port = 18080 + Math.floor(Math.random() * 500);
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'src/index.ts'],
      {
        cwd: backendRoot,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          PORT: String(port),
          HOST: '0.0.0.0',
          // Force the required() checks in config.ts to throw after listen.
          FRONTEND_ORIGIN: '',
          SUPABASE_URL: '',
          SUPABASE_ANON_KEY: '',
          DEVICE_PEPPER: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    const started = Date.now();
    try {
      while (Date.now() - started < 15_000) {
        if (stdout.includes('"msg":"listening"')) break;
        await Promise.race([
          once(child.stdout!, 'data'),
          once(child.stderr!, 'data'),
          new Promise((resolve) => setTimeout(resolve, 200)),
        ]);
      }
      assert.match(stdout, /"msg":"listening"/, stdout);

      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      const raw = await res.text();
      assert.equal(res.status, 200, raw);
      const body = JSON.parse(raw) as { status?: string; service?: string };
      assert.equal(body.status, 'ok');
      assert.equal(body.service, 'atmosphere-backend');
    } finally {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise((r) => setTimeout(r, 3_000))]);
    }
  });
});
