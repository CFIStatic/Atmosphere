import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../lib/errors.js';
import { errorHandler } from './errorHandler.js';

describe('errorHandler', () => {
  it('includes checkoutUrl on a Field Capture seat checkout response', () => {
    const err = new HttpError(
      402,
      'Finish checkout',
      'fc_seat_checkout',
      { checkoutUrl: 'https://checkout.stripe.test/session' },
    );
    let status = 0;
    let body: Record<string, unknown> | null = null;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(payload: Record<string, unknown>) {
        body = payload;
      },
    };
    errorHandler(err, { requestId: 'r1', path: '/api/org/invites', method: 'POST' } as never, res as never, () => undefined);
    assert.equal(status, 402);
    assert.deepEqual(body, {
      error: 'Finish checkout',
      code: 'fc_seat_checkout',
      checkoutUrl: 'https://checkout.stripe.test/session',
    });
  });
});
