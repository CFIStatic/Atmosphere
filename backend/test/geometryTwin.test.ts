import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deviceRoomToMeasurements,
  ingestDeviceGeometry,
  isMetricGeometrySource,
} from '../src/geometry/fromDevice.js';
import {
  createSession,
  createTwin,
  resetGeometryStoreForTests,
} from '../src/geometry/store.js';
import {
  attachVideoEvidenceOnly,
  ingestMeasurementsOntoTwin,
  summarizeTwin,
} from '../src/geometry/twin.js';

test('RGB video is not a metric geometry source; RoomPlan/LiDAR are', () => {
  assert.equal(isMetricGeometrySource('video_evidence'), false);
  assert.equal(isMetricGeometrySource('roomplan'), true);
  assert.equal(isMetricGeometrySource('arkit'), true);
  assert.equal(isMetricGeometrySource('lidar'), true);
  assert.equal(isMetricGeometrySource('docusketch'), true);
});

test('device L×W×H becomes estimator-compatible room SF', () => {
  const room = deviceRoomToMeasurements({
    name: 'Living',
    lengthFt: 16,
    widthFt: 12,
    heightFt: 8,
    openings: [{ kind: 'door', width: 3, height: 7 }],
  });
  assert.equal(room.floorAreaSqFt, 192);
  assert.equal(room.ceilingHeightFt, 8);
  assert.ok(room.wallAreaSqFt > 0);
  assert.equal(room.openings.length, 1);
});

test('App Store ingest builds a metric twin with mesh + work + video', () => {
  resetGeometryStoreForTests();
  const twin = createTwin({
    orgId: 'org-1',
    jobId: 'job-1',
    label: 'Meridian Ave',
    primarySource: 'roomplan',
  });
  createSession({
    orgId: 'org-1',
    twinId: twin.id,
    platform: 'ios',
    measureApi: 'roomplan',
    lidarAvailable: true,
  });

  const rooms = ingestDeviceGeometry({
    source: 'roomplan',
    rooms: [
      { name: 'Living', lengthFt: 16, widthFt: 12, heightFt: 8, confidence: 0.92 },
      { name: 'Kitchen', floorAreaSqFt: 140, heightFt: 8, confidence: 0.88 },
    ],
  });
  assert.equal(rooms.length, 2);
  assert.equal(rooms[0]!.source, 'roomplan');

  const updated = ingestMeasurementsOntoTwin(twin.id, {
    source: 'roomplan',
    rooms: [
      { name: 'Living', lengthFt: 16, widthFt: 12, heightFt: 8 },
      { name: 'Kitchen', floorAreaSqFt: 140, heightFt: 8 },
    ],
    mesh: {
      format: 'usdz',
      url: 'https://example.test/meridian.usdz',
      producedBy: 'roomplan',
    },
    videoRef: 'field/day-2026-08-06.mp4',
    work: [
      {
        label: 'Flood cut — living south wall',
        roomId: undefined,
        status: 'in_progress',
        scopeTitle: 'Remove wet drywall to 24"',
      },
    ],
  });

  const summary = summarizeTwin(updated);
  assert.equal(summary.metric, true);
  assert.equal(summary.roomCount, 2);
  assert.equal(summary.hasMesh, true);
  assert.equal(summary.videoCount, 1);
  assert.equal(summary.workCount, 1);
  assert.equal(summary.status, 'ready');
  assert.ok(summary.totalFloorSqFt >= 192);
});

test('video-only attach does not claim metric rooms', () => {
  resetGeometryStoreForTests();
  const twin = createTwin({
    orgId: 'org-1',
    label: 'No LiDAR phone',
    primarySource: 'video_evidence',
  });
  const updated = attachVideoEvidenceOnly(twin.id, {
    videoRef: 'field/day.mp4',
    dictationSummary: 'Crew filmed the living room demo.',
  });
  const summary = summarizeTwin(updated);
  assert.equal(summary.metric, false);
  assert.equal(summary.videoCount, 1);
  assert.equal(summary.status, 'needs_review');
});
