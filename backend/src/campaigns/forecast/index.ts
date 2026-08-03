import { config } from '../../config.js';
import { NwsForecastProvider } from './nws.js';
import { OpenWeatherForecastProvider } from './openWeather.js';
import type { ForecastProvider } from './ports.js';

export * from './ports.js';
export { NwsForecastProvider } from './nws.js';
export { OpenWeatherForecastProvider } from './openWeather.js';

/**
 * Which forecast provider answers.
 *
 * NWS is the default and it is not a placeholder: free, no key, and the same
 * data the commercial services build on. A deployment gets working forecasts
 * with nothing configured, which is the difference between a feature people
 * try and one that waits behind a procurement conversation.
 */
export function buildForecastProvider(): ForecastProvider {
  const choice = config.campaigns.forecastProvider;
  if (choice === 'openweather' && config.campaigns.openWeatherApiKey) {
    return new OpenWeatherForecastProvider(config.campaigns.openWeatherApiKey);
  }
  if (choice === 'auto' && config.campaigns.openWeatherApiKey) {
    return new OpenWeatherForecastProvider(config.campaigns.openWeatherApiKey);
  }
  return new NwsForecastProvider();
}

/**
 * What a deployment could use, and what it would take.
 *
 * The Weather Channel entry is here specifically so the settings screen can
 * tell the truth about it rather than showing a field that silently never
 * works: it is an IBM enterprise product behind a sales contract, and no
 * amount of UI makes it self-serve.
 */
export const FORECAST_PROVIDERS = [
  {
    id: 'nws',
    name: 'National Weather Service',
    cost: 'Free',
    available: true,
    note: 'US only. Government-authoritative, and the source the commercial services start from. Detailed severe-weather wording — the paragraph that mentions hail size.',
  },
  {
    id: 'openweather',
    name: 'OpenWeather',
    cost: 'From ~$0 / 1,000 calls',
    available: Boolean(config.campaigns.openWeatherApiKey),
    note: 'Global, self-serve in minutes. Less severe-weather detail — a condition string rather than a forecaster’s discussion, and no hail specifics.',
  },
  {
    id: 'weatherchannel',
    name: 'The Weather Channel (IBM)',
    cost: 'Enterprise contract',
    available: false,
    note: 'Not self-serve. Sold through IBM Environmental Intelligence Suite and priced by contract. Buys hail swaths and storm tracks, which is genuinely better for this trade — but it is a procurement conversation, not an API key.',
  },
];
