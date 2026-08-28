/**
 * Curated third-party app catalog for restoration, roofing, and contractor
 * teams. Each entry describes how Atmosphere reaches the app — through the
 * browser agent (web), a paired desktop (computer), or an API adapter (api).
 *
 * The catalog is code, not a database table: adding a vendor is a deploy, and
 * every org sees the same definitions. Org-specific state (connected or not,
 * linked credentials) lives in `app_connectors`.
 */

export type ConnectorAccessMode = 'web' | 'computer' | 'api';

export type ConnectorCategory =
  | 'restoration'
  | 'roofing'
  | 'contractor'
  | 'estimating'
  | 'carriers'
  | 'custom';

export type ConnectorContractorType =
  | 'restoration'
  | 'roofing'
  | 'general_contractor'
  | 'other'
  | 'all';

export type EstimatorProviderKey = 'docusketch' | 'dash' | 'xactimate';

export interface ConnectorTaskTemplate {
  id: string;
  label: string;
  kind: 'pull' | 'push';
  /** Instruction the browser or desktop agent should follow. */
  instruction: string;
}

export interface ConnectorDefinition {
  key: string;
  name: string;
  blurb: string;
  category: ConnectorCategory;
  /** Preferred modes first. The UI offers the first as the default. */
  accessModes: ConnectorAccessMode[];
  /** Which contractor types this app is most relevant for. */
  contractorTypes: ConnectorContractorType[];
  siteUrl?: string;
  loginUrl?: string;
  estimatorProvider?: EstimatorProviderKey;
  /** Hint for Computer Use: what desktop app / window to open. */
  computerAppHint?: string;
  taskTemplates: ConnectorTaskTemplate[];
}

export const CONNECTOR_CATEGORY_LABELS: Record<ConnectorCategory, string> = {
  restoration: 'Restoration',
  roofing: 'Roofing',
  contractor: 'Contractors',
  estimating: 'Estimating',
  carriers: 'Carriers & portals',
  custom: 'Custom',
};

export const CONNECTOR_ACCESS_MODE_LABELS: Record<ConnectorAccessMode, string> = {
  web: 'Web access',
  computer: 'Computer use',
  api: 'API',
};

