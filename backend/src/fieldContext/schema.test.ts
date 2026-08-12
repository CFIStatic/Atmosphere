import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  organizedDeviceContext,
  summarizeLocations,
  summarizeMotion,
} from './schema.js';

describe('field context organization', () => {
  it('keeps Apple-allowed bundles in named sections', () => {
    const ctx = organizedDeviceContext({
      platform: 'ios',
      contextSessionId: '11111111-1111-1111-1111-111111111111',
      device: { model: 'iPhone', systemVersion: '17.5', appVersion: '0.1.0' },
      permissions: { camera: 'authorized', microphone: 'authorized' },
      capabilities: { lidarAvailable: true },
      environment: { batteryLevel: 0.72, networkType: 'wifi' },
      capture: { hasAudio: true, hasVideo: true },
      locationSummary: { sampleCount: 3 },
      motionSummary: { dominantActivity: 'walking' },
    });

    assert.equal(ctx.platform, 'ios');
    assert.equal((ctx.device as { model: string }).model, 'iPhone');
    assert.equal((ctx.permissions as { camera: string }).camera, 'authorized');
    assert.equal((ctx.capabilities as { lidarAvailable: boolean }).lidarAvailable, true);
    assert.equal((ctx.environment as { networkType: string }).networkType, 'wifi');
    assert.equal((ctx.capture as { hasAudio: boolean }).hasAudio, true);
    assert.equal((ctx.locationSummary as { sampleCount: number }).sampleCount, 3);
    assert.equal((ctx.motionSummary as { dominantActivity: string }).dominantActivity, 'walking');
  });

  it('summarizes a location trail', () => {
    const summary = summarizeLocations([
      {
        recordedAt: '2026-08-12T14:00:00.000Z',
        lat: 30.27,
        lon: -97.74,
        accuracyM: 12,
      },
      {
        recordedAt: '2026-08-12T14:05:00.000Z',
        lat: 30.271,
        lon: -97.741,
        accuracyM: 5,
      },
    ]);
    assert.equal(summary.sampleCount, 2);
    assert.equal(summary.bestAccuracyM, 5);
    assert.equal(summary.worstAccuracyM, 12);
    assert.equal(summary.startLat, 30.27);
    assert.equal(summary.endLon, -97.741);
  });

  it('summarizes motion samples', () => {
    const summary = summarizeMotion([
      { recordedAt: '2026-08-12T14:00:00.000Z', activity: 'walking', stepCount: 10, pressureHpa: 1012 },
      { recordedAt: '2026-08-12T14:01:00.000Z', activity: 'walking', stepCount: 40, pressureHpa: 1013 },
      { recordedAt: '2026-08-12T14:02:00.000Z', activity: 'stationary', stepCount: 40, pressureHpa: 1011 },
    ]);
    assert.equal(summary.sampleCount, 3);
    assert.equal(summary.dominantActivity, 'walking');
    assert.equal(summary.stepCount, 40);
    assert.equal(summary.pressureMinHpa, 1011);
    assert.equal(summary.pressureMaxHpa, 1013);
  });
});
