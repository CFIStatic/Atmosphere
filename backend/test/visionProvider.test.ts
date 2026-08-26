import test from 'node:test';
import assert from 'node:assert/strict';
import {
  anthropicVisionApiKey,
  googleVisionApiKey,
  isVisionConfigured,
  visionProviderLabel,
} from '../src/lib/visionProvider.js';

test('isVisionConfigured is true when Google or Anthropic is set', () => {
  const google = process.env.GOOGLE_API_KEY;
  const gemini = process.env.GEMINI_API_KEY;
  const anthropic = process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.equal(isVisionConfigured(), false);
    assert.equal(visionProviderLabel(), 'unconfigured');

    process.env.GEMINI_API_KEY = 'test-gemini';
    assert.equal(googleVisionApiKey(), 'test-gemini');
    assert.equal(isVisionConfigured(), true);
    assert.equal(visionProviderLabel(), 'google');

    delete process.env.GEMINI_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-anthropic';
    assert.equal(anthropicVisionApiKey(), 'test-anthropic');
    assert.equal(isVisionConfigured(), true);
    assert.equal(visionProviderLabel(), 'anthropic');
  } finally {
    if (google === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = google;
    if (gemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = gemini;
    if (anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = anthropic;
  }
});
