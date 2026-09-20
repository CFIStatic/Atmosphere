import type { CrmAgentAdapter, CrmAgentSystem } from '../../types.js';
import { acculynxAdapter } from './acculynx.js';
import { jobnimbusAdapter } from './jobnimbus.js';
import { salesforceAdapter } from './salesforce.js';
import { servicetitanAdapter } from './servicetitan.js';

const ADAPTERS: Record<CrmAgentSystem, CrmAgentAdapter> = {
  jobnimbus: jobnimbusAdapter,
  acculynx: acculynxAdapter,
  salesforce: salesforceAdapter,
  servicetitan: servicetitanAdapter,
};

export function getCrmAdapter(system: CrmAgentSystem): CrmAgentAdapter {
  return ADAPTERS[system];
}

export { ADAPTERS };
