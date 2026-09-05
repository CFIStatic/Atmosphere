/**
 * Phone / app identity as filed with a clip.
 *
 * Missing is honest. A guessed iPhone from a user-agent is not a custody fact.
 */

export interface DeviceIdentity {
  make: string | null;
  model: string | null;
  os: string | null;
  appVersion: string | null;
  deviceId: string | null;
  /** Human label when the structured fields are thin ("iPhone 15 · Atmosphere 2.4"). */
  label: string | null;
}

function clean(value: unknown, max = 160): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ').slice(0, max);
  return trimmed || null;
}

/** Accept the phone payload, a demo string, or empty. */
export function parseDeviceMetadata(raw: unknown): DeviceIdentity | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') {
    const label = clean(raw, 200);
    return label
      ? { make: null, model: null, os: null, appVersion: null, deviceId: null, label }
      : null;
  }
  if (typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const make = clean(rec.make ?? rec.manufacturer);
  const model = clean(rec.model ?? rec.phoneModel ?? rec.deviceModel);
  const os = clean(rec.os ?? rec.osVersion ?? rec.system);
  const appVersion = clean(rec.appVersion ?? rec.app_version ?? rec.version);
  const deviceId = clean(rec.deviceId ?? rec.device_id ?? rec.id, 120);
  const label = clean(rec.label) || [make, model, os, appVersion].filter(Boolean).join(' · ') || null;
  if (!make && !model && !os && !appVersion && !deviceId && !label) return null;
  return { make, model, os, appVersion, deviceId, label };
}

/**
 * Progress-share guests already receive the job file and recordings. Hardware
 * / app identifiers are office custody facts — they do not leave the org on
 * a token-only link.
 */
export function redactProofDeviceIdentity<
  T extends { videos?: Array<{ device?: DeviceIdentity | null }> },
>(proof: T): T {
  if (!proof.videos?.length) return proof;
  return {
    ...proof,
    videos: proof.videos.map((video) =>
      video.device == null ? video : { ...video, device: null },
    ),
  };
}
