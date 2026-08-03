import { config } from '../../config.js';
import { groupForPhrase, isNotable, type Forecast, type ForecastPeriod, type ForecastProvider } from './ports.js';

/**
 * The National Weather Service, as a forecast provider.
 *
 * Free, no key, no contract, and it is the forecast every American
 * broadcaster is repeating. For a restoration company working Texas that is
 * not a compromise — it is the same data the commercial services start from,
 * one step earlier.
 *
 * Its shape is unusual and worth knowing: a lat/lon is first resolved to a
 * forecast office and grid square, and only then to a forecast URL. Two calls
 * where most APIs take one. The first result is stable for a location
 * essentially forever, so it is cached — which turns the common case back into
 * a single request.
 */

interface PointsResponse {
  properties?: {
    forecast?: string;
    forecastHourly?: string;
    relativeLocation?: { properties?: { city?: string; state?: string } };
  };
}

interface ForecastResponse {
  properties?: {
    periods?: Array<{
      name?: string;
      startTime?: string;
      endTime?: string;
      isDaytime?: boolean;
      temperature?: number;
      temperatureUnit?: string;
      windSpeed?: string;
      windDirection?: string;
      probabilityOfPrecipitation?: { value?: number | null };
      shortForecast?: string;
      detailedForecast?: string;
    }>;
  };
}

/**
 * lat/lon → forecast URLs.
 *
 * The mapping never changes for a given point, so caching it removes a network
 * round trip from every subsequent lookup. Keyed to four decimal places, which
 * is about eleven metres — far finer than a forecast grid, so two addresses on
 * the same block share an entry.
 */
const pointCache = new Map<string, { forecast: string; hourly: string; place: string | null }>();

async function resolvePoint(
  lat: number,
  lon: number,
): Promise<{ forecast: string; hourly: string; place: string | null } | null> {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = pointCache.get(key);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.campaigns.requestTimeoutMs);
  try {
    const res = await fetch(`${config.campaigns.weatherBaseUrl}/points/${key}`, {
      headers: { 'User-Agent': config.campaigns.userAgent, Accept: 'application/geo+json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const body = (await res.json()) as PointsResponse;
    const forecast = body.properties?.forecast;
    const hourly = body.properties?.forecastHourly;
    if (!forecast || !hourly) return null;

    const rel = body.properties?.relativeLocation?.properties;
    const place = rel?.city ? `${rel.city}, ${rel.state ?? ''}`.trim().replace(/,$/, '') : null;

    const entry = { forecast, hourly, place };
    // Bounded: a busy org looks up hundreds of addresses and this must not
    // become an unbounded leak in a long-running process.
    if (pointCache.size > 5_000) pointCache.clear();
    pointCache.set(key, entry);
    return entry;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function toPeriods(body: ForecastResponse): ForecastPeriod[] {
  return (body.properties?.periods ?? []).map((p) => {
    const short = p.shortForecast ?? '';
    const detailed = p.detailedForecast ?? '';
    // Both fields are read for the classification: the short line says
    // "Chance Showers And Thunderstorms" while the detailed one is where words
    // like "hail" and "damaging winds" actually appear.
    const phrase = `${short} ${detailed}`;
    return {
      name: p.name ?? '',
      startTime: p.startTime ?? '',
      endTime: p.endTime ?? null,
      isDaytime: p.isDaytime ?? true,
      temperature: typeof p.temperature === 'number' ? p.temperature : null,
      temperatureUnit: p.temperatureUnit ?? 'F',
      windSpeed: p.windSpeed ?? null,
      windDirection: p.windDirection ?? null,
      precipitationChance: p.probabilityOfPrecipitation?.value ?? null,
      shortForecast: short,
      detailedForecast: detailed || null,
      notable: isNotable(phrase),
      group: groupForPhrase(phrase),
    };
  });
}

async function fetchForecast(url: string): Promise<ForecastResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.campaigns.requestTimeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': config.campaigns.userAgent, Accept: 'application/geo+json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as ForecastResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export class NwsForecastProvider implements ForecastProvider {
  readonly name = 'National Weather Service';
  readonly metered = false;

  async verify(): Promise<void> {
    // Austin. A point that is always in coverage, so a failure here means the
    // service is unreachable rather than that somebody typed a bad address.
    const point = await resolvePoint(30.2672, -97.7431);
    if (!point) throw new Error('Could not reach the National Weather Service.');
  }

  async daily(lat: number, lon: number): Promise<Forecast | null> {
    const point = await resolvePoint(lat, lon);
    if (!point) return null;
    const body = await fetchForecast(point.forecast);
    if (!body) return null;
    return {
      place: point.place,
      lat,
      lon,
      periods: toPeriods(body),
      provider: this.name,
      attribution: 'Forecast from the US National Weather Service',
    };
  }

  async hourly(lat: number, lon: number): Promise<Forecast | null> {
    const point = await resolvePoint(lat, lon);
    if (!point) return null;
    const body = await fetchForecast(point.hourly);
    if (!body) return null;
    return {
      place: point.place,
      lat,
      lon,
      // Two days of hours is what a salesperson can act on; the API returns
      // a week and the rest is noise on a screen.
      periods: toPeriods(body).slice(0, 48),
      provider: this.name,
      attribution: 'Forecast from the US National Weather Service',
    };
  }
}
