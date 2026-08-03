/**
 * The weather-forecast port.
 *
 * Alerts answer "is something happening right now". A forecast answers "is
 * something coming", and that is the question the sales side actually runs on:
 * a warning gives you minutes to hours, which is too late to be first, while a
 * forecast gives you the two days that make the difference between being the
 * call they already had and being the fourth voicemail.
 *
 * There is more than one implementation because the honest answer to "use the
 * Weather Channel API" is that it is an IBM enterprise product behind a sales
 * contract, and a restoration company wanting to try this on Tuesday cannot.
 * So the port exists and there are three ways to fill it:
 *
 *   NWS       Free, no key, US only, government-authoritative. Works today.
 *   OpenWx    A few dollars a month, global, self-serve within minutes.
 *   IBM/TWC   The one that was asked for. Better severe-weather modelling —
 *             hail swaths especially — and a procurement conversation.
 *
 * Nothing above this file knows which answered, and moving between them is a
 * config change rather than a rewrite.
 */

export interface ForecastPeriod {
  /** 'Tonight', 'Tuesday', or an ISO hour for hourly forecasts. */
  name: string;
  startTime: string;
  endTime: string | null;
  isDaytime: boolean;
  temperature: number | null;
  temperatureUnit: string;
  windSpeed: string | null;
  windDirection: string | null;
  /** 0–100, where the provider gives one. */
  precipitationChance: number | null;
  /** 'Scattered Showers And Thunderstorms' */
  shortForecast: string;
  detailedForecast: string | null;
  /**
   * True when the wording describes weather that produces restoration work.
   * Derived here rather than by the caller so every provider is judged the
   * same way.
   */
  notable: boolean;
  /** Which of our event groups the wording suggests, when it suggests one. */
  group: string | null;
}

export interface Forecast {
  /** Where this is for, in the provider's words. */
  place: string | null;
  lat: number;
  lon: number;
  periods: ForecastPeriod[];
  /** Which implementation answered — shown so a customer knows the source. */
  provider: string;
  attribution: string;
}

export interface ForecastProvider {
  readonly name: string;
  /** True when calls cost money, so the UI can be honest about it. */
  readonly metered: boolean;
  /** Credential check for the settings screen. Throws when unusable. */
  verify(): Promise<void>;
  /**
   * Several days ahead for one point. Must never throw — a weather outage is
   * not a reason to fail a page, and an empty forecast is an honest answer.
   */
  daily(lat: number, lon: number): Promise<Forecast | null>;
  /** The next couple of days, hour by hour. Null when unsupported. */
  hourly(lat: number, lon: number): Promise<Forecast | null>;
}

/**
 * Which of our event groups a forecast phrase describes.
 *
 * Deliberately keyword-based over the provider's own prose rather than a
 * per-provider mapping table: every service writes "Scattered Showers And
 * Thunderstorms" in more or less the same English, and a table would need
 * maintaining three times for the same words.
 *
 * Order matters — the more specific and more damaging wins, because a phrase
 * mentioning both hail and rain is a hail day.
 */
export function groupForPhrase(phrase: string): string | null {
  const p = phrase.toLowerCase();
  if (/hurricane|tropical storm/.test(p)) return 'hurricane';
  if (/tornado/.test(p)) return 'tornado';
  if (/hail/.test(p)) return 'hail';
  if (/blizzard|ice storm|freezing rain|sleet|winter storm|hard freeze/.test(p)) return 'winter';
  if (/flood/.test(p)) return 'flood';
  if (/severe thunderstorm|damaging wind|high wind|wind advisory/.test(p)) return 'wind';
  // A plain thunderstorm is the one that most often produces hail in Texas,
  // and it is the phrase NWS uses for the days worth calling ahead of.
  if (/thunderstorm/.test(p)) return 'hail';
  return null;
}

/** Is this a day a restoration contractor should be making calls about? */
export function isNotable(phrase: string): boolean {
  return groupForPhrase(phrase) !== null;
}
