import type { AuthMethod } from './types';

/**
 * How Atmosphere actually signs in to each connected system.
 *
 * This is the honest version, not a marketing matrix. Three things vary enormously
 * across the restoration stack and all three change what the customer has to do:
 *
 *   1. Whether there is a public API at all. Gmail, Outlook, QuickBooks, and
 *      CompanyCam have self-serve developer programmes. Xactimate, XactAnalysis,
 *      DASH, and the TPA networks are partner-gated — no amount of code gets you
 *      in without a signed agreement, and pretending otherwise sets a customer up
 *      to be blocked halfway through onboarding.
 *   2. How the credential stays alive. An OAuth refresh token dies when an admin
 *      revokes consent; a desktop agent dies when someone reboots the workstation.
 *   3. Who has to act. Some of these need a Microsoft tenant admin, some need a
 *      person at a carrier network, and some need nothing but the operator.
 *
 * `failureMode` is the field worth reading: it is how each one breaks in practice,
 * which is what support will actually be dealing with.
 */

export type AuthProtocol =
  | 'oauth2_authorization_code'
  | 'oauth2_client_credentials'
  | 'api_key'
  | 'basic_credentials'
  | 'agent_pairing'
  | 'smb_mount'
  | 'partner_provisioned';

export interface CredentialHandling {
  /** What Atmosphere persists, and in what form. */
  stored: string;
  /** How access is kept alive without asking the user again. */
  refresh: string;
  /** How the customer cuts us off, on their side. */
  revocation: string;
}

export interface ConnectionAuthSpec {
  protocol: AuthProtocol;
  /** Where the user authenticates, or what issues the credential. */
  authority: string | null;
  /** Least-privilege permissions requested. Empty when not scope-based. */
  scopes: string[];
  /** What the person setting this up actually does, in order. */
  setupSteps: string[];
  credential: CredentialHandling;
  /** Blockers outside the customer's control. */
  prerequisites: string[];
  /** How this breaks in the real world. */
  failureMode: string;
  /** Public developer documentation, when it exists. */
  docsUrl: string | null;
  /** True when a signed agreement with the vendor gates access. */
  partnerGated: boolean;
}

const OAUTH_CREDENTIAL: CredentialHandling = {
  stored:
    'Refresh token only, sealed with AES-256-GCM under a server-held key. The access token is short-lived and kept in memory.',
  refresh:
    'Exchanged for a new access token automatically before expiry; the refresh token rotates where the provider supports it.',
  revocation:
    'Revoke Atmosphere in the vendor’s own account or admin console — access stops immediately, no action needed here.',
};

const API_KEY_CREDENTIAL: CredentialHandling = {
  stored:
    'The key, sealed with AES-256-GCM. It is never returned to the browser after saving — only a masked suffix is shown.',
  refresh:
    'Keys do not expire on their own; Atmosphere warns when one starts returning 401 so it can be rotated.',
  revocation: 'Delete or roll the key in the vendor’s admin settings.',
};

/**
 * Per-connector specifications.
 *
 * Where a vendor publishes a developer programme, the authority and scopes are
 * the real ones. Where access is partner-gated, that is stated plainly rather
 * than invented.
 */
