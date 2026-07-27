import { config } from '../../config.js';
import { HttpError } from '../../lib/errors.js';
import type { ProviderSecret } from '../credentials.js';
import type { Provider } from '../types.js';
import { DocuSketchConnector } from './docusketch.js';
import { DashConnector } from './dash.js';
import { XactimateConnector } from './xactimate.js';
import {
  FixtureCrmConnector,
  FixtureEstimateConnector,
  FixtureScanConnector,
} from './fixtures.js';
import type { ConnectorSet } from './ports.js';

export type { ConnectorSet } from './ports.js';

/**
 * Building the connector set for a run.
 *
 * `sandbox` mode is not a stub for missing features — it is how the pipeline is
 * developed, demoed, and tested without pointing at a customer's live
 * DocuSketch, Dash, and Xactimate accounts. Production defaults to `live`, so a
 * deploy cannot accidentally serve fixtures.
 */

/** A vendor's host: the org's own override wins over the server default. */
function baseUrlFor(provider: Provider, secret: ProviderSecret | undefined): string {
  const serverDefault =
    provider === 'docusketch'
      ? config.estimator.docusketchBaseUrl
      : provider === 'dash'
        ? config.estimator.dashBaseUrl
        : config.estimator.xactimateBaseUrl;

  const url = secret?.baseUrl || serverDefault;
  if (!url) {
    throw new HttpError(
      503,
      `No API host is configured for ${provider}. Set the server's base URL for it, or store one with the credentials.`,
      'connector_unconfigured',
    );
  }
  return url;
}

export type SecretsByProvider = Partial<Record<Provider, ProviderSecret>>;

export function buildConnectors(secrets: SecretsByProvider): ConnectorSet {
  if (config.estimator.connectorMode === 'sandbox') {
    return {
      scan: new FixtureScanConnector(),
      crm: new FixtureCrmConnector(),
      estimating: new FixtureEstimateConnector(),
      mode: 'sandbox',
    };
  }

  const missing = (['docusketch', 'dash', 'xactimate'] as Provider[]).filter(
    (provider) => !secrets[provider],
  );
  if (missing.length > 0) {
    throw new HttpError(
      400,
      `Connect ${missing.join(', ')} before running the estimator.`,
      'credentials_missing',
    );
  }

  return {
    scan: new DocuSketchConnector(baseUrlFor('docusketch', secrets.docusketch), secrets.docusketch!),
    crm: new DashConnector(baseUrlFor('dash', secrets.dash), secrets.dash!),
    estimating: new XactimateConnector(baseUrlFor('xactimate', secrets.xactimate), secrets.xactimate!),
    mode: 'live',
  };
}

/** True when a run can start without the caller storing credentials first. */
export function isSandbox(): boolean {
  return config.estimator.connectorMode === 'sandbox';
}
