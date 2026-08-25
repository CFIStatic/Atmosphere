import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isAtmosphereRailwayFieldOrigin,
  isAtmosphereRailwayInternalOrigin,
  isAtmosphereRailwayWebOrigin,
  isCloudflareQuickTunnelOrigin,
} from './previewOrigins.js';

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

describe('isAtmosphereRailwayWebOrigin', () => {
  it('accepts the production Atmosphere-web Railway hostname', () => {
    assert.equal(
      isAtmosphereRailwayWebOrigin('https://atmosphere-web-production.up.railway.app'),
      true,
    );
  });

  it('accepts the unsuffixed service hostname and other Railway environments', () => {
    assert.equal(isAtmosphereRailwayWebOrigin('https://atmosphere-web.up.railway.app'), true);
    assert.equal(
      isAtmosphereRailwayWebOrigin('https://atmosphere-web-staging.up.railway.app'),
      true,
    );
  });

  it('rejects lookalikes and other Railway services', () => {
    assert.equal(
      isAtmosphereRailwayWebOrigin('http://atmosphere-web-production.up.railway.app'),
      false,
    );
    assert.equal(
      isAtmosphereRailwayWebOrigin('https://atmosphere-production.up.railway.app'),
      false,
    );
    assert.equal(
      isAtmosphereRailwayWebOrigin('https://atmosphere-web-production.up.railway.app.evil.com'),
      false,
    );
    assert.equal(
      isAtmosphereRailwayWebOrigin('https://evil-atmosphere-web.up.railway.app'),
      false,
    );
    assert.equal(isAtmosphereRailwayWebOrigin('https://app.atmosphereteam.com'), false);
  });
});

describe('isAtmosphereRailwayInternalOrigin', () => {
  it('accepts the production Internal Growth Metrics hostname', () => {
    assert.equal(
      isAtmosphereRailwayInternalOrigin(
        'https://melodious-inspiration-production-5ad9.up.railway.app',
      ),
      true,
    );
  });

  it('accepts the unsuffixed service hostname and other Railway environments', () => {
    assert.equal(
      isAtmosphereRailwayInternalOrigin('https://atmosphere-internal.up.railway.app'),
      true,
    );
    assert.equal(
      isAtmosphereRailwayInternalOrigin('https://atmosphere-internal-staging.up.railway.app'),
      true,
    );
  });

  it('rejects lookalikes and the office / backend hosts', () => {
    assert.equal(
      isAtmosphereRailwayInternalOrigin('http://atmosphere-internal-production.up.railway.app'),
      false,
    );
    assert.equal(
      isAtmosphereRailwayInternalOrigin('https://atmosphere-web-production.up.railway.app'),
      false,
    );
    assert.equal(
      isAtmosphereRailwayInternalOrigin('https://atmosphere-production.up.railway.app'),
      false,
    );
    assert.equal(
      isAtmosphereRailwayInternalOrigin(
        'https://atmosphere-internal-production.up.railway.app.evil.com',
      ),
      false,
    );
    assert.equal(
      isAtmosphereRailwayInternalOrigin('https://evil-atmosphere-internal.up.railway.app'),
      false,
    );
  });
});

describe('isAtmosphereRailwayFieldOrigin', () => {
  it('accepts the dedicated Field Capture Railway hostnames', () => {
    assert.equal(
      isAtmosphereRailwayFieldOrigin('https://atmosphere-field-production.up.railway.app'),
      true,
    );
    assert.equal(isAtmosphereRailwayFieldOrigin('https://atmosphere-field.up.railway.app'), true);
    assert.equal(
      isAtmosphereRailwayFieldOrigin('https://field-capture-production.up.railway.app'),
      true,
    );
  });

  it('rejects the office, backend, and lookalikes', () => {
    assert.equal(
      isAtmosphereRailwayFieldOrigin('https://atmosphere-web-production.up.railway.app'),
      false,
    );
    assert.equal(
      isAtmosphereRailwayFieldOrigin('https://atmosphere-production.up.railway.app'),
      false,
    );
    assert.equal(
      isAtmosphereRailwayFieldOrigin('http://atmosphere-field-production.up.railway.app'),
      false,
    );
    assert.equal(
      isAtmosphereRailwayFieldOrigin('https://evil-atmosphere-field.up.railway.app'),
      false,
    );
  });
});
