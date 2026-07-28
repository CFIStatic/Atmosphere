/**
 * Catalog of CRM systems Atmosphere can connect to.
 *
 * Named presets (Dash, Luxor, Salesforce, …) ship with known auth shapes and
 * default entity paths. Anything else uses the generic REST or CSV connectors —
 * "any and every CRM" is the design goal, not a closed list.
 */

export type CrmDirection = 'pull' | 'push' | 'bidirectional';
export type CrmAuthStyle = 'bearer' | 'header' | 'basic' | 'salesforce' | 'none';

export interface CrmCatalogEntry {
  /** Stable id stored on crm_external_sources.system */
  id: string;
  name: string;
  blurb: string;
  /** Source kind used when creating the connection. */
  kind: 'rest' | 'csv' | 'manual';
  direction: CrmDirection;
  auth: CrmAuthStyle;
  /** Default non-secret config merged into the source row. */
  defaultConfig: Record<string, unknown>;
  /** Fields the connect form asks for. */
  credentialFields: Array<'apiKey' | 'username' | 'password' | 'securityToken' | 'accountId' | 'baseUrl' | 'instanceUrl'>;
  /** Entity types this connector understands for promote / push. */
  entities: string[];
  /** True when the connector can run without live vendor credentials (demo data). */
  supportsSandbox: boolean;
}

