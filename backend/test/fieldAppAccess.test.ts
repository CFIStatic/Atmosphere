import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELD_APP_INTERNAL_ROLES,
  assertExternalIsSubcontractor,
  assertInternalFieldAppSeat,
  partyDesignationForInvite,
} from '../src/routes/fieldAppAccess.js';
import { HttpError } from '../src/lib/errors.js';

describe('assertInternalFieldAppSeat', () => {
  it('allows GC Field Capture seats', () => {
    for (const role of FIELD_APP_INTERNAL_ROLES) {
      assert.doesNotThrow(() => assertInternalFieldAppSeat(role));
    }
  });

  it('blocks non-field seats from company-wide browse', () => {
    assert.throws(
      () => assertInternalFieldAppSeat('sales'),
      (err: unknown) =>
        err instanceof HttpError &&
        err.code === 'field_app_internal_only' &&
        /subcontractor designation/i.test(err.message),
    );
  });
});

describe('partyDesignationForInvite', () => {
  it('forces outside workers to subcontractor designation', () => {
    assert.deepEqual(
      partyDesignationForInvite({ external: true, trade: 'drywall' }),
      { external: true, trade: 'subcontractor', role: 'subcontractor' },
    );
    assert.deepEqual(partyDesignationForInvite({ userId: undefined }), {
      external: true,
      trade: 'subcontractor',
      role: 'subcontractor',
    });
  });

  it('keeps internal Field Capture on the GC side of the job', () => {
    assert.deepEqual(
      partyDesignationForInvite({
        external: false,
        userId: 'u1',
        trade: 'field_capture',
      }),
      { external: false, trade: 'field_capture', role: 'general_contractor' },
    );
  });
});

describe('assertExternalIsSubcontractor', () => {
  it('rejects outside invites that are not subcontractors', () => {
    assert.throws(
      () => assertExternalIsSubcontractor({ external: true, trade: 'field_capture' }),
      (err: unknown) =>
        err instanceof HttpError && err.code === 'subcontractor_designation_required',
    );
  });

  it('allows outside invites marked subcontractor', () => {
    assert.doesNotThrow(() =>
      assertExternalIsSubcontractor({ external: true, trade: 'subcontractor' }),
    );
  });
});