export const CONNECTION_AUTH: Record<string, ConnectionAuthSpec> = {
  // ── Verisk: partner ecosystem, not self-serve ─────────────────────────────
  xactimate: {
    protocol: 'agent_pairing',
    authority: 'Verisk Partner Ecosystem + local Xactimate installation',
    scopes: [],
    setupSteps: [
      'Verisk approves Atmosphere as an integration partner (one-time, company-level).',
      'Install the Atmosphere sync agent on the workstation that runs Xactimate.',
      'Pair the agent to this organisation with a one-time code from this page.',
      'Choose which local estimate folders and carrier profiles it may read.',
    ],
    credential: {
      stored:
        'A pairing secret unique to that workstation, sealed at rest. No Xactimate password is ever held.',
      refresh: 'The agent holds a long-lived pairing token and re-registers on start-up.',
      revocation: 'Unpair from this page, or uninstall the agent — either kills the link.',
    },
    prerequisites: [
      'An active Xactimate licence on the workstation.',
      'Verisk partner approval before any data can move.',
    ],
    failureMode:
      'The agent stops when that workstation sleeps, reboots, or loses VPN. This is the single most common cause of a stale estimate sync, and it looks like an outage while being nothing of the sort.',
    docsUrl: 'https://www.verisk.com/company/vendor-alliances/',
    partnerGated: true,
  },
  xactanalysis: {
    protocol: 'partner_provisioned',
    authority: 'Verisk XactAnalysis, provisioned per contractor profile',
    scopes: [],
    setupSteps: [
      'Verisk enables the Atmosphere interface on your XactAnalysis contractor profile.',
      'Verisk issues an endpoint and credential pair for your account.',
      'Enter them here; Atmosphere confirms two-way flow with a test assignment.',
    ],
    credential: {
      stored: 'Service credentials issued by Verisk, sealed with AES-256-GCM.',
      refresh: 'Long-lived; rotated on request through Verisk.',
      revocation: 'Ask Verisk to disable the interface on your profile.',
    },
    prerequisites: [
      'An XactAnalysis contractor profile in good standing.',
      'Verisk must enable the interface — it cannot be self-served.',
    ],
    failureMode:
      'Assignments arrive but milestones fail to post back, usually because a carrier programme requires a document type that has not been mapped. It surfaces as a compliance score drop before it surfaces as an error.',
    docsUrl: 'https://www.verisk.com/company/vendor-alliances/',
    partnerGated: true,
  },

  // ── Microsoft ─────────────────────────────────────────────────────────────
  outlook: {
    protocol: 'oauth2_authorization_code',
    authority: 'Microsoft Entra ID (login.microsoftonline.com) → Microsoft Graph',
    scopes: ['Mail.Read', 'Mail.Send', 'MailboxSettings.Read', 'offline_access'],
    setupSteps: [
      'Click Connect; you are sent to Microsoft to sign in.',
      'A Microsoft 365 tenant admin grants consent once for the organisation.',
      'Choose which shared mailboxes Atmosphere may read — typically the ops and billing boxes, not personal mail.',
    ],
    credential: OAUTH_CREDENTIAL,
    prerequisites: [
      'A Microsoft 365 business tenant.',
      'A Global or Exchange admin available for the one-time consent.',
    ],
    failureMode:
      'An admin revoking consent, or a conditional-access policy change, kills the refresh token silently. Atmosphere reports this as “Action needed” rather than an outage, because it needs a person, not a retry.',
    docsUrl: 'https://learn.microsoft.com/graph/auth-v2-user',
    partnerGated: false,
  },
  'microsoft-calendar': {
    protocol: 'oauth2_authorization_code',
    authority: 'Microsoft Entra ID → Microsoft Graph',
    scopes: ['Calendars.ReadWrite', 'offline_access'],
    setupSteps: [
      'Click Connect and sign in with Microsoft.',
      'Admin consent, once, for the organisation.',
      'Pick the crew calendars Atmosphere may schedule against.',
    ],
    credential: OAUTH_CREDENTIAL,
    prerequisites: ['A Microsoft 365 business tenant.'],
    failureMode: 'Same consent-revocation path as Outlook; calendars simply stop updating.',
    docsUrl: 'https://learn.microsoft.com/graph/api/resources/calendar',
    partnerGated: false,
  },
  onedrive: {
    protocol: 'oauth2_authorization_code',
    authority: 'Microsoft Entra ID → Microsoft Graph',
    scopes: ['Files.ReadWrite.All', 'Sites.ReadWrite.All', 'offline_access'],
    setupSteps: [
      'Click Connect and sign in with Microsoft.',
      'Admin consent for the organisation.',
      'Select the document library or team site holding job folders.',
    ],
    credential: OAUTH_CREDENTIAL,
    prerequisites: ['A Microsoft 365 business tenant.'],
    failureMode:
      'Broad file scopes are the ones tenant admins most often refuse. If consent is declined, scope the connection to a single SharePoint site instead.',
    docsUrl: 'https://learn.microsoft.com/graph/api/resources/onedrive',
    partnerGated: false,
  },

  // ── Google ────────────────────────────────────────────────────────────────
  gmail: {
    protocol: 'oauth2_authorization_code',
    authority: 'Google Identity (accounts.google.com) → Gmail API',
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
    ],
    setupSteps: [
      'Click Connect and sign in with the Google account that receives job mail.',
      'For Workspace, an admin can domain-delegate instead of connecting each mailbox.',
      'Confirm which labels or senders Atmosphere may read.',
    ],
    credential: OAUTH_CREDENTIAL,
    prerequisites: [
      'Google Workspace, or a Gmail account with API access.',
      'Gmail scopes are restricted: Google requires an annual CASA security assessment before a production app may use them at scale.',
    ],
    failureMode:
      'Unverified apps are capped at a small number of users and show an interstitial warning. The security review, not the code, is the long pole here.',
    docsUrl: 'https://developers.google.com/gmail/api/auth/scopes',
    partnerGated: false,
  },
  'google-drive': {
    protocol: 'oauth2_authorization_code',
    authority: 'Google Identity → Drive API',
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    setupSteps: [
      'Click Connect and sign in with Google.',
      'Pick the shared drive that holds job folders.',
    ],
    credential: OAUTH_CREDENTIAL,
    prerequisites: ['A Google account or Workspace shared drive.'],
    failureMode:
      'drive.file limits Atmosphere to files it created or was explicitly opened with — deliberate, and it means pre-existing folders must be shared with the connection once.',
    docsUrl: 'https://developers.google.com/drive/api/guides/api-specific-auth',
    partnerGated: false,
  },
  'google-calendar': {
    protocol: 'oauth2_authorization_code',
    authority: 'Google Identity → Calendar API',
    scopes: ['https://www.googleapis.com/auth/calendar.events'],
    setupSteps: ['Click Connect and sign in with Google.', 'Choose the crew calendars to manage.'],
    credential: OAUTH_CREDENTIAL,
    prerequisites: ['A Google account or Workspace calendar.'],
    failureMode: 'Revoking Atmosphere in Google account permissions stops scheduling immediately.',
    docsUrl: 'https://developers.google.com/calendar/api/auth',
    partnerGated: false,
  },

  // ── Accounting ────────────────────────────────────────────────────────────
  'quickbooks-online': {
    protocol: 'oauth2_authorization_code',
    authority: 'Intuit (appcenter.intuit.com) → QuickBooks Online API',
    scopes: ['com.intuit.quickbooks.accounting', 'openid', 'profile', 'email'],
    setupSteps: [
      'Click Connect; Intuit asks which company file to authorise.',
      'Map Atmosphere job numbers to QuickBooks customers and classes.',
      'Confirm which income and expense accounts invoices should post to.',
    ],
    credential: {
      ...OAUTH_CREDENTIAL,
      refresh:
        'Intuit refresh tokens expire after 100 days of disuse and rotate on every exchange, so Atmosphere refreshes on a schedule rather than only on demand.',
    },
    prerequisites: [
      'A QuickBooks Online subscription.',
      'Intuit requires production app review before an app may connect to arbitrary company files.',
    ],
    failureMode:
      'A 100-day gap with no activity expires the refresh token and requires a full reconnect. Scheduled refresh exists specifically to prevent that.',
    docsUrl:
      'https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization',
    partnerGated: false,
  },
  'quickbooks-desktop': {
    protocol: 'agent_pairing',
    authority: 'Local QuickBooks Desktop company file via the Atmosphere sync agent',
    scopes: [],
    setupSteps: [
      'Install the sync agent on the machine hosting the company file.',
      'Open QuickBooks as Admin in single-user mode and approve the application once.',
      'Pair the agent to this organisation with a one-time code.',
    ],
    credential: {
      stored: 'A pairing secret for that machine. QuickBooks itself holds the application grant.',
      refresh: 'Agent re-registers on start-up; the QuickBooks grant persists in the company file.',
      revocation: 'Remove the application in QuickBooks → Integrated Applications, or unpair here.',
    },
    prerequisites: [
      'QuickBooks Desktop installed and reachable on the LAN.',
      'One-time admin approval inside QuickBooks, in single-user mode.',
    ],
    failureMode:
      'The company file being open in single-user mode by someone else blocks the agent entirely. Month-end is when this bites.',
    docsUrl: 'https://developer.intuit.com/app/developer/qbdesktop/docs/get-started',
    partnerGated: false,
  },

  // ── Field documentation ───────────────────────────────────────────────────
  companycam: {
    protocol: 'oauth2_authorization_code',
    authority: 'CompanyCam (app.companycam.com) → CompanyCam API',
    scopes: ['read', 'write'],
    setupSteps: [
      'Click Connect and sign in to CompanyCam.',
      'Approve Atmosphere for the company account.',
      'Map CompanyCam projects to Atmosphere jobs — by address, or by job number in the project name.',
    ],
    credential: OAUTH_CREDENTIAL,
    prerequisites: ['A CompanyCam account with API access enabled.'],
    failureMode:
      'Project-to-job matching is the fragile part, not auth. Projects created without a job number in the name land unmatched and need manual association.',
    docsUrl: 'https://docs.companycam.com/docs/oauth',
    partnerGated: false,
  },
  encircle: {
    protocol: 'oauth2_authorization_code',
    authority: 'Encircle, per organisation',
    scopes: ['claims.read', 'photos.read', 'moisture.read'],
    setupSteps: [
      'Encircle enables API access for your organisation.',
      'Click Connect and authorise Atmosphere.',
      'Match Encircle claims to Atmosphere jobs by claim number.',
    ],
    credential: OAUTH_CREDENTIAL,
    prerequisites: ['Encircle must enable API access on the account — it is not self-serve.'],
    failureMode:
      'Moisture readings sync but photos lag, because large photo sets are fetched in the background and rate-limited.',
    docsUrl: null,
    partnerGated: true,
  },
  docusketch: {
    protocol: 'oauth2_authorization_code',
    authority: 'DocuSketch, per organisation',
    scopes: ['scans.read', 'floorplans.read'],
    setupSteps: [
      'Click Connect and authorise Atmosphere in DocuSketch.',
      'Choose whether floor plans should be pushed on to Xactimate automatically.',
    ],
    credential: OAUTH_CREDENTIAL,
    prerequisites: [
      'A DocuSketch subscription with scanning hardware in the field.',
      'DocuSketch must enable API access for your organisation — it is not self-serve.',
    ],
    failureMode:
      'Scans arrive only once the technician uploads from site; poor connectivity delays them by hours, which reads as a missing scan rather than a slow one.',
    docsUrl: null,
    partnerGated: true,
  },

  // ── Job management ────────────────────────────────────────────────────────
  dash: {
    protocol: 'api_key',
    authority: 'DASH (Cotality, formerly CoreLogic · Next Gear), per tenant',
    scopes: [],
    setupSteps: [
      'Cotality enables API access for your DASH tenant.',
      'Generate a key in DASH administration.',
      'Paste it here and choose which offices and job types to sync.',
    ],
    credential: API_KEY_CREDENTIAL,
    prerequisites: [
      'A DASH subscription.',
      'Cotality must enable API access — keys are not self-serve on every plan.',
    ],
    failureMode:
      'Rate limits during nightly bulk sync. Atmosphere backs off and retries rather than dropping records, so a slow sync is normal and a missing job is not.',
    docsUrl: 'https://www.nextgearsolutions.com/dash-restoration-business-management/',
    partnerGated: true,
  },

  // ── Carrier and TPA networks ──────────────────────────────────────────────
  alacrity: {
    protocol: 'partner_provisioned',
    authority: 'Alacrity Solutions contractor network',
    scopes: [],
    setupSteps: [
      'Request the integration through your Alacrity network manager.',
      'Alacrity issues connection details once approved.',
      'Enter them here to begin receiving assignments.',
    ],
    credential: {
      stored: 'Network-issued service credentials, sealed at rest.',
      refresh: 'Long-lived; rotated through the network on request.',
      revocation: 'Ask the network to disable the interface.',
    },
    prerequisites: [
      'Active membership of the Alacrity network in good standing.',
      'Their approval, on their timescale — expect days, not minutes.',
    ],
    failureMode:
      'Programme rules change without notice and assignments start failing validation. The symptom is rejected milestones, not a connection error.',
    docsUrl: 'https://www.alacritysolutions.com/',
    partnerGated: true,
  },

  // ── On-premise storage ────────────────────────────────────────────────────
  'shared-drive': {
    protocol: 'smb_mount',
    authority: 'Your own file server, reached by the Atmosphere sync agent on the LAN',
    scopes: [],
    setupSteps: [
      'Install the sync agent on a machine that can reach the share.',
      'Create a dedicated service account with read access to the job folders — do not reuse a person’s login.',
      'Give Atmosphere the UNC path, e.g. \\\\LSR-FS01\\Jobs.',
      'Choose the folder naming convention so files land on the right job.',
    ],
    credential: {
      stored:
        'Service-account credentials, sealed with AES-256-GCM, and only ever used by the on-premise agent.',
      refresh: 'None needed; the agent holds a session against the share.',
      revocation: 'Disable the service account in Active Directory, or uninstall the agent.',
    },
    prerequisites: [
      'A machine on the same network as the file server, left powered on.',
      'A service account with read access.',
    ],
    failureMode:
      'The share goes unreachable when the host sleeps, the VPN drops, or someone renames a folder. Nothing is lost — the agent resumes — but documentation looks missing until it does.',
    docsUrl: null,
    partnerGated: false,
  },
};

