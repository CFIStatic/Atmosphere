import type { Connector, FetchContext, FetchResult } from '../../lib/integrations/types.js';
import { RestConnector } from '../../lib/integrations/restConnector.js';
import { quickBooksConnector } from './quickbooks.js';
import type { FinanceProvider } from '../types.js';

/**
 * Resolve a finance provider to a Connector.
 *
 * QuickBooks gets a first-class client. Everything else rides the generic REST
 * connector so a shop can point Atmosphere at Xero / Wave / FreshBooks /
 * Sage / any online books API without a code change — config describes the
 * surface; the mirror stores the payloads verbatim.
 */

const rest = new RestConnector();

/** Thin wrapper so RestConnector.kind stays 'rest' while we report the provider. */
class ProviderRestConnector implements Connector {
  readonly kind: string;
  constructor(kind: string) {
    this.kind = kind;
  }
  fetch(ctx: FetchContext): Promise<FetchResult> {
    return rest.fetch(ctx);
  }
}

const PROVIDER_CONNECTORS: Partial<Record<FinanceProvider, Connector>> = {
  quickbooks: quickBooksConnector,
  xero: new ProviderRestConnector('xero'),
  wave: new ProviderRestConnector('wave'),
  freshbooks: new ProviderRestConnector('freshbooks'),
  sage: new ProviderRestConnector('sage'),
  generic_accounting: new ProviderRestConnector('generic_accounting'),
  plaid: new ProviderRestConnector('plaid'),
};

export function connectorFor(provider: FinanceProvider): Connector | null {
  return PROVIDER_CONNECTORS[provider] ?? null;
}

export { quickBooksConnector, mapQuickBooksAccount } from './quickbooks.js';
