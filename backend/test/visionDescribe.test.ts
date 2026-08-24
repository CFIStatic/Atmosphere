import test from 'node:test';
import assert from 'node:assert/strict';
import { isVisionConfigured } from '../src/shared/visionDescribe.js';

test('isVisionConfigured is true when Gemini is set even without Anthropic', () => {
  const prevA = process.env.ANTHROPIC_API_KEY;
  const prevG = process.env.GOOGLE_API_KEY;
  const prevM = process.env.GEMINI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GEMINI_API_KEY;
  assert.equal(isVisionConfigured(), false);

  process.env.GOOGLE_API_KEY = 'test-google';
  assert.equal(isVisionConfigured(), true);

  if (prevA === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = prevA;
  if (prevG === undefined) delete process.env.GOOGLE_API_KEY;
  else process.env.GOOGLE_API_KEY = prevG;
  if (prevM === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = prevM;
});
