import { z } from 'zod';

/**
 * Organized Field Capture context payloads.
 *
 * Categories match the admin portal sections. Values are what Apple allows
 * for a work-verification capture app with declared purpose strings — never
 * advertising IDs or cross-app tracking.
 */

export const deviceBundleSchema = z
  .object({
    model: z.string().max(120).optional(),
    modelIdentifier: z.string().max(80).optional(),
    systemName: z.string().max(40).optional(),
    systemVersion: z.string().max(40).optional(),
    appVersion: z.string().max(40).optional(),
    buildNumber: z.string().max(40).optional(),
    bundleId: z.string().max(120).optional(),
    locale: z.string().max(40).optional(),
    region: z.string().max(40).optional(),
    timeZone: z.string().max(80).optional(),
    screenWidth: z.number().int().positive().optional(),
    screenHeight: z.number().int().positive().optional(),
    screenScale: z.number().positive().optional(),
    identifierForVendor: z.string().max(80).optional(),
  })
  .passthrough();

export const permissionsBundleSchema = z
  .object({
    camera: z.string().max(40).optional(),
    microphone: z.string().max(40).optional(),
    locationWhenInUse: z.string().max(40).optional(),
    motion: z.string().max(40).optional(),
  })
  .passthrough();

export const capabilitiesBundleSchema = z
  .object({
    lidarAvailable: z.boolean().optional(),
    roomPlanAvailable: z.boolean().optional(),
    barometerAvailable: z.boolean().optional(),
    pedometerAvailable: z.boolean().optional(),
    activityAvailable: z.boolean().optional(),
    cameraDevices: z
      .array(
        z.object({
          position: z.string().max(40).optional(),
          uniqueId: z.string().max(120).optional(),
          localizedName: z.string().max(120).optional(),
          hasTorch: z.boolean().optional(),
        }),
      )
      .max(12)
      .optional(),
  })
  .passthrough();

