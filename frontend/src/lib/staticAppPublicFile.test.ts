import { describe, expect, it } from 'vitest';
import { isStaticAppPublicFile } from '../../vite.verifier';

describe('isStaticAppPublicFile', () => {
  const root = '/repo/fieldcapture';

  it('keeps the capture app files the office image should serve', () => {
    expect(isStaticAppPublicFile(`${root}/index.html`, root)).toBe(true);
    expect(isStaticAppPublicFile(`${root}/js/app.js`, root)).toBe(true);
    expect(isStaticAppPublicFile(`${root}/js/capture-core.js`, root)).toBe(true);
    expect(isStaticAppPublicFile(`${root}/manifest.webmanifest`, root)).toBe(true);
    expect(isStaticAppPublicFile(`${root}/icons/atmosphere.svg`, root)).toBe(true);
  });

  it('drops Railway and nginx files so they are not public under /fieldcapture/', () => {
    expect(isStaticAppPublicFile(`${root}/Dockerfile`, root)).toBe(false);
    expect(isStaticAppPublicFile(`${root}/railway.toml`, root)).toBe(false);
    expect(isStaticAppPublicFile(`${root}/nginx/default.conf.template`, root)).toBe(false);
    expect(isStaticAppPublicFile(`${root}/nginx`, root)).toBe(false);
    expect(isStaticAppPublicFile(`${root}/scripts/apply-railway-config.sh`, root)).toBe(false);
    expect(isStaticAppPublicFile(`${root}/README.md`, root)).toBe(false);
  });
});