export const CRM_CATALOG: CrmCatalogEntry[] = [
  {
    id: 'dash',
    name: 'Dash',
    blurb: 'Restoration CRM — pull jobs, customers, and properties; push notes and activities.',
    kind: 'rest',
    direction: 'bidirectional',
    auth: 'bearer',
    defaultConfig: {
      baseUrl: '',
      auth: 'bearer',
      sandbox: false,
      entities: [
        {
          type: 'contact',
          path: '/customers',
          idField: 'id',
          updatedField: 'updatedAt',
          dataPath: 'data',
          pagination: 'page',
          pageParam: 'page',
          sizeParam: 'limit',
          pageSize: 100,
        },
        {
          type: 'property',
          path: '/properties',
          idField: 'id',
          updatedField: 'updatedAt',
          dataPath: 'data',
          pagination: 'page',
          pageParam: 'page',
          sizeParam: 'limit',
          pageSize: 100,
        },
        {
          type: 'job',
          path: '/jobs',
          idField: 'id',
          updatedField: 'updatedAt',
          dataPath: 'data',
          pagination: 'page',
          pageParam: 'page',
          sizeParam: 'limit',
          pageSize: 100,
        },
      ],
    },
    credentialFields: ['apiKey', 'accountId', 'baseUrl'],
    entities: ['contact', 'property', 'job', 'note'],
    supportsSandbox: true,
  },
  {
    id: 'luxor',
    name: 'Luxor',
    blurb: 'Field / claims CRM — sync contacts and loss locations; write follow-ups back.',
    kind: 'rest',
    direction: 'bidirectional',
    auth: 'bearer',
    defaultConfig: {
      baseUrl: '',
      auth: 'bearer',
      sandbox: false,
      entities: [
        {
          type: 'contact',
          path: '/api/v1/contacts',
          idField: 'id',
          updatedField: 'updated_at',
          dataPath: 'results',
          pagination: 'offset',
          pageParam: 'offset',
          sizeParam: 'limit',
          pageSize: 100,
        },
        {
          type: 'property',
          path: '/api/v1/locations',
          idField: 'id',
          updatedField: 'updated_at',
          dataPath: 'results',
          pagination: 'offset',
          pageParam: 'offset',
          sizeParam: 'limit',
          pageSize: 100,
        },
      ],
    },
    credentialFields: ['apiKey', 'baseUrl'],
    entities: ['contact', 'property', 'note'],
    supportsSandbox: true,
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    blurb: 'Sales Cloud contacts and accounts via the REST API; push tasks and notes.',
    kind: 'rest',
    direction: 'bidirectional',
    auth: 'salesforce',
    defaultConfig: {
      baseUrl: '',
      auth: 'bearer',
      sandbox: false,
      apiVersion: 'v59.0',
      entities: [
        {
          type: 'contact',
          path: '/services/data/v59.0/query',
          idField: 'Id',
          updatedField: 'LastModifiedDate',
          dataPath: 'records',
          pagination: 'cursor',
          cursorPath: 'nextRecordsUrl',
          query: {
            q: 'SELECT Id, FirstName, LastName, Email, Phone, MobilePhone, MailingStreet, MailingCity, MailingState, MailingPostalCode, MailingCountry, AccountId, LastModifiedDate FROM Contact',
          },
        },
        {
          type: 'account',
          path: '/services/data/v59.0/query',
          idField: 'Id',
          updatedField: 'LastModifiedDate',
          dataPath: 'records',
          pagination: 'cursor',
          cursorPath: 'nextRecordsUrl',
          query: {
            q: 'SELECT Id, Name, Phone, Website, BillingStreet, BillingCity, BillingState, BillingPostalCode, BillingCountry, LastModifiedDate FROM Account',
          },
        },
      ],
    },
    credentialFields: ['apiKey', 'instanceUrl', 'username', 'password', 'securityToken'],
    entities: ['contact', 'account', 'task', 'note'],
    supportsSandbox: true,
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    blurb: 'CRM contacts and companies; push notes onto deal and contact timelines.',
    kind: 'rest',
    direction: 'bidirectional',
    auth: 'bearer',
    defaultConfig: {
      baseUrl: 'https://api.hubapi.com',
      auth: 'bearer',
      sandbox: false,
      entities: [
        {
          type: 'contact',
          path: '/crm/v3/objects/contacts',
          idField: 'id',
          updatedField: 'updatedAt',
          dataPath: 'results',
          pagination: 'cursor',
          cursorPath: 'paging.next.after',
          cursorParam: 'after',
          sizeParam: 'limit',
          pageSize: 100,
        },
        {
          type: 'company',
          path: '/crm/v3/objects/companies',
          idField: 'id',
          updatedField: 'updatedAt',
          dataPath: 'results',
          pagination: 'cursor',
          cursorPath: 'paging.next.after',
          cursorParam: 'after',
          sizeParam: 'limit',
          pageSize: 100,
        },
      ],
    },
    credentialFields: ['apiKey'],
    entities: ['contact', 'company', 'note'],
    supportsSandbox: true,
  },
  {
    id: 'jobnimbus',
    name: 'JobNimbus',
    blurb: 'Restoration job management — contacts, jobs, and activity write-back.',
    kind: 'rest',
    direction: 'bidirectional',
    auth: 'header',
    defaultConfig: {
      baseUrl: 'https://app.jobnimbus.com/api1',
      auth: 'header',
      authHeader: 'Authorization',
      sandbox: false,
      entities: [
        {
          type: 'contact',
          path: '/contacts',
          idField: 'jnid',
          updatedField: 'date_updated',
          dataPath: 'results',
          pagination: 'offset',
          pageParam: 'from',
          sizeParam: 'size',
          pageSize: 100,
        },
        {
          type: 'job',
          path: '/jobs',
          idField: 'jnid',
          updatedField: 'date_updated',
          dataPath: 'results',
          pagination: 'offset',
          pageParam: 'from',
          sizeParam: 'size',
          pageSize: 100,
        },
      ],
    },
    credentialFields: ['apiKey'],
    entities: ['contact', 'job', 'note'],
    supportsSandbox: true,
  },
  {
    id: 'encircle',
    name: 'Encircle',
    blurb: 'Property documentation claims — pull insured contacts and property addresses.',
    kind: 'rest',
    direction: 'pull',
    auth: 'bearer',
    defaultConfig: {
      baseUrl: '',
      auth: 'bearer',
      sandbox: false,
      entities: [
        {
          type: 'contact',
          path: '/v1/contacts',
          idField: 'id',
          updatedField: 'updated_at',
          dataPath: 'data',
          pagination: 'page',
          pageSize: 100,
        },
        {
          type: 'property',
          path: '/v1/properties',
          idField: 'id',
          updatedField: 'updated_at',
          dataPath: 'data',
          pagination: 'page',
          pageSize: 100,
        },
      ],
    },
    credentialFields: ['apiKey', 'baseUrl'],
    entities: ['contact', 'property'],
    supportsSandbox: true,
  },
  {
    id: 'rest',
    name: 'Any REST CRM',
    blurb: 'Point Atmosphere at any JSON HTTP API — configure paths, auth, and pagination yourself.',
    kind: 'rest',
    direction: 'bidirectional',
    auth: 'bearer',
    defaultConfig: {
      baseUrl: '',
      auth: 'bearer',
      sandbox: false,
      entities: [
        {
          type: 'contact',
          path: '/contacts',
          idField: 'id',
          dataPath: 'data',
          pagination: 'page',
          pageSize: 100,
        },
      ],
    },
    credentialFields: ['apiKey', 'username', 'password', 'baseUrl'],
    entities: ['contact', 'property', 'account', 'job', 'note'],
    supportsSandbox: true,
  },
  {
    id: 'csv',
    name: 'CSV export',
    blurb: 'No API? Export contacts from any CRM and import the file. Works with every system.',
    kind: 'csv',
    direction: 'pull',
    auth: 'none',
    defaultConfig: {},
    credentialFields: [],
    entities: ['contact', 'property'],
    supportsSandbox: false,
  },
];

const BY_ID = new Map(CRM_CATALOG.map((entry) => [entry.id, entry]));

export function catalogEntry(systemId: string): CrmCatalogEntry | undefined {
  return BY_ID.get(systemId.toLowerCase());
}

export function listCatalog(): CrmCatalogEntry[] {
  return CRM_CATALOG;
}
