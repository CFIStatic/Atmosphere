import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  alignedReplyTo,
  deliverabilityHeaders,
  dmarcRuaPointsAtMainInbox,
  evaluateEmailAuthDns,
  formatFromHeader,
  organizationalDomain,
  recommendedDmarcTxt,
  sameOrganization,
  smtpFromMatchesAccount,
  systemMailTransportOrder,
} from './mailDeliverability.js';

describe('organizational domain', () => {
  it('treats invites.atmosphereteam.com as the same org as atmosphereteam.com', () => {
    assert.equal(organizationalDomain('invites.atmosphereteam.com'), 'atmosphereteam.com');
    assert.equal(organizationalDomain('send.invites.atmosphereteam.com'), 'atmosphereteam.com');
    assert.equal(organizationalDomain('atmosphereteam.com'), 'atmosphereteam.com');
    assert.ok(sameOrganization('hello@invites.atmosphereteam.com', 'hello@atmosphereteam.com'));
    assert.ok(!sameOrganization('hello@invites.atmosphereteam.com', 'jackcyganiak@yahoo.com'));
  });

  it('still treats invites.jettx.ai as the same org as jettx.ai (legacy)', () => {
    assert.equal(organizationalDomain('invites.jettx.ai'), 'jettx.ai');
    assert.ok(sameOrganization('hello@invites.jettx.ai', 'jack@jettx.ai'));
    assert.ok(!sameOrganization('hello@invites.atmosphereteam.com', 'jack@jettx.ai'));
  });
});

describe('aligned Reply-To', () => {
  it('keeps hello@atmosphereteam.com on a hello@invites.atmosphereteam.com From', () => {
    assert.equal(
      alignedReplyTo('hello@invites.atmosphereteam.com', 'hello@atmosphereteam.com'),
      'hello@atmosphereteam.com',
    );
  });

  it('drops jack@jettx.ai Reply-To on an Atmosphere From (different org)', () => {
    assert.equal(
      alignedReplyTo('hello@invites.atmosphereteam.com', 'jack@jettx.ai'),
      null,
    );
  });

  it('drops a consumer inbox Reply-To on an Atmosphere From', () => {
    assert.equal(
      alignedReplyTo('hello@invites.atmosphereteam.com', 'jackcyganiak@yahoo.com'),
      null,
    );
  });

  it('reads the address out of a display-name Reply-To', () => {
    assert.equal(
      alignedReplyTo('hello@invites.atmosphereteam.com', '"Atmosphere" <hello@atmosphereteam.com>'),
      '"Atmosphere" <hello@atmosphereteam.com>',
    );
  });
});

