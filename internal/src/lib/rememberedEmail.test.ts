import { beforeEach, describe, expect, it } from 'vitest';
import { forgetStaffEmail, readRememberedStaffEmail, rememberStaffEmail } from './rememberedEmail';

describe('remembered staff email', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores the staff email used at sign-in', () => {
    expect(readRememberedStaffEmail()).toBe('');
    rememberStaffEmail('Jack@JettX.ai');
    expect(readRememberedStaffEmail()).toBe('jack@jettx.ai');
    forgetStaffEmail();
    expect(readRememberedStaffEmail()).toBe('');
  });
});
