import { afterEach, describe, expect, it } from 'vitest';
import {
  isFieldCaptureHost,
  isFieldCaptureOrigin,
  isFieldEmbedQuery,
  isPhoneShellViewport,
  markFieldEmbed,
  PHONE_SHELL_MAX_PX,
  withFieldEmbed,
} from './fieldEmbed';

describe('field embed helpers', () => {
  afterEach(() => {
    delete document.documentElement.dataset.fieldEmbed;
  });

  it('recognises standalone Field Capture hosts and local phones', () => {
    expect(isFieldCaptureHost('field-capture-production.up.railway.app')).toBe(true);
    expect(isFieldCaptureHost('field-capture.up.railway.app')).toBe(true);
    expect(isFieldCaptureHost('field-capture-staging.up.railway.app')).toBe(true);
    expect(isFieldCaptureHost('localhost')).toBe(true);
    expect(isFieldCaptureHost('atmosphere-web-production.up.railway.app')).toBe(false);
    expect(isFieldCaptureOrigin('https://field-capture-production.up.railway.app')).toBe(true);
    expect(isFieldCaptureOrigin('https://evil.example')).toBe(false);
  });

  it('stamps embed=field without dropping an existing query', () => {
    expect(withFieldEmbed('/verifier-library')).toBe('/verifier-library?embed=field');
    expect(withFieldEmbed('/field?x=1')).toBe('/field?x=1&embed=field');
    expect(withFieldEmbed('/jobs?embed=field')).toBe('/jobs?embed=field');
  });

  it('reads the Field Capture embed flag from the query', () => {
    expect(isFieldEmbedQuery('?embed=field')).toBe(true);
    expect(isFieldEmbedQuery('embed=1')).toBe(false);
    expect(markFieldEmbed('?embed=field')).toBe(true);
    expect(document.documentElement.dataset.fieldEmbed).toBe('1');
  });

  it('treats a 480px Field Capture frame as a phone shell', () => {
    expect(isPhoneShellViewport(390)).toBe(true);
    expect(isPhoneShellViewport(480)).toBe(true);
    expect(isPhoneShellViewport(PHONE_SHELL_MAX_PX)).toBe(true);
    expect(isPhoneShellViewport(1024)).toBe(false);
  });
});
