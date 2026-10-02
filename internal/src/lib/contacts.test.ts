import { describe, expect, it } from 'vitest';
import { audienceSummary, matchesAudience, planLabel, planOptions, searchContacts } from './contacts';
import { testDirectory } from '../test/fixtures';

const contacts = testDirectory.contacts;

describe('contacts helpers (TEST DATA)', () => {
  it('filters by plan, status and source like the server', () => {
    const none = { plans: [], statuses: [], sources: [] };
    expect(contacts.filter((c) => matchesAudience(c, none))).toHaveLength(3);
    expect(contacts.filter((c) => matchesAudience(c, { ...none, plans: ['scale'] })).map((c) => c.email)).toEqual(['avery.ops@example.test']);
    expect(contacts.filter((c) => matchesAudience(c, { ...none, plans: ['none'] })).map((c) => c.email)).toEqual(['=cmd@example.test']);
    expect(contacts.filter((c) => matchesAudience(c, { ...none, statuses: ['trialing'] })).map((c) => c.email)).toEqual(['blake@example.test']);
    expect(contacts.filter((c) => matchesAudience(c, { ...none, sources: ['crm'] }))).toHaveLength(0);
  });
  it('searches name, email, company and plan', () => {
    expect(searchContacts(contacts, 'sample').map((c) => c.email)).toEqual(['blake@example.test']);
    expect(searchContacts(contacts, '  ')).toHaveLength(3);
  });
  it('labels plans and audiences', () => {
    expect(planLabel('work_verification')).toBe('Work Verification');
    expect(planLabel(null)).toBe('No plan');
    expect(planOptions(contacts)).toContain('none');
    expect(audienceSummary({ plans: [], statuses: [], sources: [] })).toBe('All contacts');
    expect(audienceSummary({ plans: ['scale'], statuses: ['active'], sources: [] })).toBe('Scale · Active');
  });
});
