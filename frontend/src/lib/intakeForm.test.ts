import { describe, expect, it } from 'vitest';
import type { OrgMember } from './api';
import {
  cityPostalFromAddress,
  isInviteEmail,
  membersToCaptureTeam,
  scopeFromSituation,
  workTypeFromSituation,
} from './intakeForm';

const tech: OrgMember = {
  userId: 'u-1',
  email: 'marcus@example.com',
  fullName: 'Marcus Webb',
  role: 'field_technician',
  workType: 'mitigation',
  usageIntents: ['field_work'],
  status: 'active',
};

const office: OrgMember = {
  userId: 'u-2',
  email: 'dana@example.com',
  fullName: 'Dana Ortiz',
  role: 'office_manager',
  workType: 'construction',
  usageIntents: ['project_management'],
  status: 'active',
};

describe('membersToCaptureTeam', () => {
  it('preselects field technicians and skips office roles when techs exist', () => {
    const team = membersToCaptureTeam([tech, office]);
    expect(team).toHaveLength(1);
    expect(team[0]?.userId).toBe('u-1');
    expect(team[0]?.selected).toBe(true);
  });

  it('falls back to field-adjacent members when there are no technicians', () => {
    const team = membersToCaptureTeam([office]);
    expect(team).toHaveLength(1);
    expect(team[0]?.userId).toBe('u-2');
  });
});

describe('situation helpers', () => {
  it('turns a note into one included scope line', () => {
    expect(scopeFromSituation('  Extract standing water.  ')).toEqual([
      { title: 'Extract standing water.', state: 'included' },
    ]);
    expect(scopeFromSituation(' ')).toEqual([]);
  });

  it('classifies water work as mitigation', () => {
    expect(workTypeFromSituation('Extract standing water')).toBe('mitigation');
    expect(workTypeFromSituation('Replace the roof')).toBe('construction');
  });
});

describe('cityPostalFromAddress', () => {
  it('reads city and ZIP from a Places-formatted line', () => {
    expect(
      cityPostalFromAddress('East Racine Avenue, Waukesha, Wisconsin, 53186, US'),
    ).toEqual({ city: 'Waukesha', postalCode: '53186' });
  });

  it('reads city and postcode from a UK Places line', () => {
    expect(
      cityPostalFromAddress('School Street, Llanbradach, Wales, CF83 3NB, GB'),
    ).toEqual({ city: 'Llanbradach', postalCode: 'CF83 3NB' });
  });
});

describe('isInviteEmail', () => {
  it('accepts a normal inbox', () => {
    expect(isInviteEmail('alex@example.com')).toBe(true);
    expect(isInviteEmail('not-an-email')).toBe(false);
  });
});
