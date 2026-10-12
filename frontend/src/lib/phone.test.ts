import { describe, expect, it } from 'vitest';
import { accountContact, formatPhone, formatPhoneInput, normalizePhoneE164 } from './phone';

describe('phone helpers', () => {
  it('normalizes US numbers to E.164', () => {
    expect(normalizePhoneE164('(312) 555-0100')).toBe('+13125550100');
    expect(normalizePhoneE164('1-312-555-0100')).toBe('+13125550100');
    expect(normalizePhoneE164('+44 7700 900123')).toBe('+447700900123');
    expect(normalizePhoneE164('555-0100')).toBeNull();
    expect(normalizePhoneE164('012 555 0100')).toBeNull();
  });
  it('formats for display and typing', () => {
    expect(formatPhone('13125550100')).toBe('(312) 555-0100');
    expect(formatPhoneInput('3125550100')).toBe('(312) 555-0100');
    expect(formatPhoneInput('312')).toBe('312');
    expect(formatPhoneInput('31255')).toBe('(312) 55');
  });
  it('shows the phone when an account has no email', () => {
    expect(accountContact({ email: null, phone: '+13125550100' })).toBe('(312) 555-0100');
    expect(accountContact({ email: 'a@b.co', phone: '+13125550100' })).toBe('a@b.co');
    expect(accountContact(null)).toBe('');
  });
});
