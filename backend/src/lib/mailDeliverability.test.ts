import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  alignedReplyTo,
  deliverabilityHeaders,
  evaluateEmailAuthDns,
  formatFromHeader,
  organizationalDomain,
  preferResendOverSmtp,
  recommendedDmarcTxt,
  sameOrganization,
  smtpFromMatchesAccount,
  systemMailTransportOrder,
} from './mailDeliverability.js';

describe('organizational domain', () => {
  it('treats invites.jettx.ai as the same org as jettx.ai', () => {
    assert.equal(organizationalDomain('invites.jettx.ai'), 'jettx.ai');
    assert.equal(organizationalDomain('send.invites.jettx.ai'), 'jettx.ai');
    assert.equal(organizationalDomain('jettx.ai'), 'jettx.ai');
    assert.ok(sameOrganization('hello@invites.jettx.ai', 'jack@jettx.ai'));
    assert.ok(!sameOrganization('hello@invites.jettx.ai', 'jackcyganiak@yahoo.com'));
  });
});

describe('aligned Reply-To', () => {
  it('keeps jack@jettx.ai on a hello@invites.jettx.ai From', () => {
    assert.equal(
      alignedReplyTo('hello@invites.jettx.ai', 'jack@jettx.ai'),
      'jack@jettx.ai',
    );
  });

  it('drops a consumer inbox Reply-To on a jettx.ai From', () => {
    assert.equal(
      alignedReplyTo('hello@invites.jettx.ai', 'jackcyganiak@yahoo.com'),
      null,
    );
  });

  it('reads the address out of a display-name Reply-To', () => {
    assert.equal(
      alignedReplyTo('hello@invites.jettx.ai', '"Jack" <jack@jettx.ai>'),
      '"Jack" <jack@jettx.ai>',
    );
  });
});

describe('From header / SMTP match', () => {
  it('formats Atmosphere <addr>', () => {
    assert.equal(formatFromHeader('hello@invites.jettx.ai'), 'Atmosphere <hello@invites.jettx.ai>');
  });

  it('refuses to claim SMTP can authenticate a foreign From', () => {
    assert.equal(smtpFromMatchesAccount('jack@jettx.ai', 'jackcyganiak@yahoo.com'), false);
    assert.equal(smtpFromMatchesAccount('jack@jettx.ai', 'jack@jettx.ai'), true);
    assert.equal(smtpFromMatchesAccount('hello@invites.jettx.ai', 'jack@jettx.ai'), true);
  });

  it('treats SES / Postmark / SendGrid SMTP logins as able to sign From', () => {
    assert.equal(smtpFromMatchesAccount('jack@jettx.ai', 'AKIAIOSFODNN7EXAMPLE'), true);
    assert.equal(smtpFromMatchesAccount('jack@jettx.ai', 'apikey'), true);
    assert.equal(smtpFromMatchesAccount('hello@invites.jettx.ai', 'server-token-without-at'), true);
  });
});

describe('deliverability headers', () => {
  it('marks transactional mail auto-generated and unique', () => {
    const headers = deliverabilityHeaders({ kind: 'transactional', sendId: 'invite-1' });
    assert.equal(headers['X-Entity-Ref-ID'], 'invite-1');
    assert.equal(headers['Auto-Submitted'], 'auto-generated');
    assert.equal(headers['List-Unsubscribe'], undefined);
  });

  it('adds one-click List-Unsubscribe on marketing mail', () => {
    const headers = deliverabilityHeaders({
      kind: 'marketing',
      sendId: 'm1',
      unsubscribeUrl: 'https://app.example/api/unsubscribe?t=abc',
    });
    assert.equal(
      headers['List-Unsubscribe'],
      '<https://app.example/api/unsubscribe?t=abc>',
    );
    assert.equal(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.equal(headers['Auto-Submitted'], undefined);
  });
});

describe('transport order', () => {
  it('prefers Resend over SMTP unless the driver forces SMTP', () => {
    assert.equal(preferResendOverSmtp({ resendApiKey: 're_x' }), true);
    assert.equal(preferResendOverSmtp({ resendApiKey: 're_x', driver: 'smtp' }), false);
    assert.deepEqual(
      systemMailTransportOrder({
        resendReady: true,
        smtpReady: true,
        logReady: false,
      }),
      ['resend', 'smtp'],
    );
    assert.deepEqual(
      systemMailTransportOrder({
        driver: 'smtp',
        resendReady: true,
        smtpReady: true,
        logReady: false,
      }),
      ['smtp', 'resend'],
    );
  });
});

describe('DNS auth scoring', () => {
  it('flags the live jettx.ai holes: no DMARC, no Google DKIM', () => {
    const findings = evaluateEmailAuthDns({
      apexTxt: ['v=spf1 include:_spf.google.com ~all'],
      apexDmarc: [],
      invitesDmarc: [],
      invitesDkim: ['p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC'],
      googleDkim: [],
      sendInvitesSpf: ['v=spf1 include:amazonses.com ~all'],
    });
    const byName = Object.fromEntries(findings.map((f) => [f.name, f]));
    assert.equal(byName['apex-spf']?.ok, true);
    assert.equal(byName['apex-dmarc']?.ok, false);
    assert.equal(byName['invites-dmarc']?.ok, false);
    assert.equal(byName['invites-dkim']?.ok, true);
    assert.equal(byName['google-dkim']?.ok, false);
    assert.equal(byName['resend-return-path-spf']?.ok, true);
    assert.match(byName['apex-dmarc']?.fix ?? '', /v=DMARC1/);
  });

  it('passes a fully authenticated zone', () => {
    const findings = evaluateEmailAuthDns({
      apexTxt: ['v=spf1 include:_spf.google.com ~all'],
      apexDmarc: [recommendedDmarcTxt('jack@jettx.ai')],
      invitesDmarc: [recommendedDmarcTxt('jack@jettx.ai')],
      invitesDkim: ['v=DKIM1; k=rsa; p=MIIBIjAN'],
      googleDkim: ['v=DKIM1; k=rsa; p=MIIBIjAN'],
      sendInvitesSpf: ['v=spf1 include:amazonses.com ~all'],
    });
    assert.ok(findings.every((f) => f.ok));
  });
});
