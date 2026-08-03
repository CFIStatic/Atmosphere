import { config } from '../config.js';
import { HunterProvider } from './hunter.js';
import { PeopleDataLabsProvider } from './peopleDataLabs.js';
import { SandboxContactProvider } from './sandbox.js';
import { buildMailboxVerifier } from './verifiers/index.js';
import type { ContactDataProvider } from './ports.js';

export * from './ports.js';
export { SandboxContactProvider } from './sandbox.js';
export { HunterProvider } from './hunter.js';

/**
 * Every vendor worth asking, in the order to ask them.
 *
 * One provider never has everybody; the waterfall walks this list and takes
 * the first answer, which is what turns a ~50% hit rate into something a
 * salesperson can work with. Adding a vendor is adding a line here.
 *
 * PDL leads because it answers by person id, which is what a reveal has in
 * hand. Hunter follows because it is strongest exactly where PDL is weakest —
 * small companies whose addresses are published but whose staff are in no
 * people-database.
 */
export function buildProviderChain(): ContactDataProvider[] {
  if (config.prospecting.mode === 'sandbox') return [new SandboxContactProvider()];

  const chain: ContactDataProvider[] = [];
  if (config.prospecting.peopleDataLabsApiKey) {
    chain.push(new PeopleDataLabsProvider(config.prospecting.peopleDataLabsApiKey));
  }
  if (config.prospecting.hunterApiKey) {
    chain.push(new HunterProvider(config.prospecting.hunterApiKey));
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
    case 'hunter': {
      const key = config.prospecting.hunterApiKey;
      if (!key) return new SandboxContactProvider();
      return new HunterProvider(key);
    }
    case 'people_data_labs':
    default: {
      const key = config.prospecting.peopleDataLabsApiKey;
      // A live mode with no key is a misconfiguration, not a reason to bill
      // someone for nothing — fall back and let the UI say "sandbox".
      if (!key) return new SandboxContactProvider();
      return new PeopleDataLabsProvider(key);
    }
  }
}

/** One vendor or verifier, as the settings screen needs to describe it. */
export interface IntegrationStatus {
  id: string;
  name: string;
  kind: 'source' | 'verifier';
  /** Whether credentials are present at all. */
  configured: boolean;
  /** Null until tested; true/false after a live credential check. */
  reachable: boolean | null;
  /** Why it is not reachable, in words an operator can act on. */
  detail: string | null;
  /** What it costs us per call, in nanodollars, where it costs anything. */
  costNanos: number;
}

/**
 * What is actually plugged in, and does it work.
 *
 * `test` makes a real credential call against each integration. It is the
 * difference between a settings screen that lists environment variables and
 * one that tells an operator the truth — a key can be present, well-formed,
 * and rejected, or valid with no credits left behind it.
 */
export async function integrationStatus(test = false): Promise<IntegrationStatus[]> {
  const p = config.prospecting;

  const entries: Array<{
    id: string;
    name: string;
    kind: 'source' | 'verifier';
    configured: boolean;
    costNanos: number;
    probe: (() => Promise<void>) | null;
  }> = [
    {
      id: 'people_data_labs',
      name: 'People Data Labs',
      kind: 'source',
      configured: Boolean(p.peopleDataLabsApiKey),
      costNanos: p.revealCostNanos,
      probe: p.peopleDataLabsApiKey
        ? () => new PeopleDataLabsProvider(p.peopleDataLabsApiKey).verify()
        : null,
    },
    {
      id: 'hunter',
      name: 'Hunter',
      kind: 'source',
      configured: Boolean(p.hunterApiKey),
      costNanos: p.hunterCostNanos,
      probe: p.hunterApiKey ? () => new HunterProvider(p.hunterApiKey).verify() : null,
    },
  ];

  const verifier = buildMailboxVerifier();
  for (const v of ['zerobounce', 'neverbounce', 'smtp'] as const) {
    const configured =
      v === 'zerobounce'
        ? Boolean(p.zeroBounceApiKey)
        : v === 'neverbounce'
          ? Boolean(p.neverBounceApiKey)
          : p.smtpProbeEnabled;
    const name = v === 'zerobounce' ? 'ZeroBounce' : v === 'neverbounce' ? 'NeverBounce' : 'SMTP';
    entries.push({
      id: v,
      name,
      kind: 'verifier',
      configured,
      costNanos: 0,
      // Only the verifier actually in use is worth a live check; probing the
      // others would spend credits to answer a question nobody asked.
      probe: configured && verifier?.name === name ? () => verifier.verify() : null,
    });
  }

  return Promise.all(
    entries.map(async (e) => {
      const base: IntegrationStatus = {
        id: e.id,
        name: e.name,
        kind: e.kind,
        configured: e.configured,
        reachable: null,
        detail: null,
        costNanos: e.costNanos,
      };
      if (!test || !e.probe) return base;
      try {
        await e.probe();
        return { ...base, reachable: true };
      } catch (err) {
        return {
          ...base,
          reachable: false,
          detail: err instanceof Error ? err.message : 'Credential check failed.',
        };
      }
    }),
  );
}
