import { describe, expect, it } from 'vitest';
import { isPrivateMomentText, scrubHomeownerText, PRIVACY_REDACTED_LABEL } from './privacyText';

describe('privacyText', () => {
  it('flags bathroom / intimate language', () => {
    expect(isPrivateMomentText('Standing in the bathroom')).toBe(true);
    expect(isPrivateMomentText('Crew hung drywall upstairs')).toBe(false);
  });

  it('scrubs private text and keeps plain work language', () => {
    expect(scrubHomeownerText('Hung drywall in the master')).toMatch(/drywall/i);
    expect(scrubHomeownerText('Discussion in the bathroom', { privacyProtected: true })).toBeNull();
    expect(scrubHomeownerText(PRIVACY_REDACTED_LABEL)).toBeNull();
  });
});