export const environmentBundleSchema = z
  .object({
    batteryLevel: z.number().min(0).max(1).nullable().optional(),
    batteryState: z.string().max(40).optional(),
    lowPowerMode: z.boolean().optional(),
    thermalState: z.string().max(40).optional(),
    networkType: z.string().max(40).optional(),
    networkExpensive: z.boolean().optional(),
    diskFreeBytes: z.number().int().nonnegative().optional(),
    diskTotalBytes: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const captureBundleSchema = z
  .object({
    hasVideo: z.boolean().optional(),
    hasAudio: z.boolean().optional(),
    durationSeconds: z.number().min(0).optional(),
    byteSize: z.number().int().nonnegative().optional(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    contentType: z.string().max(80).optional(),
    storagePath: z.string().max(500).optional(),
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    phase: z.enum(['before', 'after']).optional(),
  })
  .passthrough();

export const locationSummarySchema = z
  .object({
    sampleCount: z.number().int().nonnegative().optional(),
    firstAt: z.string().datetime().optional(),
    lastAt: z.string().datetime().optional(),
    startLat: z.number().min(-90).max(90).optional(),
    startLon: z.number().min(-180).max(180).optional(),
    endLat: z.number().min(-90).max(90).optional(),
    endLon: z.number().min(-180).max(180).optional(),
    bestAccuracyM: z.number().min(0).optional(),
    worstAccuracyM: z.number().min(0).optional(),
  })
  .passthrough();

export const motionSummarySchema = z
  .object({
    sampleCount: z.number().int().nonnegative().optional(),
    dominantActivity: z.string().max(40).optional(),
    stepCount: z.number().int().nonnegative().optional(),
    pressureMinHpa: z.number().optional(),
    pressureMaxHpa: z.number().optional(),
  })
  .passthrough();

export const startSessionSchema = z.object({
  jobId: z.string().uuid(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  platform: z.enum(['ios', 'web']).default('ios'),
  appVersion: z.string().max(40).optional(),
  device: deviceBundleSchema.optional(),
  permissions: permissionsBundleSchema.optional(),
  capabilities: capabilitiesBundleSchema.optional(),
  environment: environmentBundleSchema.optional(),
});

export const locationSampleSchema = z.object({
  recordedAt: z.string().datetime(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).optional(),
  altitudeM: z.number().optional(),
  altitudeAccuracyM: z.number().min(0).optional(),
  speedMps: z.number().min(0).optional(),
  courseDeg: z.number().min(0).max(360).optional(),
  floor: z.number().int().optional(),
});

export const motionSampleSchema = z.object({
  recordedAt: z.string().datetime(),
  activity: z.string().max(40).optional(),
  confidence: z.number().min(0).max(1).optional(),
  pitchDeg: z.number().optional(),
  rollDeg: z.number().optional(),
  yawDeg: z.number().optional(),
  pressureHpa: z.number().optional(),
  relativeAltitudeM: z.number().optional(),
  stepCount: z.number().int().nonnegative().optional(),
});

export const samplesSchema = z.object({
  locations: z.array(locationSampleSchema).max(200).optional(),
  motion: z.array(motionSampleSchema).max(200).optional(),
});

export const heartbeatSchema = z.object({
  device: deviceBundleSchema.optional(),
  permissions: permissionsBundleSchema.optional(),
  capabilities: capabilitiesBundleSchema.optional(),
  environment: environmentBundleSchema.optional(),
  locations: z.array(locationSampleSchema).max(200).optional(),
  motion: z.array(motionSampleSchema).max(200).optional(),
});

export const completeSessionSchema = z.object({
  proofId: z.string().uuid().optional(),
  capture: captureBundleSchema.optional(),
  locationSummary: locationSummarySchema.optional(),
  motionSummary: motionSummarySchema.optional(),
  device: deviceBundleSchema.optional(),
  permissions: permissionsBundleSchema.optional(),
  capabilities: capabilitiesBundleSchema.optional(),
  environment: environmentBundleSchema.optional(),
  status: z.enum(['completed', 'abandoned']).default('completed'),
});

/** Flatten organized bundles onto a proof row for quick job-file reads. */
export function organizedDeviceContext(input: {
  device?: z.infer<typeof deviceBundleSchema>;
  permissions?: z.infer<typeof permissionsBundleSchema>;
  capabilities?: z.infer<typeof capabilitiesBundleSchema>;
  environment?: z.infer<typeof environmentBundleSchema>;
  capture?: z.infer<typeof captureBundleSchema>;
  locationSummary?: z.infer<typeof locationSummarySchema>;
  motionSummary?: z.infer<typeof motionSummarySchema>;
  platform?: string;
  contextSessionId?: string;
}): Record<string, unknown> {
  return {
    platform: input.platform ?? null,
    contextSessionId: input.contextSessionId ?? null,
    device: input.device ?? {},
    permissions: input.permissions ?? {},
    capabilities: input.capabilities ?? {},
    environment: input.environment ?? {},
    capture: input.capture ?? {},
    locationSummary: input.locationSummary ?? {},
    motionSummary: input.motionSummary ?? {},
  };
}

export function summarizeLocations(
  samples: z.infer<typeof locationSampleSchema>[],
): z.infer<typeof locationSummarySchema> {
  if (!samples.length) return { sampleCount: 0 };
  const sorted = [...samples].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const accuracies = sorted
    .map((s) => s.accuracyM)
    .filter((n): n is number => typeof n === 'number');
  return {
    sampleCount: sorted.length,
    firstAt: first.recordedAt,
    lastAt: last.recordedAt,
    startLat: first.lat,
    startLon: first.lon,
    endLat: last.lat,
    endLon: last.lon,
    bestAccuracyM: accuracies.length ? Math.min(...accuracies) : undefined,
    worstAccuracyM: accuracies.length ? Math.max(...accuracies) : undefined,
  };
}

export function summarizeMotion(
  samples: z.infer<typeof motionSampleSchema>[],
): z.infer<typeof motionSummarySchema> {
  if (!samples.length) return { sampleCount: 0 };
  const counts = new Map<string, number>();
  let stepCount: number | undefined;
  const pressures: number[] = [];
  for (const s of samples) {
    if (s.activity) counts.set(s.activity, (counts.get(s.activity) ?? 0) + 1);
    if (typeof s.stepCount === 'number') {
      stepCount = Math.max(stepCount ?? 0, s.stepCount);
    }
    if (typeof s.pressureHpa === 'number') pressures.push(s.pressureHpa);
  }
  let dominantActivity: string | undefined;
  let best = 0;
  for (const [activity, n] of counts) {
    if (n > best) {
      best = n;
      dominantActivity = activity;
    }
  }
  return {
    sampleCount: samples.length,
    dominantActivity,
    stepCount,
    pressureMinHpa: pressures.length ? Math.min(...pressures) : undefined,
    pressureMaxHpa: pressures.length ? Math.max(...pressures) : undefined,
  };
}

export type DeviceBundle = z.infer<typeof deviceBundleSchema>;
