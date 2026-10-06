import { describe, expect, it } from 'vitest';
import { matchSavedLogins, type ComputerLogin, type LoginCatalog, type LoginCatalogEntry } from './computer';

function site(id: string, name: string, signInUrl: string, host: string): LoginCatalogEntry {
  return {
    id, name, category: 'general', signInUrl, host, aliases: [], twoStep: 'rare', sso: false,
    logo: { text: id.slice(0, 2), color: '#000' }, termsNote: null, practice: [], signInSteps: '',
  };
}

const CATALOG: LoginCatalog = {
  categories: [{ id: 'general', label: 'General' }],
  sites: [
    site('gmail', 'Gmail (Google)', 'https://mail.google.com/', 'mail.google.com'),
    site('google_calendar', 'Google Calendar', 'https://accounts.google.com/ServiceLogin?service=cl&continue=https://calendar.google.com/calendar/', 'calendar.google.com'),
    site('google_drive', 'Google Drive', 'https://accounts.google.com/ServiceLogin?service=wise&continue=https://drive.google.com/', 'drive.google.com'),
    site('facebook', 'Facebook', 'https://www.facebook.com/login', 'www.facebook.com'),
    site('meta_business', 'Meta Business Suite', 'https://facebook.com/business/login', 'business.facebook.com'),
    site('homedepot', 'The Home Depot / Pro', 'https://www.homedepot.com/auth/view/signin', 'www.homedepot.com'),
    site('outlook', 'Outlook (Microsoft 365)', 'https://outlook.office.com/mail/', 'outlook.office.com'),
  ],
};

let n = 0;
function login(url: string, label = 'Site', loginUrl: string | null = null): ComputerLogin {
  n += 1;
  return {
    id: `l${n}`, label, url, host: new URL(url).hostname, addedBy: null, addedAt: '', lastSignedInAt: null,
    lastSignedInBy: null, canClearCookies: false,
    credential: loginUrl
      ? { saved: true, username: null, loginUrl, status: 'ok', attentionReason: null, lastUsedAt: null, updatedAt: '', updatedBy: null }
      : null,
  };
}

const ids = (m: ReturnType<typeof matchSavedLogins>) => [...m.bySite.keys()].sort();

describe('matchSavedLogins', () => {
  it('matches a login saved from a catalog pick by its sign-in address', () => {
    const m = matchSavedLogins(CATALOG, [login(CATALOG.sites[1]!.signInUrl, 'Google Calendar')]);
    expect(ids(m)).toEqual(['google_calendar']);
    expect(m.unmatched).toEqual([]);
  });

  it('tells apart sites that share a sign-in host', () => {
    const m = matchSavedLogins(CATALOG, [login(CATALOG.sites[2]!.signInUrl, 'Google Drive')]);
    expect(ids(m)).toEqual(['google_drive']);
  });

  it('matches by the site host, ignoring www. and the path', () => {
    const m = matchSavedLogins(CATALOG, [login('https://homedepot.com/'), login('https://outlook.office.com/')]);
    expect(ids(m)).toEqual(['homedepot', 'outlook']);
  });

  it('matches by the saved sign-in page', () => {
    const m = matchSavedLogins(CATALOG, [login('https://example.test/', 'Mail', 'https://mail.google.com')]);
    expect(ids(m)).toEqual(['gmail']);
  });

  it('never matches a shared sign-in host or an unrelated subdomain', () => {
    const shared = login('https://accounts.google.com/', 'Google account');
    const sibling = login('https://outlook.live.com/');
    const lookalike = login('https://mail.google.com.evil.test/');
    const custom = login('https://identity.xactware.com/', 'Xactimate');
    const m = matchSavedLogins(CATALOG, [shared, sibling, lookalike, custom]);
    expect(ids(m)).toEqual([]);
    expect(m.unmatched.map((l) => l.id)).toEqual([shared.id, sibling.id, lookalike.id, custom.id]);
  });

  it('a facebook.com login checks Facebook, not Meta Business Suite (it signs in on facebook.com too)', () => {
    const m = matchSavedLogins(CATALOG, [login('https://facebook.com/')]);
    expect(ids(m)).toEqual(['facebook']);
  });

  it('a second login for the same site stays listed so it can be managed', () => {
    const a = login('https://outlook.office.com/mail/', 'Outlook');
    const b = login('https://www.outlook.office.com/owa', 'Outlook 2');
    const m = matchSavedLogins(CATALOG, [a, b]);
    expect(m.bySite.get('outlook')).toBe(a);
    expect(m.unmatched).toEqual([b]);
  });

  it('with no catalog, every login is unmatched', () => {
    const a = login('https://outlook.office.com/');
    expect(matchSavedLogins(null, [a]).unmatched).toEqual([a]);
  });
});
