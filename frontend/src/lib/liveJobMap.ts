/** Client helpers for the office Live map (list + pin board). */

export type LiveActivity =
  | 'uploading'
  | 'on_site'
  | 'recent_upload'
  | 'in_progress'
  | 'idle';

export type LiveMapCoords = {
  lat: number;
  lon: number;
  source: 'proof' | 'property' | 'safety';
};

export type LiveMapSafetyFlag = {
  id: string;
  severity: 'watch' | 'critical';
  category: string;
  title: string;
  status: string;
  createdAt: string;
  source: string;
  lat?: number | null;
  lon?: number | null;
};

export type LiveMapPerson = {
  name: string;
  kind: 'crew' | 'party';
  lastSeenAt: string | null;
};

export type LiveMapJob = {
  jobId: string;
  jobNumber: number | null;
  title: string;
  status: string | null;
  address: string | null;
  activity: LiveActivity;
  coords: LiveMapCoords | null;
  lastPingAt: string | null;
  lastPingLabel: string | null;
  people: LiveMapPerson[];
  openSafetyFlags: LiveMapSafetyFlag[];
  filmedToday: boolean;
};

export type LiveMapResponse = {
  generatedAt: string;
  gaps: string[];
  summary: {
    jobs: number;
    withCoords: number;
    active: number;
    openSafety: number;
    criticalSafety: number;
  };
  jobs: LiveMapJob[];
};

export const ACTIVITY_LABEL: Record<LiveActivity, string> = {
  uploading: 'Uploading',
  on_site: 'On site',
  recent_upload: 'Recent upload',
  in_progress: 'In progress',
  idle: 'Idle',
};

/** Project lon/lat into an SVG viewBox. Returns null when fewer than one point. */
export function projectPins(
  jobs: LiveMapJob[],
  width = 640,
  height = 420,
  pad = 28,
): Array<{ job: LiveMapJob; x: number; y: number }> {
  const withCoords = jobs.filter((j) => j.coords);
  if (withCoords.length === 0) return [];

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const j of withCoords) {
    const { lat, lon } = j.coords!;
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  }

  // Single point or tiny cluster — give a usable frame.
  if (maxLat - minLat < 0.02) {
    minLat -= 0.05;
    maxLat += 0.05;
  }
  if (maxLon - minLon < 0.02) {
    minLon -= 0.05;
    maxLon += 0.05;
  }

  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  return withCoords.map((job) => {
    const { lat, lon } = job.coords!;
    const x = pad + ((lon - minLon) / (maxLon - minLon || 1)) * innerW;
    // SVG y grows downward; north should be up.
    const y = pad + ((maxLat - lat) / (maxLat - minLat || 1)) * innerH;
    return { job, x, y };
  });
}
