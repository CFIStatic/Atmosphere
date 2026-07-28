/**
 * Weather feed for storm outreach.
 *
 * Providers:
 *   nws  — National Weather Service active alerts (no API key).
 *   demo — Deterministic storms anchored to the org's mapped contacts.
 *   auto — Try NWS; fall back to demo on network failure.
 */

import {
  geometryApproxRadiusMiles,
  geometryCentroid,
} from './geo.js';
import type {
  GeoPolygon,
  LatLng,
  StormSeverity,
  StormStatus,
  WeatherAlert,
  WeatherSource,
} from './types.js';

const NWS_USER_AGENT = 'AtmosphereEmailMarketing/1.0 (storm-outreach; support@atmosphere.local)';

/** Alert event types that matter for restoration outreach. */
const RELEVANT_EVENTS = new Set([
  'Tornado Warning',
  'Tornado Watch',
  'Severe Thunderstorm Warning',
  'Severe Thunderstorm Watch',
  'Flash Flood Warning',
  'Flash Flood Watch',
  'Hurricane Warning',
  'Hurricane Watch',
  'Tropical Storm Warning',
  'Tropical Storm Watch',
  'Storm Surge Warning',
  'Storm Surge Watch',
  'Winter Storm Warning',
  'Winter Storm Watch',
  'Blizzard Warning',
  'Ice Storm Warning',
  'High Wind Warning',
  'Extreme Wind Warning',
]);

interface NwsAlertFeature {
  id?: string;
  properties?: {
    id?: string;
    event?: string;
    severity?: string;
    urgency?: string;
    certainty?: string;
    headline?: string;
    description?: string;
    instruction?: string;
    areaDesc?: string;
    onset?: string;
    ends?: string;
    expires?: string;
    status?: string;
    messageType?: string;
  };
  geometry?: {
    type?: string;
    coordinates?: unknown;
  } | null;
}

function mapSeverity(raw: string | undefined, event: string): StormSeverity {
  const s = (raw ?? '').toLowerCase();
  if (s === 'extreme') return 'emergency';
  if (s === 'severe') return 'warning';
  if (s === 'moderate') return 'watch';
  if (s === 'minor') return 'advisory';
  if (/warning/i.test(event)) return 'warning';
  if (/watch/i.test(event)) return 'watch';
  if (/emergency|extreme/i.test(event)) return 'emergency';
  return 'advisory';
}

function mapStatus(raw: string | undefined): StormStatus {
  const s = (raw ?? '').toLowerCase();
  if (s === 'cancelled' || s === 'cancel') return 'cancelled';
  if (s === 'expired') return 'expired';
  return 'active';
}

function asGeoPolygon(geometry: NwsAlertFeature['geometry']): GeoPolygon | null {
  if (!geometry?.type || !geometry.coordinates) return null;
  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
    return {
      type: geometry.type,
      coordinates: geometry.coordinates as GeoPolygon['coordinates'],
    };
  }
  return null;
}

/** Fallback center when an alert has no geometry — continental US midpoint. */
const FALLBACK_CENTER: LatLng = { lat: 39.8, lng: -98.5 };

function featureToAlert(feature: NwsAlertFeature): WeatherAlert | null {
  const props = feature.properties;
  if (!props?.event) return null;
  if (!RELEVANT_EVENTS.has(props.event) && !/storm|tornado|hurricane|flood|wind|blizzard|ice/i.test(props.event)) {
    return null;
  }

  const geometry = asGeoPolygon(feature.geometry);
  const center = geometry ? geometryCentroid(geometry) : FALLBACK_CENTER;
  const radiusMiles = geometry ? geometryApproxRadiusMiles(geometry) : 40;
  const externalId = props.id ?? feature.id;
  if (!externalId) return null;

  return {
    externalId,
    source: 'nws',
    name: props.headline?.split(' issued')[0]?.trim() || props.event,
    eventType: props.event,
    severity: mapSeverity(props.severity, props.event),
    status: mapStatus(props.status),
    headline: props.headline ?? null,
    description: props.description ?? null,
    instruction: props.instruction ?? null,
    center,
    radiusMiles,
    geometry,
    areaDesc: props.areaDesc ?? null,
    onsetAt: props.onset ?? null,
    endsAt: props.ends ?? props.expires ?? null,
    rawPayload: feature,
  };
}

