import { config } from '../config.js';
import { PeopleDataLabsProvider } from './peopleDataLabs.js';
import { SandboxContactProvider } from './sandbox.js';
import type { ContactDataProvider } from './ports.js';

export * from './ports.js';
export { SandboxContactProvider } from './sandbox.js';

/**
 * Every vendor worth asking, in the order to ask them.
 *
 * One provider never has everybody; the waterfall walks this list and takes
 * the first answer, which is what turns a ~50% hit rate into something a
 * salesperson can work with. Adding a vendor is adding a line here.
 */
export function buildProviderChain(): ContactDataProvider[] {
  if (config.prospecting.mode === 'sandbox') return [new SandboxContactProvider()];

  const chain: ContactDataProvider[] = [];
  if (config.prospecting.peopleDataLabsApiKey) {
    chain.push(new PeopleDataLabsProvider(config.prospecting.peopleDataLabsApiKey));
  }
  // No licence configured: obvious fixtures beat silently finding nobody.
  if (!chain.length) chain.push(new SandboxContactProvider());
  return chain;
}

/**
 * The single provider used for searching, where a waterfall makes no sense —
 * one result set, from whoever is configured.
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
