import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HOMEOWNER_SERVICE_ROLE,
  deriveServiceRole,
  displayLabelForServiceRole,
  formatPersonRoleLabel,
  normalizeServiceRoleInput,
  toServiceRoleLabel,
} from '../src/shared/serviceRole.js';

test('displayLabelForServiceRole — curated + custom other', () => {
  assert.equal(displayLabelForServiceRole('electrician'), 'Electrician');
  assert.equal(displayLabelForServiceRole('project_manager'), 'Project Manager');
  assert.equal(displayLabelForServiceRole('homeowner'), 'Homeowner');
  assert.equal(displayLabelForServiceRole('other', 'Lead Carpenter'), 'Lead Carpenter');
  assert.equal(displayLabelForServiceRole('other', null), 'Other');
});

test('toServiceRoleLabel + formatPersonRoleLabel — trades vs homeowner', () => {
  const plumber = toServiceRoleLabel('plumber');
  assert.deepEqual(plumber, { role: 'plumber', displayLabel: 'Plumber' });
  assert.equal(formatPersonRoleLabel('Alex Rivera', plumber), 'Alex Rivera — Plumber');
  assert.equal(formatPersonRoleLabel('Von Mour', HOMEOWNER_SERVICE_ROLE), 'Homeowner');
  assert.equal(formatPersonRoleLabel(null, plumber), 'Plumber');
});

test('deriveServiceRole — precedence explicit > trade > party > member', () => {
  assert.deepEqual(
    deriveServiceRole({ kind: 'homeowner', serviceRole: 'plumber' }),
    HOMEOWNER_SERVICE_ROLE,
  );
  assert.deepEqual(deriveServiceRole({ serviceRole: 'estimator' }), {
    role: 'estimator',
    displayLabel: 'Estimator',
  });
  assert.deepEqual(deriveServiceRole({ trade: 'electrical' }), {
    role: 'electrician',
    displayLabel: 'Electrician',
  });
  assert.deepEqual(deriveServiceRole({ partyRole: 'adjuster' }), {
    role: 'adjuster',
    displayLabel: 'Adjuster',
  });
  assert.deepEqual(deriveServiceRole({ memberRole: 'project_manager' }), {
    role: 'project_manager',
    displayLabel: 'Project Manager',
  });
});

test('normalizeServiceRoleInput — force homeowner clears custom', () => {
  assert.deepEqual(
    normalizeServiceRoleInput({
      serviceRole: 'plumber',
      serviceRoleCustom: 'x',
      forceHomeowner: true,
    }),
    { service_role: 'homeowner', service_role_custom: null },
  );
  assert.deepEqual(normalizeServiceRoleInput({ serviceRole: 'other', serviceRoleCustom: '  GC  ' }), {
    service_role: 'other',
    service_role_custom: 'GC',
  });
});
