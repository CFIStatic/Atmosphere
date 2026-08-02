import { config } from '../config.js';
import { PeopleDataLabsProvider } from './peopleDataLabs.js';
import { SandboxContactProvider } from './sandbox.js';
import type { ContactDataProvider } from './ports.js';

export * from './ports.js';
export { SandboxContactProvider } from './sandbox.js';

/**
 * Which vendor answers, decided in one place.
 *
 * Sandbox is the default everywhere except a production deployment that has
 * actually been given a key: a licensed-data feature with no licence should
 * return obviously synthetic people rather than silently return nothing, and
 * the UI says which it is looking at.
 */
export function buildContactProvider(): ContactDataProvider {
  if (config.prospecting.mode === 'sandbox') return new SandboxContactProvider();

  switch (config.prospecting.provider) {
    case 'people_data_labs': {
      const key = config.prospecting.peopleDataLabsApiKey;
      // A live mode with no key is a misconfiguration, not a reason to bill
      // someone for nothing — fall back and let the UI say "sandbox".
      if (!key) return new SandboxContactProvider();
      return new PeopleDataLabsProvider(key);
    }
    default:
      return new SandboxContactProvider();
  }
}
