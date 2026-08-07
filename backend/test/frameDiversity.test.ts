import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hammingDistanceHex,
  heuristicLuminanceSampler,
  perceptualHash,
  selectDiverseFrames,
} from '../src/shared/frameDiversity.js';

/**
 * Diversity selection. What earns a test is anything that would let a static
 * camera waste the model budget on the same picture, or drop a real change.
 */

function solidJpegish(level: number, size = 12_000): Buffer {
  // Not a real JPEG — the heuristic sampler only needs byte patterns that
  // differ when the "scene" differs. A flat fill alone is not enough: average
  // hash collapses any uniform field to the same bit string, so each "scene"
  // gets its own spatial stripe pattern.
  const buf = Buffer.alloc(size);
  buf.fill(level);
  const stripe = (level * 13 + 7) % 40 + 3;
  for (let i = 0; i < size; i += 1) {
    if (Math.floor(i / 3) % stripe === 0) buf[i] = (level + 90) % 256;
    if (i % (stripe * 9) === 0) buf[i] = (255 - level) % 256;
  }
  return buf;
}

test('identical bytes collapse to a single kept frame', () => {
  const same = solidJpegish(40);
  const kept = selectDiverseFrames(
    [
      { atSeconds: 0, jpeg: same },
      { atSeconds: 600, jpeg: Buffer.from(same) },
      { atSeconds: 1200, jpeg: Buffer.from(same) },
      { atSeconds: 1800, jpeg: Buffer.from(same) },
    ],
    { maxFrames: 20, hammingThreshold: 8, coverageIntervalSeconds: 3600 },
  );
  // First + at most one coverage anchor inside the hour — never four copies.
  assert.ok(kept.length <= 2, `expected ≤2, got ${kept.length}`);
  assert.equal(kept[0]?.reason, 'first');
});

test('a real scene change is kept even when denser than coverage', () => {
  const a = solidJpegish(20);
  const b = solidJpegish(200);
  const kept = selectDiverseFrames(
    [
      { atSeconds: 0, jpeg: a },
      { atSeconds: 60, jpeg: a },
      { atSeconds: 120, jpeg: b },
      { atSeconds: 180, jpeg: b },
    ],
    { maxFrames: 20, hammingThreshold: 8, coverageIntervalSeconds: 3600 },
  );
  assert.ok(kept.length >= 2);
  assert.ok(kept.some((k) => k.reason === 'changed'));
  // The two scenes are perceptually far apart.
  const hashes = kept.map((k) => k.perceptualHash);
  assert.ok(hammingDistanceHex(hashes[0]!, hashes[1]!) > 8);
});

test('static hours still get hourly coverage anchors, not silence', () => {
  const same = solidJpegish(90);
  const candidates = Array.from({ length: 10 }, (_, i) => ({
    atSeconds: i * 1800, // every 30 minutes across 4.5h
    jpeg: Buffer.from(same),
  }));
  const kept = selectDiverseFrames(candidates, {
    maxFrames: 20,
    hammingThreshold: 8,
    coverageIntervalSeconds: 3600,
  });
  // first + coverage about once an hour across ~4.5h → a handful, not 10.
  assert.ok(kept.length >= 2);
  assert.ok(kept.length <= 6, `expected ≤6 coverage anchors, got ${kept.length}`);
  assert.ok(kept.every((k) => k.reason === 'first' || k.reason === 'coverage'));
});

test('maxFrames prefers real changes when over budget', () => {
  const candidates = Array.from({ length: 30 }, (_, i) => ({
    atSeconds: i * 60,
    jpeg: solidJpegish((i * 17) % 200),
  }));
  const kept = selectDiverseFrames(candidates, {
    maxFrames: 8,
    hammingThreshold: 4,
    coverageIntervalSeconds: 10_000,
  });
  assert.ok(kept.length <= 8);
  assert.ok(kept.length >= 1);
  // Strictly increasing in time.
  for (let i = 1; i < kept.length; i += 1) {
    assert.ok(kept[i]!.atSeconds > kept[i - 1]!.atSeconds);
  }
});

test('perceptual hash is stable for the same buffer', () => {
  const buf = solidJpegish(55);
  const { width, height, pixels } = heuristicLuminanceSampler(buf);
  assert.equal(perceptualHash(width, height, pixels), perceptualHash(width, height, pixels));
});
