import { describe, expect, it } from 'vitest';
import { displayName, initials, nameFromMetadata } from './display';

describe('displayName', () => {
  it('prefers the chosen name, then the email local part', () => {
    expect(displayName('Jack Cyganiak', 'jack@jettx.ai')).toBe('Jack Cyganiak');
    expect(displayName('  ', 'jack@jettx.ai')).toBe('jack');
    expect(displayName(null, null)).toBe('Teammate');
  });
});

describe('initials', () => {
  it('uses two letters from a first and last name', () => {
    expect(initials('Jack Cyganiak', 'jack@jettx.ai')).toBe('JC');
  });

  it('falls back to the email when the name is blank', () => {
    expect(initials(null, 'jack@jettx.ai')).toBe('JA');
  });
});

describe('nameFromMetadata', () => {
  it('reads the common auth metadata keys', () => {
    expect(nameFromMetadata({ full_name: 'Jack Cyganiak' })).toBe('Jack Cyganiak');
    expect(nameFromMetadata({ name: 'Jack' })).toBe('Jack');
    expect(nameFromMetadata({})).toBeNull();
  });
});
