import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { forgetHomeownerCache, loadIsHomeownerWithOrg } from './homeownerPortal';

const here = dirname(fileURLToPath(import.meta.url));

const unpaid = async () => ({ required: true, complete: false }) as never;
const paid = async () => ({ required: true, complete: true }) as never;
const shared = async () => ({ grants: [{ path: '/job-progress?job=j1' }] });
const none = async () => ({ grants: [] });

describe('homeowner with a workspace of their own', () => {
  it('is a homeowner when their workspace never finished billing and a job was shared with them', async () => {
    forgetHomeownerCache();
    await expect(loadIsHomeownerWithOrg('u1', unpaid, shared)).resolves.toBe(true);
  });

  it('is a contractor when the workspace is paid, or nothing was shared', async () => {
    forgetHomeownerCache();
    await expect(loadIsHomeownerWithOrg('u2', paid, shared)).resolves.toBe(false);
    forgetHomeownerCache();
    await expect(loadIsHomeownerWithOrg('u3', unpaid, none)).resolves.toBe(false);
  });

  it('opens the Dashboard (not a single job) behind the billing gate', () => {
    const app = readFileSync(resolve(here, '../App.tsx'), 'utf8');
    expect(app).toContain('if (location.pathname === DASHBOARD_HOME) return <>{children}</>;');
    expect(app).toContain('return <Navigate to={DASHBOARD_HOME} replace />;');
    expect(app).not.toContain('<Navigate to={sharedJobPath} replace />');
  });
});
