import { config } from '../../config.js';
import { CommonCrawlSource } from './commonCrawl.js';
import { NetworkContactSource } from './network.js';
import { WebsiteContactSource } from './webCrawl.js';
import type { ContactSource } from './ports.js';

export * from './ports.js';
export { WebsiteContactSource } from './webCrawl.js';
export { CommonCrawlSource } from './commonCrawl.js';
export { NetworkContactSource } from './network.js';
export { safeFetchText } from './safeFetch.js';

/**
 * The free sources, in the order to ask them.
 *
 * Ordering is by cost-to-us and freshness together, and both point the same
 * way here since none of these cost anything:
 *
 *   1. Shared network — a database lookup. Instant, and corroborated across
 *      organizations, which is the strongest signal in the product.
 *   2. Company website — one or two HTTPS requests to the company's own site.
 *      Current by definition: it is what they are publishing today.
 *   3. Common Crawl — a public archive. Slower and historical, so it goes
 *      last, but it reaches pages that are no longer up.
 *
 * `adminClient` is optional because the network source needs service-role
 * access to a pool that is deliberately not tenant-readable. Without it the
 * other two still work.
 */
export function buildSourceChain(adminClient?: unknown, orgId?: string): ContactSource[] {
  const chain: ContactSource[] = [];

  if (config.prospecting.networkEnabled && adminClient && orgId) {
    chain.push(new NetworkContactSource(adminClient, orgId));
  }
  if (config.prospecting.webCrawlEnabled) chain.push(new WebsiteContactSource());
  if (config.prospecting.commonCrawlEnabled) chain.push(new CommonCrawlSource());

  return chain;
}
