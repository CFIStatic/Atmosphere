import { describe, expect, it } from 'vitest';
import { workTypeForContractorType } from './verifierSetupOptions';

describe('workTypeForContractorType', () => {
  it('maps restoration to mitigation and every other type to construction', () => {
    expect(workTypeForContractorType('restoration')).toBe('mitigation');
    expect(workTypeForContractorType('roofing')).toBe('construction');
    expect(workTypeForContractorType('general_contractor')).toBe('construction');
    expect(workTypeForContractorType('other')).toBe('construction');
  });
});