describe('From header / SMTP match', () => {
  it('formats Atmosphere <addr>', () => {
    assert.equal(
      formatFromHeader('hello@invites.atmosphereteam.com'),
      'Atmosphere <hello@invites.atmosphereteam.com>',
    );
  });

  it('refuses to claim SMTP can authenticate a foreign From', () => {
    assert.equal(smtpFromMatchesAccount('hello@atmosphereteam.com', 'jackcyganiak@yahoo.com'), false);
    assert.equal(smtpFromMatchesAccount('hello@atmosphereteam.com', 'hello@atmosphereteam.com'), true);
    assert.equal(
      smtpFromMatchesAccount('hello@invites.atmosphereteam.com', 'hello@atmosphereteam.com'),
      true,
    );
  });

  it('treats SES / Postmark / SendGrid SMTP logins as able to sign From', () => {
    assert.equal(smtpFromMatchesAccount('hello@atmosphereteam.com', 'AKIAIOSFODNN7EXAMPLE'), true);
    assert.equal(smtpFromMatchesAccount('hello@atmosphereteam.com', 'apikey'), true);
    assert.equal(
      smtpFromMatchesAccount('hello@invites.atmosphereteam.com', 'server-token-without-at'),
      true,
    );
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
  it('recommends DMARC without rua so reports do not flood hello@', () => {
    const txt = recommendedDmarcTxt();
    assert.equal(txt, 'v=DMARC1; p=none; fo=1; adkim=r; aspf=r');
    assert.doesNotMatch(txt, /rua=/i);
    assert.equal(dmarcRuaPointsAtMainInbox(txt), false);
    assert.equal(
      dmarcRuaPointsAtMainInbox(
        'v=DMARC1; p=none; rua=mailto:hello@atmosphereteam.com; fo=1; adkim=r; aspf=r',
      ),
      true,
    );
  });

  it('flags missing DMARC on atmosphereteam.com', () => {
    const findings = evaluateEmailAuthDns({
      apexTxt: ['v=spf1 include:_spf.mx.cloudflare.net ~all'],
      apexDmarc: [],
      invitesDmarc: [],
      invitesDkim: ['p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC'],
      sendInvitesSpf: ['v=spf1 include:amazonses.com ~all'],
    });
    const byName = Object.fromEntries(findings.map((f) => [f.name, f]));
    assert.equal(byName['apex-spf']?.ok, true);
    assert.equal(byName['apex-dmarc']?.ok, false);
    assert.equal(byName['invites-dmarc']?.ok, false);
    assert.equal(byName['invites-dkim']?.ok, true);
    assert.equal(byName['resend-return-path-spf']?.ok, true);
    assert.match(byName['apex-dmarc']?.fix ?? '', /v=DMARC1/);
    assert.doesNotMatch(byName['apex-dmarc']?.fix ?? '', /rua=/i);
    assert.doesNotMatch(byName['invites-dmarc']?.fix ?? '', /rua=/i);
  });

  it('passes a fully authenticated zone without rua', () => {
    const findings = evaluateEmailAuthDns({
      apexTxt: ['v=spf1 include:_spf.mx.cloudflare.net ~all'],
      apexDmarc: [recommendedDmarcTxt()],
      invitesDmarc: [recommendedDmarcTxt()],
      invitesDkim: ['v=DKIM1; k=rsa; p=MIIBIjAN'],
      sendInvitesSpf: ['v=spf1 include:amazonses.com ~all'],
    });
    assert.ok(findings.every((f) => f.ok));
  });

  it('accepts live-style DMARC (no rua) including apex p=reject', () => {
    const findings = evaluateEmailAuthDns({
      apexTxt: ['v=spf1 include:_spf.mx.cloudflare.net ~all'],
      apexDmarc: ['v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s'],
      invitesDmarc: ['v=DMARC1; p=none; fo=1; adkim=r; aspf=r'],
      invitesDkim: ['v=DKIM1; k=rsa; p=MIIBIjAN'],
      sendInvitesSpf: ['v=spf1 include:amazonses.com ~all'],
    });
    const byName = Object.fromEntries(findings.map((f) => [f.name, f]));
    assert.equal(byName['apex-dmarc']?.ok, true);
    assert.equal(byName['invites-dmarc']?.ok, true);
    assert.equal(byName['apex-dmarc-rua'], undefined);
    assert.equal(byName['invites-dmarc-rua'], undefined);
  });

  it('warns when rua points at hello@', () => {
    const withRua =
      'v=DMARC1; p=none; rua=mailto:hello@atmosphereteam.com; fo=1; adkim=r; aspf=r';
    const findings = evaluateEmailAuthDns({
      apexTxt: ['v=spf1 include:_spf.mx.cloudflare.net ~all'],
      apexDmarc: [withRua],
      invitesDmarc: [withRua],
      invitesDkim: ['v=DKIM1; k=rsa; p=MIIBIjAN'],
      sendInvitesSpf: ['v=spf1 include:amazonses.com ~all'],
    });
    const byName = Object.fromEntries(findings.map((f) => [f.name, f]));
    assert.equal(byName['apex-dmarc']?.ok, true);
    assert.equal(byName['invites-dmarc']?.ok, true);
    assert.equal(byName['apex-dmarc-rua']?.ok, false);
    assert.equal(byName['invites-dmarc-rua']?.ok, false);
    assert.match(byName['apex-dmarc-rua']?.detail ?? '', /hello@/);
  });
});