/** Sensible defaults for catalogue entries without a bespoke specification yet. */
const DEFAULTS: Record<AuthMethod, ConnectionAuthSpec> = {
  oauth: {
    protocol: 'oauth2_authorization_code',
    authority: 'The vendor’s own sign-in page',
    scopes: [],
    setupSteps: [
      'Click Connect; you are sent to the vendor to sign in.',
      'Approve the access Atmosphere asks for.',
      'Map the vendor’s records to Atmosphere jobs.',
    ],
    credential: OAUTH_CREDENTIAL,
    prerequisites: ['An account with the vendor, on a plan that includes API access.'],
    failureMode: 'Consent revoked at the vendor, or a plan downgrade that removes API access.',
    docsUrl: null,
    partnerGated: false,
  },
  api_key: {
    protocol: 'api_key',
    authority: 'A key generated in the vendor’s admin settings',
    scopes: [],
    setupSteps: [
      'Generate an API key in the vendor’s admin settings.',
      'Scope it to the minimum the integration needs.',
      'Paste it here — it is sealed immediately and never shown again.',
    ],
    credential: API_KEY_CREDENTIAL,
    prerequisites: ['A plan that includes API access.'],
    failureMode: 'A rolled or expired key fails every call at once, which is at least unambiguous.',
    docsUrl: null,
    partnerGated: false,
  },
  credentials: {
    protocol: 'basic_credentials',
    authority: 'The vendor’s portal, signed in as a dedicated service user',
    scopes: [],
    setupSteps: [
      'Create a dedicated service user in the portal — not a person’s login.',
      'Give it only the permissions the integration needs.',
      'Enter the credentials here; they are sealed at rest.',
    ],
    credential: {
      stored:
        'Portal credentials, sealed with AES-256-GCM, decrypted only in memory for a request.',
      refresh: 'None; the session is re-established as needed.',
      revocation: 'Disable the service user in the portal.',
    },
    prerequisites: ['A portal account that permits a second, non-human user.'],
    failureMode:
      'A forced password rotation, or MFA enabled on the service user, breaks the connection with no warning. This is why a dedicated account matters.',
    docsUrl: null,
    partnerGated: false,
  },
  desktop_agent: {
    protocol: 'agent_pairing',
    authority: 'The Atmosphere sync agent on the machine hosting the software',
    scopes: [],
    setupSteps: [
      'Install the sync agent on the host machine.',
      'Pair it to this organisation with a one-time code.',
      'Choose what it may read.',
    ],
    credential: {
      stored: 'A pairing secret unique to that machine, sealed at rest.',
      refresh: 'The agent re-registers on start-up.',
      revocation: 'Unpair here, or uninstall the agent.',
    },
    prerequisites: ['A machine that stays powered on and reachable.'],
    failureMode: 'Sleep, reboot, or a dropped VPN stops the agent. It resumes on its own.',
    docsUrl: null,
    partnerGated: false,
  },
  file_share: {
    protocol: 'smb_mount',
    authority: 'Your file server, via the on-premise agent',
    scopes: [],
    setupSteps: [
      'Install the sync agent on the LAN.',
      'Create a read-only service account.',
      'Provide the UNC path.',
    ],
    credential: {
      stored: 'Service-account credentials, sealed at rest, used only by the on-premise agent.',
      refresh: 'None needed.',
      revocation: 'Disable the service account.',
    },
    prerequisites: ['A machine on the same network, left powered on.'],
    failureMode: 'The share goes unreachable; the agent resumes when it returns.',
    docsUrl: null,
    partnerGated: false,
  },
  partner_request: {
    protocol: 'partner_provisioned',
    authority: 'The network, once they approve the connection',
    scopes: [],
    setupSteps: [
      'Request the integration through your network manager.',
      'They approve and issue connection details.',
      'Enter them here.',
    ],
    credential: {
      stored: 'Network-issued credentials, sealed at rest.',
      refresh: 'Long-lived; rotated through the network.',
      revocation: 'Ask the network to disable the interface.',
    },
    prerequisites: ['Membership in good standing, and their approval on their timescale.'],
    failureMode: 'Programme rule changes cause validation failures rather than connection errors.',
    docsUrl: null,
    partnerGated: true,
  },
};

/** The specification for a connector, falling back to the shape of its auth method. */
export function authSpecFor(id: string, method: AuthMethod): ConnectionAuthSpec {
  return CONNECTION_AUTH[id] ?? DEFAULTS[method];
}

export const PROTOCOL_LABELS: Record<AuthProtocol, string> = {
  oauth2_authorization_code: 'OAuth 2.0 · authorization code with PKCE',
  oauth2_client_credentials: 'OAuth 2.0 · client credentials',
  api_key: 'API key',
  basic_credentials: 'Service-account credentials',
  agent_pairing: 'Paired on-premise agent',
  smb_mount: 'On-premise agent over SMB',
  partner_provisioned: 'Provisioned by the vendor',
};