async function fetchNwsAlerts(): Promise<WeatherAlert[]> {
  const url =
    'https://api.weather.gov/alerts/active?status=actual&message_type=alert&limit=100';

  const res = await fetch(url, {
    headers: {
      Accept: 'application/geo+json',
      'User-Agent': NWS_USER_AGENT,
    },
  });

  if (!res.ok) {
    throw new Error(`NWS alerts request failed (${res.status})`);
  }

  const body = (await res.json()) as { features?: NwsAlertFeature[] };
  const alerts: WeatherAlert[] = [];
  for (const feature of body.features ?? []) {
    const alert = featureToAlert(feature);
    if (alert && alert.status === 'active') alerts.push(alert);
  }
  return alerts;
}

/**
 * Demo storms placed near the org's contacts so the whole flow is exercisable
 * without live weather. Deterministic given the same contact set.
 */
export function buildDemoAlerts(contactPoints: LatLng[]): WeatherAlert[] {
  if (contactPoints.length === 0) {
    return [
      {
        externalId: 'demo-midwest-severe',
        source: 'demo',
        name: 'Demo Severe Thunderstorm',
        eventType: 'Severe Thunderstorm Warning',
        severity: 'warning',
        status: 'active',
        headline: 'Demo Severe Thunderstorm Warning for the Midwest',
        description:
          'This is a demonstration alert. Configure mapped CRM properties to see contacts in the path.',
        instruction: 'Use the Email Marketing page to draft outreach.',
        center: { lat: 41.6, lng: -93.6 },
        radiusMiles: 60,
        geometry: null,
        areaDesc: 'Central Iowa (demo)',
        onsetAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
      },
    ];
  }

  // Anchor on the first few contact clusters so someone on the map is always hit.
  const anchors = contactPoints.slice(0, Math.min(3, contactPoints.length));
  return anchors.map((center, index) => {
    const kinds: Array<{
      eventType: string;
      severity: StormSeverity;
      radiusMiles: number;
    }> = [
      { eventType: 'Severe Thunderstorm Warning', severity: 'warning', radiusMiles: 35 },
      { eventType: 'Flash Flood Warning', severity: 'warning', radiusMiles: 25 },
      { eventType: 'Tornado Watch', severity: 'watch', radiusMiles: 50 },
    ];
    const kind = kinds[index % kinds.length]!;
    return {
      externalId: `demo-${kind.eventType.toLowerCase().replace(/\s+/g, '-')}-${index}`,
      source: 'demo' as WeatherSource,
      name: `Demo ${kind.eventType}`,
      eventType: kind.eventType,
      severity: kind.severity,
      status: 'active' as StormStatus,
      headline: `Demo ${kind.eventType} near your contacts`,
      description:
        'Demonstration demonstration storm placed near your mapped CRM contacts so you can try outreach and check-ins.',
      instruction: 'Draft outreach from the Email Marketing page.',
      center: {
        lat: Math.round((center.lat + 0.05) * 1e6) / 1e6,
        lng: Math.round((center.lng - 0.05) * 1e6) / 1e6,
      },
      radiusMiles: kind.radiusMiles,
      geometry: null,
      areaDesc: 'Near your CRM contacts (demo)',
      onsetAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    };
  });
}

export type WeatherProviderMode = 'nws' | 'demo' | 'auto';

export async function fetchWeatherAlerts(options: {
  mode: WeatherProviderMode;
  forceDemo?: boolean;
  contactPoints: LatLng[];
}): Promise<{ alerts: WeatherAlert[]; sourceUsed: WeatherSource; note: string | null }> {
  if (options.forceDemo || options.mode === 'demo') {
    return {
      alerts: buildDemoAlerts(options.contactPoints),
      sourceUsed: 'demo',
      note: 'Using demonstration storms anchored to your mapped contacts.',
    };
  }

  try {
    const alerts = await fetchNwsAlerts();
    if (alerts.length === 0 && options.mode === 'auto') {
      return {
        alerts: buildDemoAlerts(options.contactPoints),
        sourceUsed: 'demo',
        note: 'No active NWS alerts matched; showing demo storms so you can still exercise outreach.',
      };
    }
    return {
      alerts,
      sourceUsed: 'nws',
      note: alerts.length === 0 ? 'No active severe-weather alerts right now.' : null,
    };
  } catch (err) {
    if (options.mode === 'nws') throw err;
    return {
      alerts: buildDemoAlerts(options.contactPoints),
      sourceUsed: 'demo',
      note: `Weather feed unavailable (${err instanceof Error ? err.message : 'error'}); using demo storms.`,
    };
  }
}
