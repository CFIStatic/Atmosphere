import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const verifierHtml = readFileSync(resolve(here, '../../../../verifier/index.html'), 'utf8');
const verifierFrame = readFileSync(resolve(here, '../VerifierFrame.tsx'), 'utf8');
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
  confirm?: () => boolean;
} = {}) {
  let confirmCalls = 0;
  const dom = new JSDOM(verifierHtml, {
    url: opts.url ?? 'https://atmosphere.test/verifier/?demo=1',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = opts.fetchImpl ?? (() => Promise.reject(new Error('offline')));
      window.confirm = () => {
        confirmCalls += 1;
        return opts.confirm ? opts.confirm() : false;
      };
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
  return { dom, confirmCalls: () => confirmCalls };
}

async function waitForRow(document: Document, id: string) {
  for (let i = 0; i < 20; i += 1) {
    if (document.querySelector(`tr[data-id="${id}"]`)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`clip row ${id} never rendered`);
}

function deleteClipFromMenu(document: Document, id: string) {
  const row = document.querySelector(`tr[data-id="${id}"]`) as HTMLElement | null;
  expect(row).not.toBeNull();
  const kebab = row!.querySelector('.kebab') as HTMLButtonElement | null;
  expect(kebab).not.toBeNull();
  kebab!.dispatchEvent(new kebab!.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true }));
  const del = document.querySelector('#rowmenu button[data-act="delete"]') as HTMLButtonElement | null;
  expect(del).not.toBeNull();
  del!.dispatchEvent(new del!.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true }));
}

describe('Dashboard clip delete', () => {
  it('removes the clip from the live record, not only this view', () => {
    expect(verifierHtml).toContain('function deleteLibraryClip');
    expect(verifierHtml).toContain('function applyDeletedClip');
    expect(verifierHtml).toContain("method: 'DELETE'");
    expect(verifierHtml).toContain("/evidence/' + encodeURIComponent(item.id)");
    expect(verifierHtml).toContain("atmosphere: 'library-changed'");
    expect(verifierHtml).not.toContain('Deletion on the record itself is wired next.');
  });

  it('deletes on the menu click without a browser confirm dialog', () => {
    expect(verifierHtml).not.toContain(
      'The chain of custody keeps the record of its life either way.',
    );
    expect(verifierHtml).not.toMatch(/window\.confirm\(\s*'Delete '/);
    expect(verifierHtml).toMatch(/if \(act === 'delete'\)[\s\S]*deleteLibraryClip\(item\)/);
  });

  it('keeps share, delete, save, and export on the clip menu without Property twin', async () => {
    expect(verifierHtml).toContain('data-act="share"');
    expect(verifierHtml).toContain('data-act="delete"');
    expect(verifierHtml).toContain('data-act="save"');
    expect(verifierHtml).toContain('data-act="export"');
    expect(verifierHtml).not.toContain('data-act="twin"');
    expect(verifierHtml).not.toContain('Property twin');
    expect(verifierHtml).not.toContain("act === 'twin'");

    const { dom } = bootVerifier();
    await waitForRow(dom.window.document, 'EV-1038-0805-A');
    const row = dom.window.document.querySelector('tr[data-id="EV-1038-0805-A"]') as HTMLElement;
    const kebab = row.querySelector('.kebab') as HTMLButtonElement;
    kebab.dispatchEvent(new kebab.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true }));
    const labels = Array.from(dom.window.document.querySelectorAll('#rowmenu button')).map((b) =>
      (b.textContent || '').replace(/\s+/g, ' ').trim(),
    );
    expect(labels).toEqual(['Share', 'Delete', 'Save', 'Export']);
    dom.window.close();
  });

  it('lets the hide stamp survive job_proofs RLS', () => {
    expect(softDeleteRlsSql).toContain('deleted_at is null or deleted_by = auth.uid()');
    expect(softDeleteRlsSql).toContain('drop policy if exists job_proofs_select');
    expect(deleteEvidenceSrc).toContain('createAdminClient() ?? supabase');
    expect(deleteEvidenceSrc).toMatch(
      /export async function deleteEvidence[\s\S]*const writer = createAdminClient\(\) \?\? supabase/,
    );
  });

  it('tells the office shell so Overview can drop the clip', () => {
    expect(verifierFrame).toContain("data.atmosphere === 'library-changed'");
    expect(verifierFrame).toContain('notifyLibraryChanged');
  });

  it('removes a demo clip from the list without asking first', async () => {
    const { dom, confirmCalls } = bootVerifier();
    await waitForRow(dom.window.document, 'EV-1038-0805-A');
    deleteClipFromMenu(dom.window.document, 'EV-1038-0805-A');
    expect(confirmCalls()).toBe(0);
    expect(dom.window.document.querySelector('tr[data-id="EV-1038-0805-A"]')).toBeNull();
    expect(dom.window.document.getElementById('toast')?.textContent).toMatch(/Removed/);
    dom.window.close();
  });

  it('hides a live clip through DELETE without a confirm or RLS toast', async () => {
    const deletes: string[] = [];
    const { dom, confirmCalls } = bootVerifier({
      url: 'https://atmosphere.test/verifier/',
      fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) => {
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
                company: 'Jettx LLC',
                phase: 'after',
                workDate: '2026-09-01',
                capturedAt: '2026-09-01T12:00:00Z',
                uploadedAt: '2026-09-01T12:05:00Z',
                durationSeconds: 60,
                analysisState: 'done',
                analysis: { summary: 'Recorded walkthrough.' },
              },
            ],
          });
        }
        if (init?.method === 'DELETE' && url.includes(`/evidence/${CLIP_ID}`)) {
          deletes.push(url);
          return jsonResponse({ ok: true, deletedAt: '2026-09-02T01:00:00.000Z' });
        }
        return Promise.reject(new Error(`unexpected fetch ${url}`));
      }) as typeof fetch,
    });

    await waitForRow(dom.window.document, CLIP_ID);
    deleteClipFromMenu(dom.window.document, CLIP_ID);
    expect(confirmCalls()).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(deletes).toEqual([
      `/api/operations/shared/${encodeURIComponent('job-1')}/evidence/${encodeURIComponent(CLIP_ID)}`,
    ]);
    expect(dom.window.document.querySelector(`tr[data-id="${CLIP_ID}"]`)).toBeNull();
    expect(dom.window.document.getElementById('toast')?.textContent).toBe('Removed from the library.');
    expect(dom.window.document.getElementById('toast')?.textContent).not.toMatch(/row-level security/i);
    dom.window.close();
  });
});