const CATALOG: ConnectorDefinition[] = [
  /* ---- Estimating ------------------------------------------------------ */
  {
    key: 'xactimate',
    name: 'Xactimate',
    blurb: 'Build and push estimates for claims — API when available, otherwise the desktop or web app.',
    category: 'estimating',
    accessModes: ['api', 'computer', 'web'],
    contractorTypes: ['restoration', 'roofing', 'general_contractor', 'all'],
    siteUrl: 'https://www.xactimate.com',
    loginUrl: 'https://www.xactimate.com',
    estimatorProvider: 'xactimate',
    computerAppHint: 'Xactimate desktop',
    taskTemplates: [
      {
        id: 'open-project',
        label: 'Open a project by claim number',
        kind: 'pull',
        instruction:
          'Open Xactimate, sign in if needed, find the project for the claim number in the instruction context, and summarize the estimate totals and line-item count.',
      },
      {
        id: 'export-summary',
        label: 'Export estimate summary',
        kind: 'pull',
        instruction:
          'Open the current Xactimate estimate and pull a summary of rooms, line items, and grand total.',
      },
    ],
  },
  {
    key: 'docusketch',
    name: 'DocuSketch',
    blurb: 'Pull scans, photos, and room measurements into Atmosphere estimating.',
    category: 'estimating',
    accessModes: ['api', 'web'],
    contractorTypes: ['restoration', 'general_contractor', 'all'],
    siteUrl: 'https://app.docusketch.com',
    loginUrl: 'https://app.docusketch.com',
    estimatorProvider: 'docusketch',
    taskTemplates: [
      {
        id: 'list-projects',
        label: 'List recent scan projects',
        kind: 'pull',
        instruction: 'Sign in to DocuSketch and list the most recent scan projects with address and capture date.',
      },
    ],
  },
  {
    key: 'dash',
    name: 'Dash',
    blurb: 'Match Atmosphere jobs to Dash CRM records for construction estimating.',
    category: 'estimating',
    accessModes: ['api', 'web'],
    contractorTypes: ['restoration', 'general_contractor', 'all'],
    siteUrl: 'https://www.dashsoftware.com',
    estimatorProvider: 'dash',
    taskTemplates: [
      {
        id: 'find-job',
        label: 'Find a job by claim number',
        kind: 'pull',
        instruction: 'Sign in to Dash and find the job matching the claim number or insured name provided.',
      },
    ],
  },
  {
    key: 'symbility',
    name: 'Symbility (CoreLogic)',
    blurb: 'Carrier estimating portal — pull assignments and upload scopes via the browser agent.',
    category: 'estimating',
    accessModes: ['web', 'computer'],
    contractorTypes: ['restoration', 'roofing', 'all'],
    siteUrl: 'https://www.symbility.net',
    computerAppHint: 'Symbility / CoreLogic',
    taskTemplates: [
      {
        id: 'list-assignments',
        label: 'List open assignments',
        kind: 'pull',
        instruction: 'Sign in to Symbility and list open assignments with claim number, insured, and due date.',
      },
      {
        id: 'upload-estimate',
        label: 'Upload an estimate file',
        kind: 'push',
        instruction: 'Sign in to Symbility, open the assignment for the claim provided, and upload the estimate file described in the data payload.',
      },
    ],
  },
  {
    key: 'encircle',
    name: 'Encircle',
    blurb: 'Field documentation, photos, and claim packages for restoration crews.',
    category: 'restoration',
    accessModes: ['web', 'computer'],
    contractorTypes: ['restoration', 'all'],
    siteUrl: 'https://encircleapp.com',
    computerAppHint: 'Encircle',
    taskTemplates: [
      {
        id: 'pull-claim-package',
        label: 'Pull claim package summary',
        kind: 'pull',
        instruction: 'Sign in to Encircle, open the property/claim provided, and summarize photos, rooms, and notes ready for estimating.',
      },
    ],
  },

  /* ---- Restoration ops ------------------------------------------------- */
  {
    key: 'servicetitan',
    name: 'ServiceTitan',
    blurb: 'Jobs, schedules, and invoicing for restoration and trade contractors.',
    category: 'contractor',
    accessModes: ['web', 'computer'],
    contractorTypes: ['restoration', 'general_contractor', 'other', 'all'],
    siteUrl: 'https://go.servicetitan.com',
    loginUrl: 'https://go.servicetitan.com',
    computerAppHint: 'ServiceTitan',
    taskTemplates: [
      {
        id: 'list-jobs-today',
        label: "List today's jobs",
        kind: 'pull',
        instruction:
          "Sign in to ServiceTitan and list today's scheduled jobs with customer, address, technician, and status.",
      },
      {
        id: 'create-job-note',
        label: 'Add a job note',
        kind: 'push',
        instruction: 'Sign in to ServiceTitan, open the job described in the data payload, and add the note provided.',
      },
    ],
  },
  {
    key: 'jobber',
    name: 'Jobber',
    blurb: 'Scheduling, quoting, and client communication for small contractor teams.',
    category: 'contractor',
    accessModes: ['web'],
    contractorTypes: ['restoration', 'roofing', 'general_contractor', 'other', 'all'],
    siteUrl: 'https://secure.getjobber.com',
    loginUrl: 'https://secure.getjobber.com',
    taskTemplates: [
      {
        id: 'list-visits',
        label: 'List upcoming visits',
        kind: 'pull',
        instruction: 'Sign in to Jobber and list upcoming visits for the next 7 days with client and address.',
      },
      {
        id: 'create-request',
        label: 'Create a request',
        kind: 'push',
        instruction: 'Sign in to Jobber and create a new request using the client and details in the data payload.',
      },
    ],
  },
  {
    key: 'housecall-pro',
    name: 'Housecall Pro',
    blurb: 'Dispatch, estimates, and payments for home-service contractors.',
    category: 'contractor',
    accessModes: ['web', 'computer'],
    contractorTypes: ['restoration', 'roofing', 'general_contractor', 'other', 'all'],
    siteUrl: 'https://pro.housecallpro.com',
    loginUrl: 'https://pro.housecallpro.com',
    computerAppHint: 'Housecall Pro',
    taskTemplates: [
      {
        id: 'list-jobs',
        label: 'List open jobs',
        kind: 'pull',
        instruction: 'Sign in to Housecall Pro and list open jobs with customer, schedule, and status.',
      },
    ],
  },
  {
    key: 'buildertrend',
    name: 'Buildertrend',
    blurb: 'Project management, schedules, and selections for general contractors.',
    category: 'contractor',
    accessModes: ['web'],
    contractorTypes: ['general_contractor', 'other'],
    siteUrl: 'https://buildertrend.net',
    loginUrl: 'https://buildertrend.net',
    taskTemplates: [
      {
        id: 'list-projects',
        label: 'List active projects',
        kind: 'pull',
        instruction: 'Sign in to Buildertrend and list active projects with address and next schedule milestone.',
      },
    ],
  },

  /* ---- Roofing --------------------------------------------------------- */
  {
    key: 'acculynx',
    name: 'AccuLynx',
    blurb: 'Roofing CRM — production boards, insurance jobs, and material orders.',
    category: 'roofing',
    accessModes: ['web', 'computer'],
    contractorTypes: ['roofing', 'all'],
    siteUrl: 'https://my.acculynx.com',
    loginUrl: 'https://my.acculynx.com',
    computerAppHint: 'AccuLynx',
    taskTemplates: [
      {
        id: 'list-insurance-jobs',
        label: 'List insurance jobs',
        kind: 'pull',
        instruction: 'Sign in to AccuLynx and list open insurance jobs with claim number, insured, and production status.',
      },
      {
        id: 'update-status',
        label: 'Update job status',
        kind: 'push',
        instruction: 'Sign in to AccuLynx, open the job in the data payload, and move it to the status described.',
      },
    ],
  },
  {
    key: 'roofr',
    name: 'Roofr',
    blurb: 'Roof measurements, proposals, and material orders from aerial imagery.',
    category: 'roofing',
    accessModes: ['web'],
    contractorTypes: ['roofing', 'all'],
    siteUrl: 'https://app.roofr.com',
    loginUrl: 'https://app.roofr.com',
    taskTemplates: [
      {
        id: 'list-proposals',
        label: 'List recent proposals',
        kind: 'pull',
        instruction: 'Sign in to Roofr and list recent proposals with address, status, and total.',
      },
    ],
  },
  {
    key: 'jobnimbus',
    name: 'JobNimbus',
    blurb: 'Roofing and restoration CRM with insurance claim tracking.',
    category: 'roofing',
    accessModes: ['web'],
    contractorTypes: ['roofing', 'restoration', 'all'],
    siteUrl: 'https://app.jobnimbus.com',
    loginUrl: 'https://app.jobnimbus.com',
    taskTemplates: [
      {
        id: 'list-claims',
        label: 'List open claims',
        kind: 'pull',
        instruction: 'Sign in to JobNimbus and list open claims with insured name, carrier, and status.',
      },
    ],
  },
  {
    key: 'eagleview',
    name: 'EagleView',
    blurb: 'Order and download roof measurement reports.',
    category: 'roofing',
    accessModes: ['web'],
    contractorTypes: ['roofing', 'all'],
    siteUrl: 'https://www.eagleview.com',
    taskTemplates: [
      {
        id: 'list-reports',
        label: 'List recent reports',
        kind: 'pull',
        instruction: 'Sign in to EagleView and list recent measurement reports with address and status.',
      },
    ],
  },
  {
    key: 'hover',
    name: 'Hover',
    blurb: 'Property measurements and 3D models for exterior estimating.',
    category: 'roofing',
    accessModes: ['web'],
    contractorTypes: ['roofing', 'general_contractor', 'all'],
    siteUrl: 'https://hover.to',
    loginUrl: 'https://hover.to',
    taskTemplates: [
      {
        id: 'list-jobs',
        label: 'List recent Hover jobs',
        kind: 'pull',
        instruction: 'Sign in to Hover and list recent jobs with address and measurement status.',
      },
    ],
  },

  /* ---- Carriers & program portals -------------------------------------- */
  {
    key: 'contractor-connection',
    name: 'Contractor Connection',
    blurb: 'Program portal for carrier-assigned mitigation and rebuild work.',
    category: 'carriers',
    accessModes: ['web'],
    contractorTypes: ['restoration', 'roofing', 'all'],
    siteUrl: 'https://www.contractorconnection.com',
    taskTemplates: [
      {
        id: 'list-assignments',
        label: 'List new assignments',
        kind: 'pull',
        instruction: 'Sign in to Contractor Connection and list new or open assignments with claim number, insured, and due date.',
      },
      {
        id: 'update-status',
        label: 'Update assignment status',
        kind: 'push',
        instruction: 'Sign in to Contractor Connection, open the assignment in the data payload, and update status/notes as described.',
      },
    ],
  },
  {
    key: 'alacrity',
    name: 'Alacrity',
    blurb: 'Carrier network portal for restoration program jobs.',
    category: 'carriers',
    accessModes: ['web'],
    contractorTypes: ['restoration', 'all'],
    siteUrl: 'https://www.alacritysolutions.com',
    taskTemplates: [
      {
        id: 'list-jobs',
        label: 'List open network jobs',
        kind: 'pull',
        instruction: 'Sign in to the Alacrity contractor portal and list open jobs with claim number and status.',
      },
    ],
  },
  {
    key: 'custom-web',
    name: 'Any website',
    blurb: 'Connect any carrier portal, supplier site, or internal tool the browser agent can sign into.',
    category: 'custom',
    accessModes: ['web'],
    contractorTypes: ['all'],
    taskTemplates: [
      {
        id: 'pull-generic',
        label: 'Pull information',
        kind: 'pull',
        instruction: 'Sign in to the connected site and complete the pull task described by the user.',
      },
      {
        id: 'push-generic',
        label: 'Enter data',
        kind: 'push',
        instruction: 'Sign in to the connected site and enter the data provided according to the user instruction.',
      },
    ],
  },
  {
    key: 'custom-computer',
    name: 'Any desktop app',
    blurb: 'Pair a computer and let the desktop agent operate any installed app — Xactimate, Excel, legacy portals, and more.',
    category: 'custom',
    accessModes: ['computer'],
    contractorTypes: ['all'],
    computerAppHint: 'the application described in the instruction',
    taskTemplates: [
      {
        id: 'operate-app',
        label: 'Operate an application',
        kind: 'pull',
        instruction: 'On the paired computer, open the application described and complete the task in the user instruction. Prefer keyboard and mouse actions the user can audit.',
      },
    ],
  },
];

/** Every catalog entry, stable order for the UI. */
export function listConnectorCatalog(): ConnectorDefinition[] {
  return CATALOG.slice();
}

export function getConnectorDefinition(key: string): ConnectorDefinition | undefined {
  return CATALOG.find((entry) => entry.key === key);
}

/** Categories in display order for connector tabs. */
export const CONNECTOR_CATEGORY_ORDER: ConnectorCategory[] = [
  'restoration',
  'roofing',
  'contractor',
  'estimating',
  'carriers',
  'custom',
];

/**
 * Prefer apps that match the org's contractor type, but always include
 * `all`-tagged and custom entries so the catalog never feels empty.
 */
export function filterCatalogForContractorType(
  contractorType: string | null | undefined,
): ConnectorDefinition[] {
  if (!contractorType) return CATALOG.slice();
  return CATALOG.filter(
    (entry) =>
      entry.contractorTypes.includes('all') ||
      entry.contractorTypes.includes(contractorType as ConnectorContractorType),
  );
}
