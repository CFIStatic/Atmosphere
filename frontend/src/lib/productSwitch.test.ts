import { describe, expect, it } from 'vitest';
import { isFieldCapturePath } from './productSwitch';

describe('isFieldCapturePath', () => {
  it('treats the worker dashboard and capture app as Field Capture', () => {
    expect(isFieldCapturePath('/my-work')).toBe(true);
    expect(isFieldCapturePath('/technician')).toBe(true);
    expect(isFieldCapturePath('/fieldcapture/')).toBe(true);
  });

  it('treats Overview, Dashboard, and Job Files as the office platform', () => {
    expect(isFieldCapturePath('/field')).toBe(false);
    expect(isFieldCapturePath('/verifier-library')).toBe(false);
    expect(isFieldCapturePath('/jobs')).toBe(false);
    expect(isFieldCapturePath('/intake')).toBe(false);
    expect(isFieldCapturePath('/settings')).toBe(false);
  });
});
