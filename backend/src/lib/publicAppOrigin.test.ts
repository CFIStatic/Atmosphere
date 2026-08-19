import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LIVE_OFFICE_ORIGIN, publicAppOrigin } from './publicAppOrigin.js';

describe('publicAppOrigin', () => {
  it('prefers the live Railway office over the unmapped custom domain', () => {
    assert.equal(
      publicAppOrigin([
        'https://app.atmosphereteam.com',
        'https://atmosphere-web-production.up.railway.app',
      ]),
      LIVE_OFFICE_ORIGIN,
    );
  });

  it('uses the Railway office when FRONTEND_ORIGIN is only the future custom domain', () => {
    assert.equal(publicAppOrigin(['https://app.atmosphereteam.com']), LIVE_OFFICE_ORIGIN);
  });

  it('keeps a mapped https origin that is not the future custom domain', () => {
    assert.equal(
      publicAppOrigin(['https://office.example.com']),
      'https://office.example.com',
    );
  });
});
