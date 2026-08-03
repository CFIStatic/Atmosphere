import { describe, expect, it } from 'vitest';
import { CONNECTION_AUTH, PROTOCOL_LABELS, authSpecFor } from './connectionAuth';
import { CONNECTIONS } from '../data/fixtures';

/**
 * These assert the *honesty* of the auth specification as much as its shape.
 * A connector that claims to be self-serve when the vendor gates it behind a
 * partner agreement will strand a customer halfway through onboarding, which is
 * a worse failure than any bug in the flow itself.
 */

describe('every catalogued connector has a usable specification', () => {
  it('resolves a spec for all of them', () => {
    for (const c of CONNECTIONS) {
      const spec = authSpecFor(c.id, c.authMethod);
      expect(spec, `${c.id} has no spec`).toBeTruthy();
      expect(PROTOCOL_LABELS[spec.protocol], `${c.id} has an unlabelled protocol`).toBeTruthy();
    }
  });

  it('tells the operator what to actually do', () => {
    for (const c of CONNECTIONS) {
      const spec = authSpecFor(c.id, c.authMethod);
      expect(spec.setupSteps.length, `${c.id} has no setup steps`).toBeGreaterThan(0);
      expect(spec.failureMode.length, `${c.id} does not say how it breaks`).toBeGreaterThan(20);
      expect(spec.credential.stored, `${c.id} does not say what is stored`).toBeTruthy();
      expect(spec.credential.revocation, `${c.id} does not say how to revoke`).toBeTruthy();
    }
  });
});

describe('partner-gated access is declared, not hidden', () => {
  it('marks the vendors that require a signed agreement', () => {
    for (const id of ['xactimate', 'xactanalysis', 'dash', 'alacrity', 'encircle', 'docusketch']) {
      expect(CONNECTION_AUTH[id]?.partnerGated, `${id} should be partner-gated`).toBe(true);
    }
  });

  it('does not gate the ones with public developer programmes', () => {
    for (const id of ['gmail', 'outlook', 'quickbooks-online', 'companycam', 'google-drive']) {
      expect(CONNECTION_AUTH[id]?.partnerGated, `${id} should be self-serve`).toBe(false);
    }
  });

  it('gives every partner-gated connector a prerequisite naming the approval', () => {
    for (const [id, spec] of Object.entries(CONNECTION_AUTH)) {
      if (!spec.partnerGated) continue;
      const text = spec.prerequisites.join(' ').toLowerCase();
      expect(
        /approv|enable|partner|network|good standing|self-serve/.test(text),
        `${id} is gated but never says who has to approve`,
      ).toBe(true);
    }
  });
});

describe('OAuth connectors', () => {
  const oauthIds = Object.entries(CONNECTION_AUTH)
    .filter(([, s]) => s.protocol === 'oauth2_authorization_code')
    .map(([id]) => id);

  it('covers the mail, storage, calendar, and accounting systems', () => {
    for (const id of ['gmail', 'outlook', 'google-drive', 'quickbooks-online', 'companycam']) {
      expect(oauthIds).toContain(id);
    }
  });

  it('requests explicit scopes rather than blanket access', () => {
    for (const id of ['gmail', 'outlook', 'google-drive', 'quickbooks-online']) {
      expect(CONNECTION_AUTH[id].scopes.length, `${id} requests no scopes`).toBeGreaterThan(0);
    }
  });

  it('never stores a long-lived access token', () => {
    for (const id of oauthIds) {
      const stored = CONNECTION_AUTH[id].credential.stored.toLowerCase();
      expect(stored, `${id} should store a refresh token, not an access token`).toContain(
        'refresh token',
      );
      expect(stored, `${id} does not say the credential is encrypted`).toMatch(/seal|encrypt/);
    }
  });

  it('points at real vendor documentation where a public programme exists', () => {
    for (const id of ['gmail', 'outlook', 'quickbooks-online', 'companycam', 'google-drive']) {
      expect(CONNECTION_AUTH[id].docsUrl, `${id} has no docs link`).toMatch(/^https:\/\//);
    }
  });
});

describe('credential storage claims', () => {
  it('never suggests holding a user password', () => {
    for (const [id, spec] of Object.entries(CONNECTION_AUTH)) {
      const stored = spec.credential.stored.toLowerCase();
      // "No Xactimate password is ever held" is a denial, not a claim to hold one.
      const claimsPassword = /\bpassword\b/.test(stored) && !/never|no /.test(stored);
      expect(claimsPassword, `${id} appears to store a password`).toBe(false);
    }
  });
});

describe('authSpecFor', () => {
  it('falls back to a shape appropriate to the auth method', () => {
    expect(authSpecFor('unknown-app', 'oauth').protocol).toBe('oauth2_authorization_code');
    expect(authSpecFor('unknown-app', 'api_key').protocol).toBe('api_key');
    expect(authSpecFor('unknown-app', 'file_share').protocol).toBe('smb_mount');
    expect(authSpecFor('unknown-app', 'partner_request').partnerGated).toBe(true);
  });

  it('prefers the bespoke spec over the fallback', () => {
    expect(authSpecFor('outlook', 'oauth').authority).toContain('Entra');
  });
});
