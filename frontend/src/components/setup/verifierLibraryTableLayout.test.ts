import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

describe('All videos table layout', () => {
  it('locks desktop column tracks so expanding a job does not resize the table', () => {
    const block = verifierHtml.match(
      /Desktop All videos: fixed tracks[\s\S]*?@media \(min-width: 641px\) \{[\s\S]*?\n  \}/,
    );
    expect(block).not.toBeNull();
    const css = block![0];
    expect(css).toContain('#clip-table');
    expect(css).toContain('table-layout: fixed');
    expect(css).toContain('.col-preview,');
    expect(css).toContain('th[data-sort-key="preview"] { width: 128px; }');
    expect(css).toContain('.col-status,');
    expect(css).toContain('th[data-sort-key="status"] { width: 196px; }');
    expect(css).toContain('.col-recorded,');
    expect(css).toContain('th[data-sort-key="recorded"] { width: 132px; }');
    expect(css).toContain('.col-uploader,');
    expect(css).toContain('th[data-sort-key="uploader"] { width: 228px; }');
    expect(css).toContain('text-overflow: ellipsis');
    expect(css).toContain('#clip-table tr.jobrow td.titlecell .t');
    expect(css).toContain('font-size: 14px');
    expect(css).toContain('height: 49px');
    expect(css).toContain('padding: 7px 10px');
    expect(css).toContain('container-type: inline-size');
    expect(css).toContain('@container (max-width: 683px)');
    expect(css).toContain('th[data-sort-key="uploader"] { width: 30%; }');
  });

  it('declares the same tracks on the table so the first row cannot renegotiate them', () => {
    expect(verifierHtml).toContain('<col class="col-preview" />');
    expect(verifierHtml).toContain('<col class="col-job" />');
    expect(verifierHtml).toContain('<col class="col-status" />');
    expect(verifierHtml).toContain('<col class="col-recorded" />');
    expect(verifierHtml).toContain('<col class="col-uploader" />');
    expect(verifierHtml).toMatch(/th style="width:128px"[^>]*data-sort-key="preview"/);
    expect(verifierHtml).toMatch(/th style="width:132px"[^>]*data-sort-key="recorded"/);
    expect(verifierHtml).not.toMatch(/<col class="col-status" style=/);
    expect(verifierHtml).toContain(
      '#clip-table colgroup,\n    #clip-table col { display: none !important; }',
    );
  });
});
