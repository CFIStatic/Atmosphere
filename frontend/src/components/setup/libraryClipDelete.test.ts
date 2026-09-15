import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const verifierHtml = readFileSync(resolve(here, '../../../../verifier/index.html'), 'utf8');
const softDeleteRlsSql = readFileSync(
  resolve(here, '../../../../supabase/migrations/20260902010000_job_proofs_soft_delete_rls.sql'),
  'utf8',
);
const deleteEvidenceSrc = readFileSync(
  resolve(here, '../../../../backend/src/routes/proofOfWork.ts'),
  'utf8',
);

const CLIP_ID = '2d7c9289-7c1f-4432-be6e-9effec852158';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function bootVerifier(opts: {
  url?: string;
  fetchImpl?: typeof fetch;
} = {}) {
  const dom = new JSDOM(verifierHtml, {
    url: opts.url ?? 'https://atmosphere.test/verifier/?demo=1',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = opts.fetchImpl ?? (() => Promise.reject(new Error('offline')));
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() {
          return false;
        },
      })) as unknown as typeof window.matchMedia;
    },
  });
  return { dom };
}

async function waitForRow(document: Document, id: string) {
  for (let i = 0; i < 20; i += 1) {
    if (document.querySelector(`tr[data-id="${id}"]`)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`clip row ${id} never rendered`);
}

describe('Dashboard clip delete policy', () => {
  it('removes Delete from the clip overflow menu and keeps Restore / Share / Save / Export', () => {
    const menu = verifierHtml.match(/id="rowmenu"[\s\S]*?<\/div>/);
    expect(menu).not.toBeNull();
    expect(menu![0]).toContain('data-act="share"');
    expect(menu![0]).toContain('data-act="restore"');
    expect(menu![0]).toContain('data-act="save"');
    expect(menu![0]).toContain('data-act="export"');
    expect(menu![0]).not.toContain('data-act="delete"');
    expect(menu![0]).not.toMatch(/>\s*Delete\s*</);
    expect(verifierHtml).not.toContain('rowmenu-delete');
    expect(verifierHtml).not.toContain('function deleteLibraryClip');
  });

  it('keeps soft-delete RLS and restore; product DELETE API returns gone', () => {
    expect(softDeleteRlsSql).toContain('deleted_at is null or deleted_by = auth.uid()');
    expect(softDeleteRlsSql).toContain('drop policy if exists job_proofs_select');
    expect(deleteEvidenceSrc).toContain('export async function restoreEvidence');
    const fn = deleteEvidenceSrc.slice(deleteEvidenceSrc.indexOf('export async function deleteEvidence'));
    const end = fn.indexOf('export async function restoreEvidence');
    const body = end > 0 ? fn.slice(0, end) : fn;
    expect(body).toMatch(/410/);
    expect(body).toContain('evidence_delete_removed');
    expect(body).not.toMatch(/scheduled_purge_at:\s*purgeAt/);
  });

  it('still offers Restore for Global Admin on a pending-deletion clip', async () => {
    const { dom } = bootVerifier({
      url: 'https://atmosphere.test/verifier/',
      fetchImpl: ((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/evidence-portal/library')) {
          return jsonResponse({
            jobs: [{ jobId: 'job-1', jobName: 'Cedar Ridge — storm damage' }],
            items: [
              {
                id: CLIP_ID,
                jobId: 'job-1',
                jobName: 'Cedar Ridge — storm damage',
                person: 'Jack Cyganiak',
                company: 'Field Capture',
                phase: 'after',
                workDate: '2026-09-01',
                capturedAt: '2026-09-01T12:00:00Z',
                uploadedAt: '2026-09-01T12:05:00Z',
                durationSeconds: 60,
                analysisState: 'done',
                analysis: { summary: 'Recorded walkthrough.' },
                pendingDeletion: true,
                deletedAt: '2026-09-02T01:00:00.000Z',
                scheduledPurgeAt: '2026-10-02T01:00:00.000Z',
              },
            ],
          });
        }
        return Promise.reject(new Error(`unexpected fetch ${url}`));
      }) as typeof fetch,
    });

    await waitForRow(dom.window.document, CLIP_ID);
    dom.window.postMessage(
      {
        atmosphere: 'session',
        user: {
          name: 'Admin',
          email: 'admin@example.com',
          initials: 'A',
          orgName: 'Jettx',
          role: 'global_admin',
        },
      },
      '*',
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const row = dom.window.document.querySelector(`tr[data-id="${CLIP_ID}"]`) as HTMLElement;
    const kebab = row.querySelector('.kebab') as HTMLButtonElement;
    kebab.dispatchEvent(new kebab.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true }));
    const del = dom.window.document.querySelector(
      '#rowmenu button[data-act="delete"]',
    ) as HTMLButtonElement | null;
    expect(del).toBeNull();
    const restore = dom.window.document.querySelector(
      '#rowmenu button[data-act="restore"]',
    ) as HTMLButtonElement | null;
    expect(restore).not.toBeNull();
    expect(restore?.hidden).toBe(false);
    dom.window.close();
  });
});
