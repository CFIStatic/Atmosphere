import { describe, expect, it } from 'vitest';
import { documentAskIds, type DocumentAskTarget } from './documentQuestion';

const JOB = '00000000-0000-4000-8000-0000000000aa';
const OTHER = '00000000-0000-4000-8000-0000000000bb';

const estimate: DocumentAskTarget = {
  id: '00000000-0000-4000-8000-000000000001',
  filename: 'Oak-Estimate.pdf',
  kind: 'estimate',
  attached: true,
  relevance: 'related',
  jobId: JOB,
};
const looseInvoice: DocumentAskTarget = {
  id: '00000000-0000-4000-8000-000000000002',
  filename: 'Other-Invoice.pdf',
  kind: 'invoice',
  attached: false,
  relevance: 'not_related',
  jobId: null,
};
const otherJob: DocumentAskTarget = {
  id: '00000000-0000-4000-8000-000000000003',
  filename: 'Elsewhere.pdf',
  kind: 'permit',
  attached: true,
  relevance: 'related',
  jobId: OTHER,
};
const permit: DocumentAskTarget = {
  id: '00000000-0000-4000-8000-000000000004',
  filename: 'Oak-Permit.pdf',
  kind: 'permit',
  attached: true,
  relevance: 'related',
  jobId: JOB,
};

const listed = [estimate, looseInvoice, otherJob];

describe('assistant document routing', () => {
  it('keeps job questions on the job Ask path and only sends in-scope documents', () => {
    expect(documentAskIds("what's the total on this job", listed, JOB)).toBeNull();
    expect(documentAskIds('what rooms were worked', listed, JOB)).toBeNull();
    expect(documentAskIds('is this related to the last visit', listed, JOB)).toBeNull();
    expect(documentAskIds("what's the permit status", listed, JOB)).toBeNull();

    expect(documentAskIds("what's the estimate total", listed, JOB)).toEqual([estimate.id]);
    expect(documentAskIds("what's the permit number", [permit, looseInvoice], JOB)).toEqual([permit.id]);
    expect(documentAskIds('what does the uploaded document say', listed, JOB)).toEqual([estimate.id]);
    expect(documentAskIds('what does Oak-Estimate say', listed, JOB)).toEqual([estimate.id]);
  });
});