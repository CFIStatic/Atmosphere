import { config } from '../../config.js';
import { groupForPhrase, isNotable, type Forecast, type ForecastPeriod, type ForecastProvider } from './ports.js';

/**
 * OpenWeatherMap, as the self-serve commercial option.
 *
 * The reason to have this alongside the free government feed: NWS stops at the
 * US border and has no concept of an account, so a customer working Canada, or
 * one who wants a provider with a support contract behind it, has nowhere to
 * go. OpenWeather is a card number and five minutes.
 *
 * It is materially less detailed for severe weather than either NWS or the
 * IBM/Weather Channel product — no hail probability, no storm tracks, a
 * condition string rather than a meteorologist's paragraph. For a restoration
 * contractor that matters, and the settings screen says so rather than
 * presenting the three as interchangeable.
 */

interface OneCallResponse {
  timezone?: string;
  daily?: Array<{
    dt?: number;
    temp?: { day?: number; max?: number };
    wind_speed?: number;
    wind_deg?: number;
    pop?: number;
    weather?: Array<{ main?: string; description?: string }>;
  }>;
  hourly?: Array<{
    dt?: number;
    temp?: number;
    wind_speed?: number;
    wind_deg?: number;
    pop?: number;
    weather?: Array<{ main?: string; description?: string }>;
  }>;
}

/** Degrees → the compass point a person would say. */
function compass(deg: number | undefined): string | null {
  if (typeof deg !== 'number') return null;
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round(deg / 22.5) % 16];
}

export class OpenWeatherForecastProvider implements ForecastProvider {
  readonly name = 'OpenWeather';
  readonly metered = true;

  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async call(lat: number, lon: number): Promise<OneCallResponse | null> {
    const url = new URL('/data/3.0/onecall', config.campaigns.openWeatherBaseUrl);
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lon));
    url.searchParams.set('appid', this.apiKey);
    url.searchParams.set('units', 'imperial');
    url.searchParams.set('exclude', 'minutely,current');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.campaigns.requestTimeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      return (await res.json()) as OneCallResponse;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async verify(): Promise<void> {
    const url = new URL('/data/3.0/onecall', config.campaigns.openWeatherBaseUrl);
    url.searchParams.set('lat', '30.2672');
    url.searchParams.set('lon', '-97.7431');
    url.searchParams.set('appid', this.apiKey);
    const res = await fetch(url);
    if (res.status === 401) throw new Error('OpenWeather rejected the API key.');
    if (!res.ok) throw new Error(`OpenWeather returned ${res.status}.`);
  }

  async daily(lat: number, lon: number): Promise<Forecast | null> {
    const body = await this.call(lat, lon);
    if (!body?.daily) return null;

    const periods: ForecastPeriod[] = body.daily.slice(0, 8).map((d) => {
      const phrase = d.weather?.[0]?.description ?? d.weather?.[0]?.main ?? '';
      const start = new Date((d.dt ?? 0) * 1000);
      return {
        name: start.toLocaleDateString('en-US', { weekday: 'long' }),
        startTime: start.toISOString(),
        endTime: null,
        isDaytime: true,
        temperature: typeof d.temp?.max === 'number' ? Math.round(d.temp.max) : null,
        temperatureUnit: 'F',
        windSpeed: typeof d.wind_speed === 'number' ? `${Math.round(d.wind_speed)} mph` : null,
        windDirection: compass(d.wind_deg),
        precipitationChance: typeof d.pop === 'number' ? Math.round(d.pop * 100) : null,
        // Title-cased so it reads like the other providers rather than
        // "scattered thunderstorms" mid-sentence in a table.
        shortForecast: phrase.replace(/\b\w/g, (c) => c.toUpperCase()),
        detailedForecast: null,
        notable: isNotable(phrase),
        group: groupForPhrase(phrase),
      };
    });

    return {
      place: body.timezone ?? null,
      lat,
      lon,
      periods,
      provider: this.name,
      attribution: 'Forecast from OpenWeather',
    };
  }

  async hourly(lat: number, lon: number): Promise<Forecast | null> {
    const body = await this.call(lat, lon);
    if (!body?.hourly) return null;

    const periods: ForecastPeriod[] = body.hourly.slice(0, 48).map((h) => {
      const phrase = h.weather?.[0]?.description ?? h.weather?.[0]?.main ?? '';
      const start = new Date((h.dt ?? 0) * 1000);
      return {
        name: start.toLocaleTimeString('en-US', { hour: 'numeric' }),
        startTime: start.toISOString(),
        endTime: null,
        isDaytime: start.getHours() > 6 && start.getHours() < 20,
        temperature: typeof h.temp === 'number' ? Math.round(h.temp) : null,
        temperatureUnit: 'F',
        windSpeed: typeof h.wind_speed === 'number' ? `${Math.round(h.wind_speed)} mph` : null,
        windDirection: compass(h.wind_deg),
        precipitationChance: typeof h.pop === 'number' ? Math.round(h.pop * 100) : null,
        shortForecast: phrase.replace(/\b\w/g, (c) => c.toUpperCase()),
        detailedForecast: null,
        notable: isNotable(phrase),
        group: groupForPhrase(phrase),
      };
    });

    return {
      place: body.timezone ?? null,
      lat,
      lon,
      periods,
      provider: this.name,
      attribution: 'Forecast from OpenWeather',
    };
  }
}
