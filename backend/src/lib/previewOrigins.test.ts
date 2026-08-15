import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isCloudflareQuickTunnelOrigin } from './previewOrigins.js';

describe('isCloudflareQuickTunnelOrigin', () => {
  it('accepts a Cloudflare quick-tunnel HTTPS origin', () => {
    assert.equal(
      isCloudflareQuickTunnelOrigin('https://random-words-here.trycloudflare.com'),
      true,
    );
  });

  it('rejects lookalikes that are not a quick tunnel', () => {
    assert.equal(isCloudflareQuickTunnelOrigin('http://random-words-here.trycloudflare.com'), false);
    assert.equal(isCloudflareQuickTunnelOrigin('https://trycloudflare.com'), false);
    assert.equal(
      isCloudflareQuickTunnelOrigin('https://evil.trycloudflare.com.example'),
      false,
    );
    assert.equal(isCloudflareQuickTunnelOrigin('https://app.atmosphere.dev'), false);
  });
});
