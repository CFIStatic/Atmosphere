/**
 * Thin API client for the Atmosphere backend.
 *
 * In development, requests go to a relative `/api/...` path which Vite proxies
 * to the backend (same-origin, so cookies work seamlessly). In production set
 * `VITE_API_BASE_URL` if the backend is served from a different origin.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export interface AuthUser {
  id: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
  metadata: Record<string, unknown>;
}

export type MemberRole =
  'project_manager' | 'field_technician' | 'accountant' | 'office_manager' | 'sales';

export type WorkType = 'mitigation' | 'construction';

export type ContractorType =
  | 'restoration'
  | 'roofing'
  | 'general_contractor'
  | 'other';

export type UsageIntent =
  | 'mitigation_estimating'
  | 'construction_estimating'
  | 'project_management'
  | 'crm'
  | 'web_access'
  | 'field_work'
  | 'billing'
  | 'financial'
  | 'exploring';

export interface Org {
  id: string;
  name: string;
  joinCode: string;
  createdAt?: string;
  contractorType?: ContractorType | null;
}

export interface Membership {
  role: MemberRole;
  workType: WorkType;
  usageIntents: UsageIntent[];
  status: string;
  org: Org | null;
}

export interface Profile {
  id: string | null;
  email: string | null;
  fullName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface OrgMember {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: MemberRole;
  workType: WorkType;
  usageIntents: UsageIntent[];
  status: string;
}

/* ---- CRM (customers) -------------------------------------------------- */

/** The CRM's generic list envelope. */
export interface CrmList<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** Camelized crm_accounts row — only the columns the UI reads are typed. */
export interface CrmAccount {
  id: string;
  name: string;
  kind?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  region?: string | null;
  createdAt?: string;
}

/** The stages a lead moves through, in pipeline order. */
export const LEAD_STAGES = ['new', 'contacted', 'qualified', 'estimate_sent', 'won', 'lost'] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  estimate_sent: 'Estimate sent',
  won: 'Won',
  lost: 'Lost',
};

export const LEAD_SOURCES = [
  'referral', 'insurance_carrier', 'web', 'phone', 'repeat_customer', 'marketing', 'other',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const ACCOUNT_TYPES = [
  'insurance_carrier', 'property_management', 'general_contractor',
  'referral_partner', 'vendor', 'other',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const CONTACT_TYPES = [
  'homeowner', 'tenant', 'adjuster', 'agent', 'property_manager', 'vendor', 'other',
] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export const ACTIVITY_KINDS = ['note', 'call', 'email', 'sms', 'meeting'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** snake_case → words, for enum values shown in the UI. */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  const s = value.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Camelized crm_leads row. */
export interface CrmLead {
  id: string;
  title: string;
  status: LeadStage;
  source?: LeadSource | null;
  workType?: WorkType | null;
  lossType?: LossType | null;
  estimatedValue?: number | null;
  description?: string | null;
  lostReason?: string | null;
  contactId?: string | null;
  accountId?: string | null;
  convertedJobId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CrmLeadInput {
  title: string;
  source?: LeadSource;
  workType?: WorkType | null;
  lossType?: LossType | null;
  estimatedValue?: number | null;
  description?: string | null;
  accountId?: string | null;
  contactId?: string | null;
  status?: LeadStage;
  lostReason?: string | null;
}

/** One logged touch — a call, an email, a note — against a lead or account. */
export interface CrmActivity {
  id: string;
  kind: ActivityKind;
  subject?: string | null;
  body?: string | null;
  leadId?: string | null;
  accountId?: string | null;
  contactId?: string | null;
  jobId?: string | null;
  occurredAt?: string | null;
  createdAt?: string;
  profiles?: { email: string | null; fullName: string | null } | null;
}

export interface CrmActivityInput {
  kind: ActivityKind;
  subject?: string;
  body?: string;
  leadId?: string;
  accountId?: string;
  contactId?: string;
  jobId?: string;
}

/* ---- Prospecting -------------------------------------------------------- */

/** A person a search turned up. Never carries contact details. */
export interface ProspectMatch {
  providerPersonId: string;
  fullName: string;
  title: string | null;
  companyName: string | null;
  companyDomain: string | null;
  location: string | null;
  linkedinUrl: string | null;
  confidence: number | null;
  hasEmail: boolean;
  hasPhone: boolean;
  /** Already a contact in the CRM — revealing would buy back our own data. */
  knownContactId: string | null;
  /** Already saved as a prospect. */
  prospectId: string | null;
  revealed: boolean;
  suppressed: boolean;
}

/** One number, labelled. `valid: null` means unchecked, never "does not work". */
export interface LabelledPhone {
  number: string;
  /** work = a published or desk line · mobile = a work cell · personal = private */
  kind: 'work' | 'mobile' | 'personal' | 'unknown';
  lineType: 'landline' | 'mobile' | 'voip' | 'tollfree' | 'other' | null;
  carrier: string | null;
  valid: boolean | null;
  verifier: string | null;
  source: string;
}

/** A saved prospect. Contact columns are null until a reveal is paid for. */
export interface Prospect {
  id: string;
  fullName: string;
  title: string | null;
  companyName: string | null;
  companyDomain: string | null;
  location: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  provider: string;
  providerPersonId: string | null;
  confidence: number | null;
  status: 'new' | 'saved' | 'contacted' | 'converted' | 'discarded';
  revealedAt: string | null;
  revealCostNanos: number;
  /** Every number, labelled. The flat phone/mobile fields are the summary. */
  phones?: LabelledPhone[];
  contactId: string | null;
  leadId: string | null;
  createdAt?: string;
}

/** What verification concluded about an address. */
export interface EmailVerification {
  verdict: 'valid' | 'risky' | 'invalid' | 'unknown';
  score: number;
  reason: string;
  /** The domain accepts everything, so no address can be confirmed. */
  catchAll: boolean;
  /** Which service confirmed it, or null when nothing did. */
  verifier?: string | null;
}

export interface ProspectingStatus {
  provider: string;
  /** True when the people are invented. The UI must say so. */
  sandbox: boolean;
  revealPriceNanos: number;
  /**
   * Which service confirms a mailbox exists — 'ZeroBounce', 'SMTP', … — or
   * null when nothing does. The UI must not say "verified" when this is null.
   */
  verifier?: string | null;
  /** True when the deployment sells addresses nothing could confirm. */
  sellUnverified?: boolean;
  /** Every contact-data vendor in the waterfall, in the order asked. */
  sources?: string[];
}

/** What each stage of the pipeline actually did, for one test lookup. */
export interface Diagnosis {
  fullName: string;
  companyDomain: string;
  nameUsable: boolean;
  stages: Array<{
    name: string;
    evidenceFound: number;
    directHit: boolean;
    ms: number;
    note?: string;
  }>;
  evidenceTotal: number;
  inferredPattern: string | null;
  patternSupport: number;
  patternConfidence: number | null;
  candidates: Array<{ masked: string; verdict: string; reason: string; verifier: string | null }>;
  wouldReturn: string | null;
  wouldReturnSource: string | null;
  mailboxVerifier: string | null;
  phoneVerifier: string | null;
  sellUnverified: boolean;
  summary: string;
}

/* ---- Connected CRMs ------------------------------------------------------ */

export interface KnownCrm {
  id: string;
  name: string;
  /** oauth = authorise, never a password · browser = signs in as you · rest = an API */
  method: 'oauth' | 'browser' | 'rest';
  note: string;
}

export interface CrmConnections {
  available: KnownCrm[];
  connected: Array<{ system: string; accountLabel: string | null; connectedAt: string }>;
  salesforceConfigured: boolean;
  browserCrmEnabled: boolean;
  vaultConfigured: boolean;
}

/* ---- Live crew positions -------------------------------------------------- */

export interface CrewPosition {
  userId: string;
  name: string;
  lat: number;
  lon: number;
  /** Metres. A large number means the dot is a guess — say so rather than draw it. */
  accuracyM: number | null;
  headingDeg: number | null;
  speedMps: number | null;
  capturedAt: string;
  nearestPlace: { name: string; miles: number } | null;
  territory: { id: string; name: string } | null;
}

/* ---- Sending ------------------------------------------------------------- */

export interface MailProvider {
  id: 'google_mail' | 'microsoft_mail';
  name: string;
  available: boolean;
  note: string;
}

export interface SendPolicy {
  postalAddress: string | null;
  replyTo: string | null;
  maxRecipients: number;
  dailyCeiling: number;
}

export interface MailStatus {
  providers: MailProvider[];
  connected: Array<{ system: string; accountLabel: string | null; connectedAt: string }>;
  policy: SendPolicy | null;
  sentToday: number;
  vaultConfigured: boolean;
}

export interface SendPreview {
  dryRun: boolean;
  wouldSend?: number;
  sent?: number;
  blocked: Array<{ email: string; reason: string }>;
  warnings?: string[];
  failures?: Array<{ email: string; error: string }>;
  from: string | null;
  sample?: string;
}

export interface ForecastPeriod {
  name: string;
  startTime: string;
  isDaytime: boolean;
  temperature: number | null;
  temperatureUnit: string;
  windSpeed: string | null;
  precipitationChance: number | null;
  shortForecast: string;
  detailedForecast: string | null;
  /** True when the wording describes weather that makes restoration work. */
  notable: boolean;
  group: string | null;
}

export interface Forecast {
  place: string | null;
  periods: ForecastPeriod[];
  provider: string;
  attribution: string;
}

/* ---- Profiler ------------------------------------------------------------ */

export interface ProfileFact {
  label: string;
  value: string;
  /** Where this came from. A fact without a source is not published. */
  sourceUrl: string;
  sourceKind: 'company_site' | 'crm';
}

export interface ProspectProfile {
  fullName: string;
  companyDomain: string;
  companySummary: string | null;
  companySummarySource: string | null;
  facts: ProfileFact[];
  signals: Array<{ headline: string; sourceUrl: string }>;
  /** Derived from the above, and labelled as derived. Never shown as fact. */
  talkingPoints: string[];
  sourcesChecked: Array<{ url: string; ok: boolean; ms: number; skipped?: string }>;
  /** Categories found and deliberately dropped. */
  withheld: string[];
  /** Categories never looked for at all. */
  excluded: string[];
}

/* ---- Campaigns & territories --------------------------------------------- */

export interface Territory {
  id: string;
  name: string;
  description: string | null;
  ownerId: string | null;
  /** How a territory is actually drawn. Everything else is supplementary. */
  postalCodes: string[];
  cities: string[];
  counties: string[];
  /** Two letters. Usually derived from the ZIPs; explicit when there are none. */
  state?: string | null;
  active: boolean;
  createdAt: string;
}

/** One ZIP code, placed. Absent from the list when it has not been geocoded yet. */
export interface TerritoryPoint {
  zip: string;
  lat: number;
  lon: number;
  place: string | null;
}

export interface TerritoryMapEntry {
  id: string;
  name: string;
  /**
   * States this territory has codes in. A state being listed is not a claim to
   * cover it — `points` is where the territory actually is.
   */
  states: string[];
  zipsTotal: number;
  points: TerritoryPoint[];
}

export interface TerritoryMapResponse {
  /** How many of the org's ZIPs have a position yet, across all territories. */
  located: number;
  total: number;
  territories: TerritoryMapEntry[];
}

/* ---- What the company is doing on the work you sold ---------------------- */

export type WorkTone = 'progress' | 'money' | 'crew' | 'attention' | 'other';

export interface SalesWorkJob {
  id: string;
  /** Set when Operations has a project delivering this job. */
  projectId?: string | null;
  projectNumber?: string | null;
  phase?: string | null;
  phaseLabel?: string | null;
  phaseProgress?: number | null;
  deliveryMatchedBy?: 'linked' | 'claim-number' | null;
  customerEmail?: string | null;
  jobNumber: number | null;
  title: string;
  /** Account name, or the contact's if the job has no account. */
  customer: string | null;
  status: string;
  statusLabel: string;
  /** Still being delivered, as opposed to closed out. */
  open: boolean;
  scheduledStart: string | null;
  contractAmount: number | null;
  invoicedAmount: number | null;
  lastEventAt: string | null;
  lastEventText: string | null;
  daysQuiet: number | null;
  /** An open job that has gone longer than its status allows without news. */
  quiet: boolean;
}

export interface SalesWorkEvent {
  id: string;
  seq: number;
  jobId: string | null;
  jobNumber: number | null;
  jobTitle: string | null;
  customer: string | null;
  text: string;
  tone: WorkTone;
  by: string | null;
  at: string;
}

export interface SalesWorkResponse {
  scope: 'mine' | 'all';
  jobs: SalesWorkJob[];
  /** How many of these jobs have Operations behind them. */
  deliveryLinked?: number;
  latest: SalesWorkEvent[];
  counts: { open: number; onSite: number; quiet: number; awaitingPayment: number };
}

/** Which platform recorded a line, so the feed can say where it came from. */
export type WorkSource = 'sales' | 'operations' | 'field';

export interface DryingArea {
  label: string;
  latestPct: number | null;
  goalPct: number | null;
  readingAt: string | null;
}

/** The Operations and Field half of a job, when the two have been paired. */
export interface JobDelivery {
  projectId: string;
  projectNumber: string | null;
  phase: string | null;
  phaseLabel: string;
  phaseProgress: number | null;
  /** 'linked' is explicit; 'claim-number' was inferred from a shared claim. */
  matchedBy: 'linked' | 'claim-number';
  targetCompletion: string | null;
  customerEmail: string | null;
  adjusterEmail: string | null;
  drying: DryingArea[];
  headline: string;
}

export interface SalesWorkDetail {
  job: SalesWorkJob & {
    workType: string | null;
    scheduledEnd: string | null;
    actualStart: string | null;
    actualEnd: string | null;
    paidAmount: number | null;
  };
  delivery: JobDelivery | null;
  /** Composed from what is recorded. Nothing sends until somebody presses send. */
  suggestedUpdate: { subject: string; body: string };
  recipients: Array<{ label: string; email: string }>;
  sends: Array<{
    id: string;
    email: string;
    subject: string | null;
    state: string;
    blockedReason: string | null;
    at: string;
  }>;
  crew: Array<{ userId: string; name: string; role: string; since: string }>;
  timeline: Array<{
    id: string;
    text: string;
    tone: WorkTone;
    source: WorkSource;
    by: string | null;
    at: string;
  }>;
}

/* ---- Who the platform is reaching out to -------------------------------- */

export interface OutreachPerson {
  email: string;
  messages: number;
  delivered: number;
  bounced: number;
  blocked: number;
  campaignMessages: number;
  updateMessages: number;
  lastAt: string;
  unsubscribed: boolean;
  suppressed: boolean;
}

export interface OutreachResponse {
  people: OutreachPerson[];
  totals: { people: number; messages: number; bounced: number; optedOut: number };
}

export interface OutreachHistory {
  email: string;
  messages: Array<{
    id: string;
    kind: 'campaign' | 'job_update';
    subject: string | null;
    state: string;
    blockedReason: string | null;
    error: string | null;
    /** The campaign name or the job it was about. */
    about: string | null;
    at: string;
  }>;
}

/* ---- The shared job record ----------------------------------------------- */

export type ScopeState = 'included' | 'excluded' | 'proposed' | 'approved' | 'declined';

export interface JobParty {
  id: string;
  company: string;
  trade: string | null;
  contactName: string | null;
  contact_name?: string | null;
  email: string | null;
  phone: string | null;
  role: 'general_contractor' | 'subcontractor' | 'owner' | 'adjuster';
  invited_at: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
  /** Which revision of the facts they last accepted. Null means never. */
  acknowledgedRevision: number | null;
  /** Accepted the current facts, with nothing of theirs outstanding. */
  clear: boolean;
  because: string;
  accessToken?: string;
}

export interface JobScopeItem {
  id: string;
  party_id: string | null;
  state: ScopeState;
  title: string;
  detail: string | null;
  amount: number | null;
  reason: string | null;
  revision: number;
  decided_at: string | null;
  created_at: string;
}

export interface JobRisk {
  key: string;
  level: 'blocker' | 'warn' | 'note';
  title: string;
  action: string;
  partyId?: string | null;
  scopeItemId?: string | null;
}

export interface SharedJobSummary {
  jobId: string;
  jobNumber: number | null;
  title: string;
  status: string | null;
  parties: number;
  currentRevision: number | null;
  /** Parties not working from the current revision. */
  behind: number;
  awaiting: number;
  exclusions: number;
}

export interface SharedJobRecord {
  job: { id: string; jobNumber: number | null; title: string; status: string | null; claimNumber: string | null };
  brief: { id: string; revision: number; facts: Record<string, string>; note: string | null; createdAt?: string; created_at?: string } | null;
  revisions: Array<{ revision: number; note: string | null; createdAt: string }>;
  currentRevision: number | null;
  parties: JobParty[];
  scope: JobScopeItem[];
  money: { approved: number; pending: number; unpricedApprovals: number };
  messages: Array<{
    id: string;
    party_id: string | null;
    author_label: string;
    body: string;
    scope_item_id: string | null;
    is_decision: boolean;
    created_at: string;
  }>;
  risks: JobRisk[];
}

/* ---- Proof of work ------------------------------------------------------- */

export type ProofCheckVerdict = 'pass' | 'fail' | 'unknown';

export interface ProofCheck {
  key: string;
  verdict: ProofCheckVerdict;
  detail: string;
}

export interface ProofDay {
  partyId: string;
  company: string;
  workDate: string;
  hasBefore: boolean;
  hasAfter: boolean;
  checks: ProofCheck[];
  /** Something is provably wrong — distinct from merely unproven. */
  contradicted: boolean;
  summary: string;
  /** Safe to release money against. Stricter than "looks fine". */
  payable: boolean;
  payableBecause: string;
  accepted: boolean;
  rejected: boolean;
  aiSummary: string | null;
  /**
   * Did the work area visibly change between the two videos. 'none' is an
   * answer, not a failure — a claimed day with no visible change is exactly
   * what this surfaces.
   */
  materialChange?: 'significant' | 'minor' | 'none' | 'unclear' | null;
  /** Lifecycle of the model read: queued, running, done, skipped, failed. */
  analysisStatus?: string | null;
  analysisError?: string | null;
  aiFindings: {
    materialBecause?: string;
    changes?: string[];
    cannotTell?: string[];
    scopeTouched?: string[];
    /** Per scope line, what the footage supports. */
    scopeVerdicts?: ScopeVerdict[];
    concerns?: string[];
    /** Whether each clip opened at the property exterior, as the guide asks. */
    opening?: { before: OpeningWord; after: OpeningWord };
  } | null;
  /** Per-video narrated reports, independent of the day comparison. */
  reports?: { before: ProofVideoReport | null; after: ProofVideoReport | null };
  /** Ordered: before first, then after. */
  proofIds: string[];
}

export type OpeningWord = 'exterior' | 'not_exterior' | 'unclear';

/* ---- Capture guide ---- */

export interface CaptureStep {
  kind: 'anchor' | 'scope' | 'exclusion' | 'wrap';
  instruction: string;
  why: string;
}

export interface CaptureGuide {
  phase: 'before' | 'after';
  steps: CaptureStep[];
  targetSeconds: number;
}

/** One live frame, judged against the shot list while the camera runs. */
export interface LiveStageObservation {
  stageIndex: number;
  stageLabel: string;
  stageKind: CaptureStep['kind'] | null;
  note: string;
  confidence: number;
}

/** The report attached to one filed video. */
export interface ProofVideoReport {
  status: 'queued' | 'running' | 'done' | 'skipped' | 'failed' | null;
  text: string | null;
  entries: Array<{ frame: number; atSeconds: number; stageIndex: number; note: string }>;
  coverage: Array<{ stageIndex: number; label: string; seen: boolean }>;
  error: string | null;
}

export interface ScopeVerdict {
  title: string;
  /** 'not_visible' is not a failure — the camera simply did not cover it. */
  verdict: 'appears_complete' | 'in_progress' | 'not_visible';
  because: string;
}

export interface ProofResponse {
  days: ProofDay[];
  counts: { days: number; payable: number; contradicted: number; awaitingAfter: number };
  /** False when the job has no coordinates, so the on-site check cannot run. */
  siteKnown: boolean;
}

export interface ProofQuestion {
  id: string;
  question: string;
  answer: string | null;
  grounded_on: string[];
  created_at: string;
}

/* ---- Evidence and chain of custody --------------------------------------- */

export interface EvidenceItem {
  id: string;
  partyId: string | null;
  company: string | null;
  trade: string | null;
  workDate: string;
  phase: 'before' | 'after';
  category: string | null;
  title: string;
  tags: string[];
  durationSeconds: number | null;
  byteSize: number | null;
  capturedAt: string | null;
  receivedAt: string;
  hasLocation: boolean;
  state: string;
  checks: ProofCheck[];
  aiSummary: string | null;
  legalHold: boolean;
  retentionUntil: string | null;
  /** SHA-256 of the file. The claim that it has not been altered since. */
  contentHash: string | null;
  /** How many times it has been opened. "You never showed me" is answered here. */
  viewCount: number;
  lastViewedAt: string | null;
}

export interface CustodyEntry {
  id: string;
  action: string;
  actor_label: string;
  actor_role: string | null;
  detail: string | null;
  occurred_at: string;
}

/** A share link scoped to one job — evidence library or progress dashboard. */
export interface EvidenceShare {
  id: string;
  jobId: string;
  label: string;
  kind: 'evidence' | 'progress';
  recipientEmail: string | null;
  path: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastOpenedAt: string | null;
  openCount: number;
  state: 'live' | 'expired' | 'revoked';
}

export interface ProgressShareGuestView {
  share: {
    label: string;
    expiresAt: string | null;
    recipientEmail: string | null;
  };
  org: { name: string };
  job: {
    id: string;
    title: string;
    jobNumber: number | null;
    claimNumber: string | null;
    status: string | null;
  } | null;
  progress: {
    scopePct: number;
    scopeApproved: number;
    scopeTotal: number;
    daysLogged: number;
    verifiedDays: number;
    inProgress: number;
  };
  proof: ProofResponse;
}

/* ---- Scope documents ----------------------------------------------------- */

export interface ProposedScopeLine {
  title: string;
  state: 'included' | 'excluded';
  reason: string | null;
  amount: number | null;
  note: string | null;
}

export interface ScopeDocument {
  id: string;
  filename: string;
  mediaType: string;
  byteSize: number | null;
  status: 'uploaded' | 'extracting' | 'extracted' | 'failed' | 'confirmed';
  extracted: { lines: ProposedScopeLine[]; couldNotRead: string[] } | null;
  extractionError: string | null;
  confirmedAt: string | null;
  createdAt: string;
}

/* ---- Job intake and readiness -------------------------------------------- */

export type IntakeSource = 'crm_sync' | 'scope_document' | 'manual';
export type ReadinessCeiling = 'filed_only' | 'work_only' | 'full';
export type ReadinessLevel = 'blocked' | 'limited' | 'ready';

export interface ReadinessGap {
  key: 'scope' | 'address' | 'coordinates' | 'schedule';
  what: string;
  costs: string;
  fix: string;
  severity: 'blocking' | 'weakening';
}

export interface JobReadiness {
  level: ReadinessLevel;
  ceiling: ReadinessCeiling;
  headline: string;
  gaps: ReadinessGap[];
  strengths: string[];
  source: IntakeSource | null;
}

/** Editable package from POST /api/operations/intake/propose (no money fields). */
export interface IntakeProposal {
  title: string;
  workType: 'mitigation' | 'construction';
  address: string;
  city: string;
  postalCode: string;
  claimNumber: string;
  briefNote: string;
  facts: Record<string, string>;
  scope: Array<{ title: string; state: 'included' | 'excluded'; reason?: string }>;
  /** Stub; invites come from captureTeam, not free-text party fields. */
  party?: { company: string; trade: string; contactName: string };
  source: 'heuristic' | 'model';
  summary: string;
}

/** Org Field Capture teammates returned with propose — pre-selected to invite. */
export type CaptureTeamMember = {
  userId: string;
  fullName: string;
  email: string | null;
  role: string;
  workType: string | null;
  selected: boolean;
};

export type IntakeInvitee = {
  userId?: string;
  fullName: string;
  company?: string;
  email?: string | null;
  trade?: string;
  /** Outside the org — mainly subcontractors invited by email. */
  external?: boolean;
};

export type IntakeApproveInput = {
  title: string;
  workType?: 'mitigation' | 'construction';
  address: string;
  city?: string;
  postalCode?: string;
  claimNumber?: string;
  briefNote?: string | null;
  facts?: Record<string, string>;
  scope: IntakeProposal['scope'];
  invitees: IntakeInvitee[];
};

export type IntakeCaptureInvite = {
  id: string;
  name: string;
  email: string | null;
  sharePath: string;
  fieldCapturePath: string;
  token: string;
  external?: boolean;
  emailed?: boolean;
  recipientHasAccount?: boolean;
  attachedToAccount?: boolean;
};

export type IntakeApproveResult = {
  job: { id: string; title: string; jobNumber: number | null };
  briefRevision: number;
  scopeSaved: number;
  invites: IntakeCaptureInvite[];
  /** First invitee — back-compat with older UI. */
  party: { id: string; company: string };
  sharePath: string;
  fieldCapturePath: string;
  readiness: JobReadiness;
};

/* ---- The subcontractor's own list ---------------------------------------- */

export interface ClaimedJob {
  partyId: string;
  accessToken: string;
  orgId: string;
  orgName: string;
  jobId: string;
  jobTitle: string;
  jobNumber: number | null;
  address: string | null;
  scheduledStart: string | null;
  status: string | null;
  trade: string | null;
  revoked: boolean;
}

export interface GeneralContractorGroup {
  orgId: string;
  orgName: string;
  jobs: ClaimedJob[];
}

export interface FieldIdentity {
  displayName: string | null;
  contact: string;
  channel: 'sms' | 'email';
}

export interface FieldJobList {
  identity: FieldIdentity;
  generalContractors: GeneralContractorGroup[];
  today: ClaimedJob[];
}

/** Open job in the caller's company (Field Capture today / search). */
export interface FieldAppJob {
  id: string;
  number: string;
  name: string;
  address: string;
  at: string;
  status: string | null;
  placed: boolean;
}

export interface FieldAppOrgRef {
  id: string;
  name: string;
}

export interface FieldAppCaptureLink {
  jobId: string;
  partyId: string;
  token: string;
  fieldCapturePath: string;
}

/* ---- CRM job sync -------------------------------------------------------- */

export type CrmSyncSystem = 'jobnimbus' | 'acculynx' | 'dash' | 'servicetitan';

export interface CrmSyncSummary {
  created: number;
  updated: number;
  conflicts: number;
  archived: number;
  unchanged: number;
}

export interface CrmSyncSystemStatus {
  system: CrmSyncSystem;
  label: string;
  connected: boolean;
  accountLabel: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastSummary: CrmSyncSummary | null;
}

export interface CrmSyncStatus {
  driver: 'mock' | 'api';
  conflictsPending: number;
  systems: CrmSyncSystemStatus[];
}

/** A change sync refused to make on its own — an address move under evidence. */
export interface CrmSyncConflict {
  linkId: string;
  system: CrmSyncSystem;
  systemLabel: string;
  externalId: string;
  jobId: string;
  jobTitle: string | null;
  jobNumber: number | null;
  kind: string;
  incoming: {
    title: string;
    claimNumber: string | null;
    address: {
      line1: string;
      line2?: string | null;
      city: string | null;
      region: string | null;
      postalCode: string | null;
      lat: number | null;
      lon: number | null;
    } | null;
  };
  seenAt: string;
}

export interface CreateEvidenceShareResult {
  share: {
    id: string;
    label: string;
    kind?: 'evidence' | 'progress';
    expiresAt: string | null;
    createdAt: string;
    path: string;
  };
  /** Whether the notification actually left the org's connected mailbox. */
  emailed: boolean;
  /** Whether the pinned address already answers to an Atmosphere account. */
  recipientHasAccount: boolean;
}

/* ---- Account structure --------------------------------------------------- */

export interface AccountStructure {
  account: {
    id: string;
    name: string;
    type: string | null;
    parentAccountId: string | null;
    /** Set when this record was folded into another. Kept so old links resolve. */
    mergedIntoId: string | null;
    city: string | null;
    region: string | null;
  };
  /** Nearest first, so it reads as a breadcrumb without reversing. */
  ancestors: Array<{ id: string; name: string }>;
  children: Array<{ id: string; name: string; type?: string | null }>;
  subtreeSize: number;
  links: Array<{
    id: string;
    otherId: string;
    otherName: string;
    kind: string;
    direction: 'from' | 'to';
    /** Already phrased from this account's side. */
    reads: string;
    note: string | null;
    startedOn: string | null;
    endedOn: string | null;
  }>;
  people: Array<{
    id: string;
    contactId: string;
    accountId: string;
    name: string;
    title: string | null;
    email: string | null;
    role: string;
    isPrimary: boolean;
    endedOn: string | null;
  }>;
  rollup: {
    accounts: number;
    jobs: number;
    openJobs: number;
    contractTotal: number;
    invoicedTotal: number;
    paidTotal: number;
    /** Jobs booked directly here, as opposed to anywhere in the tree. */
    ownJobs: number;
  };
  mergedIn: Array<{
    id: string;
    loserId: string;
    loserName: string;
    moved: Record<string, number>;
    mergedAt: string;
  }>;
}

export interface DuplicatePair {
  score: number;
  suggestedWinner: string;
  a: { id: string; name: string; attached: number };
  b: { id: string; name: string; attached: number };
}

/* ---- Invitations --------------------------------------------------------- */

export interface OrgInvite {
  id: string;
  email: string;
  /** Advisory — the joiner picks their own role at onboarding. */
  role: MemberRole;
  note?: string | null;
  status: 'pending' | 'joined' | 'revoked';
  createdAt: string;
  joinedAt?: string | null;
  revokedAt?: string | null;
}

/* ---- Purchasing ---------------------------------------------------------- */

export type PurchaseOrderStatus = 'draft' | 'approved' | 'placed' | 'cancelled';
export type SupplierId = 'home_depot' | 'lowes' | 'manual';

export interface PurchaseOrder {
  id: string;
  estimateId: string | null;
  jobName: string;
  claimNumber: string | null;
  supplier: SupplierId;
  vendorAccountId: string | null;
  status: PurchaseOrderStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  placedAt: string | null;
  externalRef: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  /** List view only. */
  lineCount?: number;
  estTotal?: number;
}

export interface PurchaseOrderLine {
  id: string;
  materialKey: string;
  description: string;
  detail: string | null;
  quantity: number;
  unit: string;
  unitPrice: number | null;
  /** 'estimate' until a supplier has actually quoted it. */
  priceBasis: 'estimate' | 'quoted';
  sourceSummary: string | null;
}

export interface PurchaseOrderEvent {
  id: string;
  actorName: string;
  action: 'created' | 'edited' | 'approved' | 'reopened' | 'placed' | 'cancelled';
  detail: string;
  at: string;
}

export interface TakeoffLine {
  materialKey: string;
  description: string;
  detail: string;
  orderUnit: string;
  quantity: number;
  estUnitPrice: number;
  estTotal: number;
  sourceSummary: string;
  sourceLineIds: string[];
  note?: string;
}

export interface TakeoffResult {
  lines: TakeoffLine[];
  noMaterials: Array<{ catalogKey: string; description: string; reason: string }>;
  unmapped: Array<{ catalogKey: string; description: string; quantity: number; unit: string }>;
  zeroQuantity: number;
  estTotal: number;
}

export interface TakeoffSource {
  estimateId: string;
  jobName: string;
  claimNumber: string | null;
  total?: number;
  createdAt: string;
}

export interface SupplierStatus {
  id: 'home_depot' | 'lowes';
  label: string;
  connected: boolean;
  accountLabel: string | null;
  connectedAt: string | null;
}

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'finished';
export type CampaignChannel = 'email' | 'call' | 'mixed';

export interface Campaign {
  id: string;
  name: string;
  goal: string | null;
  channel: CampaignChannel;
  status: CampaignStatus;
  territoryId: string | null;
  ownerId: string | null;
  startsOn: string | null;
  endsOn: string | null;
  createdAt: string;
  /** Members by status, plus `total`. Absent keys are zero. */
  counts: Record<string, number>;
  triggerKind?: 'manual' | 'weather' | 'seasonal';
  triggerConfig?: TriggerConfig;
  audienceConfig?: AudienceConfig;
  messageSubject?: string | null;
  messageBody?: string | null;
}

export interface PlaceCategory { id: string; label: string; blurb: string; }

export interface FoundPlace {
  externalId: string; category: string; name: string;
  street: string | null; city: string | null; state: string | null;
  postalCode: string | null; lat: number | null; lon: number | null;
  phone: string | null; website: string | null;
}

export interface WeatherGroup { id: string; label: string; blurb: string; events: string[]; }

export interface WeatherAlert {
  id: string; event: string; severity: string; urgency: string;
  headline: string | null; areaDesc: string;
  effective: string | null; onset: string | null; expires: string | null;
  group: string | null;
  hoursOfNotice: number | null;
  /** True when the office drew a shape, so ZIP matching was exact. */
  hasGeometry?: boolean;
  /**
   * Which of your territories this covers, and exactly which of their ZIP
   * codes. `matchedBy: 'geometry'` means the codes are inside the warned
   * polygon; 'area-name' means only the county was mentioned.
   */
  territories: Array<{
    id: string;
    name: string;
    zips?: string[];
    matchedBy?: 'geometry' | 'area-name' | 'none';
  }>;
}

export interface TriggerConfig {
  groups?: string[];
  severities?: string[];
  leadTimeHours?: number;
  cooldownDays?: number;
}

export interface AudienceConfig {
  placeCategories?: string[];
  includeContacts?: boolean;
  territoryId?: string | null;
  titleKeywords?: string[];
}

export interface AudienceMember {
  kind: 'contact' | 'place';
  id: string; name: string;
  email: string | null; company: string | null; title: string | null;
  why: string;
}

export type CampaignMemberStatus =
  | 'pending' | 'sent' | 'opened' | 'replied' | 'bounced' | 'unsubscribed' | 'skipped';

export interface CampaignMember {
  id: string;
  campaignId: string;
  contactId: string | null;
  prospectId: string | null;
  status: CampaignMemberStatus;
  lastTouchAt: string | null;
  touches: number;
  note: string | null;
  personName: string;
  personEmail: string | null;
  personCompany: string | null;
}

/** One vendor or verifier, as the settings screen describes it. */
export interface Integration {
  id: string;
  name: string;
  kind: 'source' | 'verifier';
  /** Credentials present at all. */
  configured: boolean;
  /** Null until tested; true/false after a live credential call. */
  reachable: boolean | null;
  detail: string | null;
  costNanos: number;
}

export interface ProspectSearchResponse extends ProspectingStatus {
  matches: ProspectMatch[];
  total: number | null;
}

export interface ProspectQuery {
  q?: string;
  location?: string;
  companyDomain?: string;
  industry?: string;
  titles?: string[];
  limit?: number;
}

export interface Suppression {
  id: string;
  kind: 'email' | 'phone' | 'domain';
  value: string;
  reason: string | null;
  createdAt?: string;
}

export interface CrmSummary {
  contacts: number;
  properties: number;
  openLeads: number;
  activeJobs: number;
  completedJobs: number;
}

/** Camelized crm_contacts row. */
export interface CrmContact {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  createdAt?: string;
}

/**
 * The credential carried by a password-recovery link. Supabase emits one of
 * three shapes depending on the email template and flow type; the backend
 * normalises whichever arrives into a session.
 */
export interface RecoveryCredential {
  tokenHash?: string;
  code?: string;
  accessToken?: string;
  refreshToken?: string;
}

/* ---- Audit ledger ---------------------------------------------------- */

export type AgentRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type AgentActorType = 'user' | 'system' | 'schedule' | 'agent';
export type AgentStepStatus = 'ok' | 'error' | 'pending';
export type AgentAccent = 'brand' | 'neutral' | 'success' | 'caution' | 'danger';

export type AgentStepType =
  | 'status'
  | 'thought'
  | 'message'
  | 'tool_call'
  | 'tool_result'
  | 'observation'
  | 'navigation'
  | 'decision'
  | 'artifact'
  | 'usage'
  | 'error'
  | 'event';

/** An agent as the catalog describes it, independent of whether it has run. */
export interface AgentDefinition {
  key: string;
  name: string;
  blurb: string;
  accent: AgentAccent;
  /** 'ledger' — writes its own trace. 'bridge' — mirrored from its own table. */
  intake: 'ledger' | 'bridge';
  sourceTable?: string;
}

export interface AgentSummary extends AgentDefinition {
  total: number;
  succeeded: number;
  failed: number;
  active: number;
  steps: number;
  lastRunAt: string | null;
  avgDurationMs: number | null;
}

export interface AuditRun {
  id: string;
  agentKey: string;
  agent: AgentDefinition;
  agentLabel: string | null;
  actorType: AgentActorType;
  actorUserId: string | null;
  actorEmail: string | null;
  actorLabel: string | null;
  parentRunId: string | null;
  title: string;
  summary: string | null;
  status: AgentRunStatus;
  error: string | null;
  stepCount: number;
  inputTokens: number;
  outputTokens: number;
  sourceTable: string | null;
  sourceId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string | null;
  /** Detail view only — omitted from the list to keep pages small. */
  input?: unknown;
  result?: unknown;
}

export interface AuditStep {
  id: string;
  seq: number;
  type: AgentStepType;
  action: string | null;
  detail: string | null;
  target: string | null;
  payload: unknown;
  status: AgentStepStatus;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface AuditStats {
  totalRuns: number;
  activeRuns: number;
  failedRuns: number;
  succeededRuns: number;
  totalSteps: number;
  inputTokens: number;
  outputTokens: number;
  runs24h: number;
  agentsSeen: number;
  lastRunAt: string | null;
}

export interface AuditRunFilters {
  agent?: string;
  status?: AgentRunStatus;
  actorType?: AgentActorType;
  q?: string;
  from?: string;
  limit?: number;
  cursor?: string;
}

/* ==========================================================================
 * Agent Memory
 * ========================================================================== */

/** crm_job_status — the CRM owns the job lifecycle. */
export type JobStatus =
  | 'draft'
  | 'scheduled'
  | 'in_progress'
  | 'on_hold'
  | 'completed'
  | 'invoiced'
  | 'paid'
  | 'cancelled';

/** crm_jobs.priority is a smallint 1-5, 1 being the most urgent. */
export type JobPriority = 1 | 2 | 3 | 4 | 5;
/** Tasks are ours, and keep a word-shaped priority. */
export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export type LossType = 'water' | 'fire' | 'mold' | 'storm' | 'biohazard' | 'contents' | 'other';
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
export type WorkLogKind = 'work' | 'note' | 'call' | 'site_visit' | 'photo' | 'material' | 'issue';
export type AssignmentRole = 'lead' | 'crew' | 'estimator' | 'supervisor' | 'observer';

export interface Person {
  id: string;
  email: string | null;
  fullName: string | null;
}

export interface Job {
  id: string;
  jobNumber: number;
  title: string;
  description: string | null;
  workType: WorkType;
  lossType: LossType | null;
  status: JobStatus;
  priority: JobPriority;
  claimNumber: string | null;
  policyNumber: string | null;
  ownerId: string | null;
  contactId: string | null;
  accountId: string | null;
  propertyId: string | null;
  lossDate: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  contractAmount: number | null;
  invoicedAmount: number | null;
  paidAmount: number | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A job as it appears in the list — the row plus its memory rolled up. */
export interface JobSummary {
  jobId: string;
  jobNumber: number;
  title: string;
  status: JobStatus;
  priority: JobPriority;
  workType: WorkType;
  ownerId: string | null;
  claimNumber: string | null;
  taskCount: number;
  tasksDone: number;
  crewSize: number;
  minutesLogged: number;
  eventCount: number;
  lastEvent: string | null;
  lastEventAt: string | null;
  contractAmount: number | null;
  invoicedAmount: number | null;
  paidAmount: number | null;
  scheduledStart: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobTask {
  id: string;
  jobId: string;
  title: string;
  details: string | null;
  status: TaskStatus;
  priority: Priority;
  assignedTo: string | null;
  assignee: Person | null;
  dueAt: string | null;
  position: number;
  completedAt: string | null;
  completedBy: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobAssignment {
  id: string;
  jobId: string;
  userId: string;
  agent: Person | null;
  roleOnJob: AssignmentRole;
  assignedBy: string;
  assignedAt: string;
  releasedAt: string | null;
  active: boolean;
}

export interface WorkLog {
  id: string;
  jobId: string;
  taskId: string | null;
  kind: WorkLogKind;
  body: string;
  minutes: number | null;
  occurredAt: string;
  authorId: string;
  author: Person | null;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
}

/** One entry in the record. `changes` holds the field-level before and after. */
export interface MemoryEvent {
  id: string;
  seq: number;
  actorId: string | null;
  /** Who they were when it happened — not who they are now. */
  actorEmail: string | null;
  actorRole: string | null;
  eventType: string;
  entityType: string;
  entityId: string | null;
  jobId: string | null;
  job?: { id: string; jobNumber: number; title: string } | null;
  summary: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  snapshot: Record<string, unknown> | null;
  source: 'trigger' | 'app';
  occurredAt: string;
}

export interface AgentMemory {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: MemberRole;
  workType: WorkType;
  eventCount: number;
  jobsTouched: number;
  openTasks: number;
  tasksCompleted: number;
  minutesLogged: number;
  lastActiveAt: string | null;
}

export interface MemoryStats {
  totalEvents: number;
  agents: number;
  activeToday: number;
  minutesLogged: number;
  eventsInWindow: number;
  byType: Record<string, number>;
}

export interface JobDetail {
  job: Job;
  tasks: JobTask[];
  crew: JobAssignment[];
  workLogs: WorkLog[];
  memory: MemoryEvent[];
}

export interface CreateJobInput {
  title: string;
  workType: WorkType;
  description?: string;
  lossType?: LossType;
  priority?: JobPriority;
  status?: JobStatus;
  claimNumber?: string;
  policyNumber?: string;
  ownerId?: string | null;
  scheduledStart?: string | null;
}

export interface CreateTaskInput {
  title: string;
  details?: string;
  status?: TaskStatus;
  priority?: Priority;
  assignedTo?: string | null;
  dueAt?: string | null;
  position?: number;
}

export interface CreateWorkLogInput {
  kind: WorkLogKind;
  body: string;
  taskId?: string | null;
  minutes?: number | null;
  occurredAt?: string | null;
}

export interface MemoryQuery {
  jobId?: string;
  actorId?: string;
  entityType?: string;
  eventType?: string;
  since?: string;
  until?: string;
  search?: string;
  before?: number;
  limit?: number;
}
/** What the deployment can actually do, so the UI can offer only what works. */
export interface TechnicianCapabilities {
  /** A language model is configured; otherwise replies come from a local fallback. */
  assistant: boolean;
  /** Server-side speech-to-text is configured (the fallback for Safari/Firefox). */
  transcription: boolean;
  maxAudioUploadBytes: number;
}

export interface AssistantTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Everything the assistant is told about the caller and their surroundings. */
export interface AssistantContext {
  role?: MemberRole;
  workType?: WorkType;
  orgName?: string;
  /** Current labels from the in-browser object detector. */
  detectedObjects?: string[];
}

export interface AssistantReply {
  reply: string;
  /** null when the rule-based fallback answered rather than a model. */
  model: string | null;
}

/** A website the organization has connected for the AI to work in. */
export interface WebConnection {
  id: string;
  label: string;
  siteUrl: string;
  loginUrl: string | null;
  username: string;
  status: 'unverified' | 'verified' | 'failed';
  lastVerifiedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

/** One action the AI took during a run — the audit trail for a task. */
export interface WebRunStep {
  index: number;
  action: string;
  detail: string;
  url: string;
  error?: string;
}

export type WebRunKind = 'pull' | 'push';
export type WebRunStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface WebRun {
  id: string;
  connectionId: string;
  kind: WebRunKind;
  instruction: string;
  status: WebRunStatus;
  result: { summary: string; records: unknown[] } | null;
  steps: WebRunStep[];
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface WebConnectionInput {
  label: string;
  siteUrl: string;
  loginUrl?: string;
  username: string;
  password: string;
}

/* ---------------------------------------------------------------------------
 * App Connectors — curated third-party apps (ServiceTitan, AccuLynx, …)
 * reached via Web Access, Computer Use, or Estimator API adapters.
 * ------------------------------------------------------------------------- */

export type ConnectorAccessMode = 'web' | 'computer' | 'api';
export type ConnectorCategory =
  | 'restoration'
  | 'roofing'
  | 'contractor'
  | 'estimating'
  | 'carriers'
  | 'custom';
export type AppConnectorStatus = 'connected' | 'needs_attention' | 'disabled';

export interface ConnectorTaskTemplate {
  id: string;
  label: string;
  kind: WebRunKind;
  instruction: string;
}

export interface ConnectorDefinition {
  key: string;
  name: string;
  blurb: string;
  category: ConnectorCategory;
  accessModes: ConnectorAccessMode[];
  contractorTypes: Array<ContractorType | 'all'>;
  siteUrl: string | null;
  loginUrl: string | null;
  estimatorProvider: EstimatorProvider | null;
  computerAppHint: string | null;
  taskTemplates: ConnectorTaskTemplate[];
}

export interface AppConnectorConnection {
  id: string;
  connectorKey: string;
  accessMode: ConnectorAccessMode;
  label: string;
  status: AppConnectorStatus;
  webConnectionId: string | null;
  estimatorProvider: EstimatorProvider | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  definition: ConnectorDefinition | null;
}

export interface ConnectorCatalogResponse {
  categories: Array<{ id: ConnectorCategory; label: string }>;
  accessModes: Array<{ id: ConnectorAccessMode; label: string }>;
  contractorType: ContractorType | null;
  capabilities: {
    webAccessEnabled: boolean;
    computerUseAvailable: boolean;
    estimatorCredentialStorageAvailable: boolean;
  };
  connectors: ConnectorDefinition[];
}

export interface ConnectAppConnectorInput {
  connectorKey: string;
  accessMode: ConnectorAccessMode;
  label?: string;
  siteUrl?: string;
  loginUrl?: string;
  username?: string;
  password?: string;
  apiKey?: string;
  accountId?: string;
  baseUrl?: string;
  notes?: string;
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

/* ---------------------------------------------------------------------------
 * Verifier — the second agent, which re-opens the site after a run reports
 * success and checks the work is really there.
 * ------------------------------------------------------------------------- */

/** One checkable claim, derived from the task the user originally wrote. */
export interface Expectation {
  id: string;
  kind: 'record_exists' | 'field_value' | 'record_absent' | 'state_change' | 'reported_data_matches';
  description: string;
  where: string;
  identifiers: Record<string, string>;
  expected: Record<string, string>;
  critical: boolean;
}

export type Verdict = 'satisfied' | 'violated' | 'indeterminate';

/** What the verifier actually saw for one expectation, and where. */
export interface Finding {
  expectationId: string;
  verdict: Verdict;
  evidence: string;
  url: string;
  reasoning: string;
  repair?: {
    repairClass: 'create_missing' | 'correct_value' | 'needs_human';
    instruction: string;
    rationale: string;
  };
}

export interface VerifierStep {
  index: number;
  action: string;
  detail: string;
  url: string;
  phase: 'observe' | 'repair';
  error?: string;
}

export type VerificationStatus =
  | 'queued'
  | 'running'
  | 'verified'
  | 'repaired'
  | 'escalated'
  | 'rejected'
  | 'failed'
  | 'cancelled';

export interface Verification {
  id: string;
  runId: string;
  connectionId: string;
  status: VerificationStatus;
  verdict: Verdict | null;
  expectations: Expectation[];
  findings: Finding[];
  steps: VerifierStep[];
  repairAttempts: number;
  summary: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export type EscalationReason =
  | 'indeterminate'
  | 'unsafe_repair'
  | 'repair_exhausted'
  | 'repair_failed';

/** One answer a person can give. `action` is what the verifier does with it. */
export interface EscalationOption {
  id: string;
  label: string;
  detail: string;
  action: 'repair' | 'accept' | 'reject' | 'recheck';
}

export interface EscalationContext {
  reason?: EscalationReason;
  siteLabel?: string;
  runInstruction?: string;
  verdict?: Verdict;
  verifierSummary?: string;
  unsettled?: Array<{
    expectation: string;
    verdict: Verdict;
    evidence: string;
    url: string;
    reasoning: string;
    proposedFix: string | null;
    fixSafety: string | null;
  }>;
}

export interface Escalation {
  id: string;
  verificationId: string;
  runId: string;
  reason: EscalationReason;
  question: string;
  context: EscalationContext;
  options: EscalationOption[];
  status: 'open' | 'resolved' | 'dismissed';
  chosenOption: string | null;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

/* ------------------------------ Computer use ------------------------------ */

export type CaptureQuality = 'economical' | 'balanced' | 'detailed';

/** A computer with the agent running and connected. */
export interface ComputerAgent {
  id: string;
  name: string;
  platform: string;
  version: string;
  screen: { width: number; height: number };
  /** Resolution the model sees; null until the computer is configured. */
  capture: { width: number; height: number; scale: number } | null;
  capabilities: string[];
  connectedAt: string;
  busy: boolean;
}

export interface CredentialStatus {
  connected: boolean;
  /** 'organization' — entered here; 'server' — set as ANTHROPIC_API_KEY. */
  source: 'organization' | 'server' | null;
  hint: string | null;
  updatedAt: string | null;
}

export interface ComputerStatus {
  enabled: boolean;
  credential: CredentialStatus;
  agents: ComputerAgent[];
  models: { id: string; label: string }[];
  defaults: { model: string; quality: CaptureQuality };
  limits: { maxSteps: number; runTimeoutMs: number };
}

export type RunStatus = 'starting' | 'running' | 'completed' | 'failed' | 'stopped';

export interface ComputerRun {
  id: string;
  agentId: string;
  agentName: string;
  instruction: string;
  model: string;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  steps: number;
  usage: { inputTokens: number; outputTokens: number };
  error: string | null;
}

/** One entry in the live transcript streamed over SSE. */
export type RunEvent = { seq: number; at: string } & (
  | { type: 'status'; status: RunStatus; message?: string }
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'action'; action: string; summary: string; ok: boolean; error?: string }
  | { type: 'screenshot'; image: string | null; width: number; height: number }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'error'; message: string }
);

/** The stream also carries periodic run summaries, which are not transcript entries. */
export type RunStreamMessage = RunEvent | { type: 'summary'; run: ComputerRun };

/* ------------------------------------------------------------------ */
/* Atmosphere Outreach (internal GTM)                                   */
/* ------------------------------------------------------------------ */

export type SalesCampaignStatus =
  | 'draft'
  | 'researching'
  | 'crawling'
  | 'outreach'
  | 'following_up'
  | 'scheduling'
  | 'paused'
  | 'completed'
  | 'failed';

export interface SalesCampaign {
  id: string;
  orgId: string;
  createdBy: string;
  name: string;
  territory: string;
  salesFocus: string;
  valueProp: string | null;
  senderName: string | null;
  senderEmail: string | null;
  meetingDurationMin: number;
  availability: Record<string, string[]>;
  status: SalesCampaignStatus;
  stageDetail: string | null;
  error: string | null;
  agentRunId: string | null;
  businessesFound: number;
  contactsFound: number;
  emailsSent: number;
  repliesReceived: number;
  meetingsBooked: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SalesBusiness {
  id: string;
  campaignId: string;
  name: string;
  category: string | null;
  address: string | null;
  city: string | null;
  websiteUrl: string | null;
  phone: string | null;
  source: string;
  researchNotes: string | null;
  status: string;
  createdAt: string;
}

export interface SalesContact {
  id: string;
  campaignId: string;
  businessId: string;
  fullName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  isDecisionMaker: boolean;
  researchSummary: string | null;
  personalizationHooks: string[];
  status: string;
  nextFollowupAt: string | null;
  lastTouchedAt: string | null;
  createdAt: string;
}

export interface SalesOutreach {
  id: string;
  campaignId: string;
  contactId: string;
  businessId: string;
  direction: 'outbound' | 'inbound';
  channel: string;
  subject: string | null;
  body: string;
  sequenceStep: number;
  status: string;
  intent: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface SalesMeeting {
  id: string;
  campaignId: string;
  contactId: string;
  businessId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  status: string;
  bookedBy: string;
  notes: string | null;
  createdAt: string;
}

export interface SalesEvent {
  id: string;
  campaignId: string;
  businessId: string | null;
  contactId: string | null;
  actorType: string;
  eventType: string;
  detail: string | null;
  createdAt: string;
}

export interface SalesStatus {
  llm: boolean;
  email: boolean;
  demoMode: boolean;
  crawl: boolean;
  scheduling: boolean;
  peopleSearch?: boolean;
}

export interface PeopleSearchSource {
  title: string;
  url: string;
  snippet: string;
  engine?: string;
}

export interface PeopleSearchCandidate {
  fullName: string;
  title: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  profileUrl: string | null;
  confidence: number;
  summary: string;
  evidence: string[];
  sources: PeopleSearchSource[];
  matchReasons: string[];
}

export interface PeopleSearchTraceStep {
  step: string;
  detail: string;
  at: string;
}

export interface PeopleSearchRecord {
  id: string | null;
  query: string;
  parsed?: {
    role?: string | null;
    company?: string | null;
    location?: string | null;
    personName?: string | null;
    searchQueries?: string[];
  };
  status: 'running' | 'completed' | 'partial' | 'failed';
  summary: string | null;
  bestMatch: PeopleSearchCandidate | null;
  candidates: PeopleSearchCandidate[];
  sources: PeopleSearchSource[];
  trace: PeopleSearchTraceStep[];
  pagesCrawled: number;
  searchesRun: number;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
  persisted?: boolean;
}

export const SALES_STATUS_LABELS: Record<SalesCampaignStatus, string> = {
  draft: 'Draft',
  researching: 'Researching',
  crawling: 'Finding contacts',
  outreach: 'Outreach',
  following_up: 'Following up',
  scheduling: 'Scheduling',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code = 'error') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include', // send/receive the httpOnly session cookies
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, 'Network error — is the backend running?', 'network_error');
  }

  const text = await res.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!res.ok) {
    const message = (body.error as string) ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message, (body.code as string) ?? 'error');
  }

  return body as T;
}

export interface AuthResponse {
  user: AuthUser | null;
  needsEmailConfirmation?: boolean;
  message?: string;
}

export const api = {
  // ---- Auth ----
  signup: (email: string, password: string) =>
    request<AuthResponse>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  login: (email: string, password: string) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  me: () => request<{ user: AuthUser }>('/api/auth/me', { method: 'GET' }),

  // ---- Password recovery ----
  forgotPassword: (email: string) =>
    request<{ ok: boolean; message: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  resetPassword: (credential: RecoveryCredential, password: string) =>
    request<{ user: AuthUser }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ ...credential, password }),
    }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ user: AuthUser }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  // ---- Profile ----
  getProfile: () => request<{ profile: Profile }>('/api/profile', { method: 'GET' }),

  updateProfile: (fullName: string | null) =>
    request<{ profile: Profile }>('/api/profile', {
      method: 'PATCH',
      body: JSON.stringify({ fullName }),
    }),

  // ---- Device PIN ----
  pinStatus: () =>
    request<{ enrolled: boolean; lockedUntil?: string | null }>('/api/auth/pin/status', {
      method: 'GET',
    }),

  pinEnroll: (pin: string) =>
    request<{ ok: boolean }>('/api/auth/pin/enroll', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    }),

  pinUnlock: (pin: string) =>
    request<{ user: AuthUser }>('/api/auth/pin/unlock', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    }),

  pinDisable: () => request<{ ok: boolean }>('/api/auth/pin/disable', { method: 'POST' }),

  // ---- Organization / onboarding ----
  getMembership: () => request<{ membership: Membership | null }>('/api/org/me', { method: 'GET' }),

  updateMembership: (role: MemberRole, workType: WorkType, usageIntents: UsageIntent[]) =>
    request<{ membership: Membership }>('/api/org/me', {
      method: 'PATCH',
      body: JSON.stringify({ role, workType, usageIntents }),
    }),

  updateOrgProfile: (contractorType: ContractorType) =>
    request<{ org: Org }>('/api/org', {
      method: 'PATCH',
      body: JSON.stringify({ contractorType }),
    }),

  createOrg: (
    name: string,
    role: MemberRole,
    workType: WorkType,
    contractorType: ContractorType,
    usageIntents: UsageIntent[],
  ) =>
    request<{ org: Org }>('/api/org', {
      method: 'POST',
      body: JSON.stringify({ name, role, workType, contractorType, usageIntents }),
    }),

  joinOrg: (joinCode: string, role: MemberRole, workType: WorkType, usageIntents: UsageIntent[]) =>
    request<{ org: Org }>('/api/org/join', {
      method: 'POST',
      body: JSON.stringify({ joinCode, role, workType, usageIntents }),
    }),

  getMembers: () => request<{ members: OrgMember[] }>('/api/org/members', { method: 'GET' }),

  // ---- CRM (customers) ----
  crmAccounts: (search = '') =>
    request<CrmList<CrmAccount>>(
      `/api/crm/accounts${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      { method: 'GET' },
    ),

  crmLeads: (search = '') =>
    request<CrmList<CrmLead>>(
      `/api/crm/leads${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      { method: 'GET' },
    ),

  createLead: (input: CrmLeadInput) =>
    request<{ item: CrmLead }>('/api/crm/leads', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateLead: (id: string, patch: Partial<CrmLeadInput>) =>
    request<{ item: CrmLead }>(`/api/crm/leads/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  /** Turns a won lead into a job, carrying its people and value across. */
  convertLead: (id: string, overrides: { title?: string; workType?: WorkType } = {}) =>
    request<{ job: Job; leadUpdated: boolean }>(`/api/crm/leads/${id}/convert`, {
      method: 'POST',
      body: JSON.stringify(overrides),
    }),

  createAccount: (input: { name: string; type?: AccountType; phone?: string; email?: string; city?: string; region?: string; notes?: string }) =>
    request<{ item: CrmAccount }>('/api/crm/accounts', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  createContact: (input: { firstName?: string; lastName?: string; type?: ContactType; companyName?: string; email?: string; phone?: string; mobile?: string; accountId?: string }) =>
    request<{ item: CrmContact }>('/api/crm/contacts', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** Activities, optionally narrowed to one lead / account / job. */
  crmActivities: (filter: { leadId?: string; accountId?: string; jobId?: string } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(filter).forEach(([k, v]) => v && qs.set(k, v));
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<CrmList<CrmActivity>>(`/api/crm/activities${suffix}`, { method: 'GET' });
  },

  logActivity: (input: CrmActivityInput) =>
    request<{ item: CrmActivity }>('/api/crm/activities', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  crmSummary: () => request<{ summary: CrmSummary }>('/api/crm/summary', { method: 'GET' }),

  // ---- Prospecting (find contact details) ----
  prospectingStatus: () =>
    request<ProspectingStatus>('/api/prospecting/status', { method: 'GET' }),

  /** Free: people without their contact details. */
  prospectSearch: (query: ProspectQuery) =>
    request<ProspectSearchResponse>('/api/prospecting/search', {
      method: 'POST',
      body: JSON.stringify(query),
    }),

  /**
   * The metered call.
   *
   * There is deliberately no idempotency key here: the server derives one
   * from (org, person), so a retry of the same reveal replays free and no
   * client can reuse a paid key to get another person for nothing.
   */
  prospectReveal: (providerPersonId: string) =>
    request<{
      prospect: Prospect;
      charged: boolean;
      reason?: string;
      /** 'People Data Labs', 'Pattern + verification', … */
      source?: string;
      phones?: LabelledPhone[];
      verification?: EmailVerification | null;
    }>(
      '/api/prospecting/reveal',
      { method: 'POST', body: JSON.stringify({ providerPersonId }) },
    ),

  /**
   * What is plugged in and whether it works. With `test`, the server makes a
   * real credential call against each — the difference between listing
   * environment variables and knowing the truth.
   */
  prospectingIntegrations: (test = false) =>
    request<{ items: Integration[]; mode: string; sellUnverified: boolean }>(
      `/api/prospecting/integrations${test ? '?test=1' : ''}`,
      { method: 'GET' },
    ),

  /** Whether this org contributes to the shared contact network. */
  /**
   * Run the pipeline against a name and company without charging or saving.
   * Addresses come back masked — enough to recognise one you know, not enough
   * to be an unbilled reveal.
   */
  diagnoseLookup: (fullName: string, companyDomain: string) =>
    request<Diagnosis>('/api/prospecting/diagnose', {
      method: 'POST',
      body: JSON.stringify({ fullName, companyDomain }),
    }),

  // ---- Connected CRMs ----
  crmConnections: () => request<CrmConnections>('/api/integrations/crm', { method: 'GET' }),

  /** Returns the Salesforce URL to send the user to. We never see a password. */
  connectSalesforce: () =>
    request<{ url: string }>('/api/integrations/crm/salesforce/connect', { method: 'POST' }),

  completeSalesforce: (code: string, state: string) =>
    request<{ connected: boolean; accountLabel: string | null }>(
      '/api/integrations/crm/salesforce/callback',
      { method: 'POST', body: JSON.stringify({ code, state }) },
    ),

  disconnectSalesforce: () =>
    request<{ disconnected: boolean; revokedAtSalesforce: boolean }>(
      '/api/integrations/crm/salesforce',
      { method: 'DELETE' },
    ),

  /**
   * Professional context on one person before a call. Reads the company's own
   * public pages; every item carries the page it came from.
   */
  buildProfile: (fullName: string, companyDomain: string) =>
    request<ProspectProfile>('/api/prospecting/profile', {
      method: 'POST',
      body: JSON.stringify({ fullName, companyDomain }),
    }),

  // ---- Live crew positions ----
  locationSharing: () =>
    request<{ sharing: boolean; shareWindow: string; decidedAt: string | null }>(
      '/api/locations/sharing',
      { method: 'GET' },
    ),

  /** The person's own decision. Turning it off erases what was collected. */
  setLocationSharing: (sharing: boolean, shareWindow?: 'always' | 'shift') =>
    request<{ sharing: boolean; erased?: number }>('/api/locations/sharing', {
      method: 'PUT',
      body: JSON.stringify({ sharing, shareWindow }),
    }),

  pingLocation: (fix: {
    lat: number;
    lon: number;
    accuracy?: number | null;
    heading?: number | null;
    speed?: number | null;
  }) =>
    request<{ recorded: boolean }>('/api/locations/ping', {
      method: 'POST',
      body: JSON.stringify(fix),
    }),

  crewPositions: () =>
    request<{ items: CrewPosition[]; sharing: number }>('/api/locations/crew', { method: 'GET' }),

  nearestCrew: (lat: number, lon: number) =>
    request<{ items: Array<{ userId: string; name: string; miles: number; capturedAt: string }> }>(
      `/api/locations/nearest?lat=${lat}&lon=${lon}`,
      { method: 'GET' },
    ),

  // ---- Sending ----
  mailStatus: () => request<MailStatus>('/api/sales/mail', { method: 'GET' }),

  connectMailbox: (system: 'google_mail' | 'microsoft_mail') =>
    request<{ url: string }>(`/api/sales/mail/${system}/connect`, { method: 'POST' }),

  completeMailbox: (system: string, code: string, state: string) =>
    request<{ connected: boolean; address: string; provider: string }>(
      `/api/sales/mail/${system}/callback`,
      { method: 'POST', body: JSON.stringify({ code, state }) },
    ),

  disconnectMailbox: (system: string) =>
    request<{ disconnected: boolean }>(`/api/sales/mail/${system}`, { method: 'DELETE' }),

  saveSendPolicy: (policy: Partial<SendPolicy>) =>
    request<{ policy: SendPolicy }>('/api/sales/send-policy', {
      method: 'PUT',
      body: JSON.stringify(policy),
    }),

  /** Dry run unless confirm is true. Preview and send share one screening path. */
  sendCampaign: (id: string, options: { confirm?: boolean; event?: string; area?: string } = {}) =>
    request<SendPreview>(`/api/sales/campaigns/${id}/send`, {
      method: 'POST',
      body: JSON.stringify(options),
    }),

  forecast: (lat: number, lon: number, hourly = false) =>
    request<Forecast>(
      `/api/sales/forecast?lat=${lat}&lon=${lon}${hourly ? '&hourly=1' : ''}`,
      { method: 'GET' },
    ),

  // ---- Places: the buildings worth selling to ----
  placeCategories: () =>
    request<{ categories: PlaceCategory[]; attribution: string }>('/api/sales/place-categories', {
      method: 'GET',
    }),

  searchPlaces: (area: string, categories: string[], limit?: number) =>
    request<{
      places: FoundPlace[];
      box: { displayName: string } | null;
      note: string | null;
      attribution: string;
    }>('/api/sales/places/search', {
      method: 'POST',
      body: JSON.stringify({ area, categories, limit }),
    }),

  importPlaces: (places: FoundPlace[], territoryId?: string | null) =>
    request<{ imported: number }>('/api/sales/places/import', {
      method: 'POST',
      body: JSON.stringify({ places, territoryId }),
    }),

  // ---- Weather ----
  weatherGroups: () =>
    request<{ groups: WeatherGroup[]; attribution: string }>('/api/sales/weather/events', {
      method: 'GET',
    }),

  /**
   * Live alerts across every state your territories touch — derived from
   * their ZIP codes, so coverage is national with nothing to configure.
   * `state` overrides that to look somewhere you do not yet work.
   */
  activeWeather: (state?: string) =>
    request<{
      alerts: WeatherAlert[];
      attribution: string;
      statesWatched: string[];
      zipsLocated: number;
      zipsTotal: number;
    }>(`/api/sales/weather/active${state ? `?state=${encodeURIComponent(state)}` : ''}`, {
      method: 'GET',
    }),

  /** Dry run: what would fire right now, what would not, and why. Sends nothing. */
  pendingCampaigns: () =>
    request<{
      fire: Array<{
        campaignId: string;
        campaignName: string;
        reason: string;
        matchedZips?: string[];
        matchedBy?: string;
      }>;
      skip: Array<{ campaignId: string; campaignName: string; reason: string }>;
      alertsSeen: number;
    }>('/api/sales/campaigns/pending', { method: 'GET' }),

  campaignAudience: (id: string) =>
    request<{ members: AudienceMember[]; total: number; contacts: number; places: number }>(
      `/api/sales/campaigns/${id}/audience`,
      { method: 'GET' },
    ),

  // ---- Delivery, seen from Sales ----
  salesWork: (scope: 'mine' | 'all' = 'mine') =>
    request<SalesWorkResponse>(`/api/sales/work?scope=${scope}`, { method: 'GET' }),

  salesWorkJob: (jobId: string) =>
    request<SalesWorkDetail>(`/api/sales/work/${jobId}`, { method: 'GET' }),

  sendJobUpdate: (
    jobId: string,
    input: { to: string; subject: string; body: string; confirm?: boolean },
  ) =>
    request<{
      dryRun?: boolean;
      wouldSend?: number;
      sent?: number;
      blocked: Array<{ email: string; reason: string }>;
      warnings?: string[];
      from?: string;
      error?: string | null;
    }>(`/api/sales/work/${jobId}/update`, { method: 'POST', body: JSON.stringify(input) }),

  outreachPeople: () =>
    request<OutreachResponse>('/api/sales/communications', { method: 'GET' }),

  outreachHistory: (email: string) =>
    request<OutreachHistory>(`/api/sales/communications/${encodeURIComponent(email)}`, {
      method: 'GET',
    }),

  // ---- The shared job record ----
  sharedJobs: () =>
    request<{ jobs: SharedJobSummary[]; counts: { jobs: number; parties: number; blockers: number; awaiting: number } }>(
      '/api/operations/shared',
      { method: 'GET' },
    ),

  sharedJob: (jobId: string) =>
    request<SharedJobRecord>(`/api/operations/shared/${jobId}`, { method: 'GET' }),

  addJobParty: (
    jobId: string,
    input: { company: string; trade?: string | null; contactName?: string | null; email?: string | null; role?: string },
  ) =>
    request<{ party: JobParty }>(`/api/operations/shared/${jobId}/parties`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  jobPartyLink: (jobId: string, partyId: string) =>
    request<{ company: string; path: string }>(
      `/api/operations/shared/${jobId}/parties/${partyId}/link`,
      { method: 'GET' },
    ),

  revokeJobParty: (jobId: string, partyId: string) =>
    request<{ ok: boolean }>(`/api/operations/shared/${jobId}/parties/${partyId}/revoke`, {
      method: 'POST',
    }),

  publishJobBrief: (jobId: string, input: { facts?: Record<string, string>; note?: string | null }) =>
    request<{ brief: { revision: number }; acceptanceLapsedFor: number }>(
      `/api/operations/shared/${jobId}/brief`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  addJobScope: (
    jobId: string,
    input: { title: string; detail?: string | null; state?: ScopeState; amount?: number | null; reason?: string | null; partyId?: string | null },
  ) =>
    request<{ item: JobScopeItem }>(`/api/operations/shared/${jobId}/scope`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  decideJobScope: (
    jobId: string,
    itemId: string,
    input: { decision: 'approved' | 'declined'; amount?: number | null; reason?: string | null },
  ) =>
    request<{ item: JobScopeItem }>(`/api/operations/shared/${jobId}/scope/${itemId}/decide`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  postJobMessage: (jobId: string, input: { body: string; scopeItemId?: string | null; isDecision?: boolean }) =>
    request<{ message: { id: string } }>(`/api/operations/shared/${jobId}/messages`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // ---- Invitations ----
  orgInvites: () => request<{ invites: OrgInvite[] }>('/api/org/invites', { method: 'GET' }),

  createOrgInvite: (input: { email: string; role?: MemberRole; note?: string }) =>
    request<{ invite: OrgInvite; emailed: boolean; joinCode: string }>('/api/org/invites', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  revokeOrgInvite: (id: string) =>
    request<{ ok: boolean }>(`/api/org/invites/${id}/revoke`, { method: 'POST' }),

  // ---- Purchasing ----
  purchasingSources: () =>
    request<{ sources: TakeoffSource[] }>('/api/purchasing/sources', { method: 'GET' }),

  purchasingTakeoff: (estimateId: string) =>
    request<{ source: TakeoffSource; takeoff: TakeoffResult }>('/api/purchasing/takeoff', {
      method: 'POST',
      body: JSON.stringify({ estimateId }),
    }),

  purchaseOrders: () =>
    request<{ orders: PurchaseOrder[] }>('/api/purchasing/orders', { method: 'GET' }),

  purchaseOrder: (id: string) =>
    request<{
      order: PurchaseOrder;
      lines: PurchaseOrderLine[];
      estTotal: number;
      events: PurchaseOrderEvent[];
    }>(`/api/purchasing/orders/${id}`, { method: 'GET' }),

  createPurchaseOrder: (input: {
    estimateId?: string | null;
    jobName: string;
    claimNumber?: string | null;
    supplier: SupplierId;
    note?: string | null;
    lines: Array<{
      materialKey: string;
      description: string;
      detail?: string | null;
      quantity: number;
      unit: string;
      unitPrice?: number | null;
      sourceSummary?: string | null;
    }>;
  }) =>
    request<{ order: PurchaseOrder }>('/api/purchasing/orders', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  approvePurchaseOrder: (id: string) =>
    request<{ order: PurchaseOrder }>(`/api/purchasing/orders/${id}/approve`, { method: 'POST' }),

  reopenPurchaseOrder: (id: string) =>
    request<{ order: PurchaseOrder }>(`/api/purchasing/orders/${id}/reopen`, { method: 'POST' }),

  placePurchaseOrder: (id: string, reference?: string) =>
    request<{ order: PurchaseOrder }>(`/api/purchasing/orders/${id}/place`, {
      method: 'POST',
      body: JSON.stringify({ reference: reference || undefined }),
    }),

  cancelPurchaseOrder: (id: string) =>
    request<{ order: PurchaseOrder }>(`/api/purchasing/orders/${id}/cancel`, { method: 'POST' }),

  purchasingSuppliers: () =>
    request<{ suppliers: SupplierStatus[] }>('/api/purchasing/suppliers', { method: 'GET' }),

  connectSupplier: (id: 'home_depot' | 'lowes', fields: Record<string, string>, accountLabel?: string) =>
    request<{ ok: boolean }>(`/api/purchasing/suppliers/${id}/connect`, {
      method: 'POST',
      body: JSON.stringify({ fields, accountLabel }),
    }),

  disconnectSupplier: (id: 'home_depot' | 'lowes') =>
    request<{ ok: boolean }>(`/api/purchasing/suppliers/${id}`, { method: 'DELETE' }),

  // ---- Account structure ----
  accountStructure: (accountId: string) =>
    request<AccountStructure>(`/api/crm/accounts/${accountId}/structure`, { method: 'GET' }),

  setAccountParent: (accountId: string, parentAccountId: string | null) =>
    request<{ ok: boolean }>(`/api/crm/accounts/${accountId}/parent`, {
      method: 'PATCH',
      body: JSON.stringify({ parentAccountId }),
    }),

  linkAccounts: (
    accountId: string,
    input: { toAccountId: string; kind: string; note?: string | null; startedOn?: string | null },
  ) =>
    request<{ id: string }>(`/api/crm/accounts/${accountId}/links`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  endAccountLink: (linkId: string) =>
    request<{ ok: boolean }>(`/api/crm/accounts/links/${linkId}/end`, { method: 'POST' }),

  addAccountPerson: (
    accountId: string,
    input: { contactId: string; role?: string; isPrimary?: boolean },
  ) =>
    request<{ ok: boolean }>(`/api/crm/accounts/${accountId}/people`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  duplicateAccounts: () =>
    request<{ pairs: DuplicatePair[] }>('/api/crm/accounts/duplicates', { method: 'GET' }),

  /** Without `confirm` this changes nothing and reports what would move. */
  mergeAccounts: (input: { winnerId: string; loserId: string; confirm?: boolean }) =>
    request<{
      dryRun: boolean;
      moved: Record<string, number>;
      total: number;
      winner?: { id: string; name: string };
      loser?: { id: string; name: string };
    }>('/api/crm/accounts/merge', { method: 'POST', body: JSON.stringify(input) }),

  // ---- Proof of work ----
  jobProofs: (jobId: string) =>
    request<ProofResponse>(`/api/operations/shared/${jobId}/proof`, { method: 'GET' }),

  decideProofDay: (
    jobId: string,
    workDate: string,
    input: { partyId: string; decision: 'accepted' | 'rejected'; note?: string },
  ) =>
    request<{ ok: boolean }>(`/api/operations/shared/${jobId}/proof/${workDate}/decide`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  askAboutProofs: (jobId: string, question: string) =>
    request<{ answer: string; groundedOn: number; question: ProofQuestion }>(
      `/api/operations/shared/${jobId}/proof/ask`,
      { method: 'POST', body: JSON.stringify({ question }) },
    ),

  proofQuestions: (jobId: string) =>
    request<{ questions: ProofQuestion[] }>(`/api/operations/shared/${jobId}/proof/questions`, {
      method: 'GET',
    }),

  jobEvidence: (jobId: string) =>
    request<{ items: EvidenceItem[]; counts: { items: number; onHold: number; neverViewed: number } }>(
      `/api/operations/shared/${jobId}/evidence`,
      { method: 'GET' },
    ),

  evidenceCustody: (jobId: string, proofId: string) =>
    request<{ entries: CustodyEntry[] }>(
      `/api/operations/shared/${jobId}/evidence/${proofId}/custody`,
      { method: 'GET' },
    ),

  setEvidenceHold: (jobId: string, proofId: string, input: { hold: boolean; reason?: string }) =>
    request<{ ok: boolean }>(`/api/operations/shared/${jobId}/evidence/${proofId}/hold`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  evidenceShares: (jobId?: string, kind?: 'evidence' | 'progress') =>
    request<{ shares: EvidenceShare[] }>(
      `/api/evidence-portal/shares${jobId || kind ? `?${new URLSearchParams({
        ...(jobId ? { jobId } : {}),
        ...(kind ? { kind } : {}),
      }).toString()}` : ''}`,
      { method: 'GET' },
    ),

  createEvidenceShare: (input: {
    jobId: string;
    label: string;
    recipientEmail: string;
    expiresInDays?: number;
  }) =>
    request<CreateEvidenceShareResult>('/api/evidence-portal/shares', {
      method: 'POST',
      body: JSON.stringify({ ...input, kind: 'evidence' }),
    }),

  createProgressShare: (input: {
    jobId: string;
    label: string;
    recipientEmail?: string;
    expiresInDays?: number;
  }) =>
    request<CreateEvidenceShareResult>('/api/evidence-portal/shares', {
      method: 'POST',
      body: JSON.stringify({ ...input, kind: 'progress' }),
    }),

  progressShareGuest: (token: string) =>
    request<ProgressShareGuestView>(`/api/progress-share/${encodeURIComponent(token)}`, {
      method: 'GET',
    }),

  progressShareVideo: (token: string, proofId: string) =>
    request<{ url: string; expiresInSeconds: number }>(
      `/api/progress-share/${encodeURIComponent(token)}/proof/${encodeURIComponent(proofId)}/video`,
      { method: 'GET' },
    ),

  revokeEvidenceShare: (id: string) =>
    request<{ ok: boolean }>(`/api/evidence-portal/shares/${id}/revoke`, { method: 'POST' }),

  // ---- Scope documents ----
  scopeDocument: (jobId: string) =>
    request<{ doc: ScopeDocument | null }>(`/api/operations/shared/${jobId}/scope-doc`, {
      method: 'GET',
    }),

  uploadScopeDocument: (
    jobId: string,
    input: { filename: string; mediaType: 'application/pdf' | 'text/plain'; contentBase64: string },
  ) =>
    request<{ doc: ScopeDocument }>(`/api/operations/shared/${jobId}/scope-doc`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  confirmScopeDocument: (
    jobId: string,
    docId: string,
    input: { lines: Array<{ title: string; state: 'included' | 'excluded'; reason?: string | null; amount?: number | null }> },
  ) =>
    request<{ ok: boolean; created: number }>(
      `/api/operations/shared/${jobId}/scope-doc/${docId}/confirm`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  // ---- Job intake and readiness ----
  jobReadiness: (jobId: string) =>
    request<{ readiness: JobReadiness }>(`/api/operations/jobs/${jobId}/readiness`, {
      method: 'GET',
    }),

  quickStartJob: (input: {
    title: string;
    workType?: 'mitigation' | 'construction';
    address: string;
    city?: string;
    postalCode?: string;
    scheduledStart?: string;
    scope?: Array<{ title: string; state: 'included' | 'excluded'; reason?: string }>;
  }) =>
    request<{
      job: { id: string; title: string; jobNumber: number | null };
      scopeSaved: number;
      readiness: JobReadiness;
    }>('/api/operations/jobs/quick-start', { method: 'POST', body: JSON.stringify(input) }),

  proposeIntake: (input: { text: string }) =>
    request<{ proposal: IntakeProposal; captureTeam: CaptureTeamMember[] }>(
      '/api/operations/intake/propose',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),

  approveIntake: (input: IntakeApproveInput) =>
    request<IntakeApproveResult>('/api/operations/intake/approve', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  intakeMix: () =>
    request<{ counts: Record<IntakeSource, number>; total: number }>('/api/operations/intake-mix', {
      method: 'GET',
    }),

  // ---- The subcontractor's own list ----
  // These carry a session the sub holds rather than an org cookie, because a
  // sub has no seat in any of the organizations whose jobs they can see.
  fieldClaimStart: (input: { token: string; contact: string }) =>
    request<{ sentTo: string; channel: 'sms' | 'email'; delivered: boolean; deliveryNote: string | null }>(
      '/api/field/claim/start',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  fieldClaimVerify: (input: { token: string; contact: string; code: string }) =>
    request<FieldJobList & { session: string }>('/api/field/claim/verify', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  fieldJobs: (session: string) =>
    request<FieldJobList>('/api/field/jobs', {
      method: 'GET',
      headers: { Authorization: `Bearer ${session}` },
    }),

  fieldSignOut: (session: string) =>
    request<{ ok: boolean }>('/api/field/signout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session}` },
    }),

  // ---- Org Field Capture (same seat as the dashboard / iPhone app) ----
  // Always scoped to the caller's company — never other orgs' jobs.
  fieldAppTodayJobs: () =>
    request<{ jobs: FieldAppJob[]; org: FieldAppOrgRef }>('/api/field-app/today', {
      method: 'GET',
    }),

  fieldAppSearchJobs: (q: string, limit = 30) => {
    const params = new URLSearchParams({ q, limit: String(limit) });
    return request<{ jobs: FieldAppJob[]; q: string; org: FieldAppOrgRef }>(
      `/api/field-app/jobs/search?${params.toString()}`,
      { method: 'GET' },
    );
  },

  fieldAppCaptureLink: (jobId: string) =>
    request<FieldAppCaptureLink>(`/api/field-app/jobs/${encodeURIComponent(jobId)}/capture-link`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  // ---- CRM job sync ----
  crmSyncStatus: () => request<CrmSyncStatus>('/api/crm-sync/status', { method: 'GET' }),

  connectCrmSync: (input: { system: CrmSyncSystem; apiKey: string }) =>
    request<{ status: string; system: CrmSyncSystem; accountLabel: string }>(
      '/api/crm-sync/connect',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  disconnectCrmSync: (system: CrmSyncSystem) =>
    request<{ ok: boolean }>('/api/crm-sync/disconnect', {
      method: 'POST',
      body: JSON.stringify({ system }),
    }),

  runCrmSync: (system: CrmSyncSystem) =>
    request<{ summary: CrmSyncSummary }>('/api/crm-sync/sync', {
      method: 'POST',
      body: JSON.stringify({ system }),
    }),

  crmSyncConflicts: () =>
    request<{ conflicts: CrmSyncConflict[] }>('/api/crm-sync/conflicts', { method: 'GET' }),

  resolveCrmSyncConflict: (linkId: string, decision: 'accept_new_address' | 'keep_current') =>
    request<{ ok: boolean }>(`/api/crm-sync/conflicts/${linkId}`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    }),

  liveObserve: (
    jobId: string,
    input: { phase: 'before' | 'after'; frameBase64: string; lastStageIndex?: number | null },
  ) =>
    request<LiveStageObservation>(`/api/operations/shared/${jobId}/live-observe`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  captureGuide: (jobId: string, phase: 'before' | 'after', partyId?: string) =>
    request<{ guide: CaptureGuide }>(
      `/api/operations/shared/${jobId}/capture-guide?phase=${phase}${partyId ? `&partyId=${partyId}` : ''}`,
      { method: 'GET' },
    ),

  reanalyseProofDay: (jobId: string, workDate: string, partyId: string) =>
    request<{ summary: string | null; findings: unknown; model: string | null }>(
      `/api/operations/shared/${jobId}/proof/${workDate}/analyse`,
      { method: 'POST', body: JSON.stringify({ partyId }) },
    ),

  proofVideoUrl: (proofId: string) =>
    request<{ url: string; expiresInSeconds: number }>(
      `/api/operations/shared/proof/${proofId}/video`,
      { method: 'GET' },
    ),

  // ---- Territories ----
  territories: () => request<{ items: Territory[] }>('/api/sales/territories', { method: 'GET' }),

  territoryMap: () =>
    request<TerritoryMapResponse>('/api/sales/territories/map', { method: 'GET' }),

  createTerritory: (input: Partial<Territory> & { name: string }) =>
    request<{ item: Territory }>('/api/sales/territories', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateTerritory: (id: string, input: Partial<Territory>) =>
    request<{ item: Territory }>(`/api/sales/territories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteTerritory: (id: string) =>
    request<{ ok: boolean }>(`/api/sales/territories/${id}`, { method: 'DELETE' }),

  // ---- Campaigns ----
  campaigns: () => request<{ items: Campaign[] }>('/api/sales/campaigns', { method: 'GET' }),

  createCampaign: (input: { name: string } & Partial<Campaign>) =>
    request<{ item: Campaign }>('/api/sales/campaigns', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateCampaign: (id: string, input: Partial<Campaign>) =>
    request<{ item: Campaign }>(`/api/sales/campaigns/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteCampaign: (id: string) =>
    request<{ ok: boolean }>(`/api/sales/campaigns/${id}`, { method: 'DELETE' }),

  campaignMembers: (id: string) =>
    request<{ items: CampaignMember[] }>(`/api/sales/campaigns/${id}/members`, { method: 'GET' }),

  addCampaignMember: (id: string, input: { contactId?: string; prospectId?: string; note?: string }) =>
    request<{ item: CampaignMember }>(`/api/sales/campaigns/${id}/members`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  setCampaignMemberStatus: (id: string, memberId: string, status: CampaignMemberStatus) =>
    request<{ item: CampaignMember }>(`/api/sales/campaigns/${id}/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  networkSettings: () =>
    request<{ contributing: boolean; decidedAt: string | null; enabled: boolean }>(
      '/api/prospecting/network',
      { method: 'GET' },
    ),

  /**
   * Opt in or out. Opting out withdraws every row this org ever contributed —
   * an opt-out that left them in the pool would not be one.
   */
  setNetworkContribution: (contributing: boolean) =>
    request<{ contributing: boolean; withdrawn: number }>('/api/prospecting/network', {
      method: 'PUT',
      body: JSON.stringify({ contributing }),
    }),

  contributeToNetwork: () =>
    request<{ contributed: number; considered: number }>('/api/prospecting/network/contribute', {
      method: 'POST',
    }),

  prospects: () => request<{ items: Prospect[] }>('/api/prospecting/prospects', { method: 'GET' }),

  /** Erasure. Suppresses the person by default so a search cannot re-add them. */
  deleteProspect: (id: string, suppress = true) =>
    request<{ ok: boolean; suppressed: boolean }>(
      `/api/prospecting/prospects/${id}?suppress=${suppress}`,
      { method: 'DELETE' },
    ),

  /** Turns a revealed prospect into a contact and a lead. */
  prospectImport: (prospectId: string, overrides: { title?: string; estimatedValue?: number | null } = {}) =>
    request<{ contact: CrmContact; lead: CrmLead }>('/api/prospecting/import', {
      method: 'POST',
      body: JSON.stringify({ prospectId, ...overrides }),
    }),

  suppressions: () =>
    request<{ items: Suppression[] }>('/api/prospecting/suppressions', { method: 'GET' }),

  addSuppression: (input: { kind: Suppression['kind']; value: string; reason?: string }) =>
    request<{ item: Suppression }>('/api/prospecting/suppressions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  removeSuppression: (id: string) =>
    request<{ ok: boolean }>(`/api/prospecting/suppressions/${id}`, { method: 'DELETE' }),

  crmContacts: (search = '') =>
    request<CrmList<CrmContact>>(
      `/api/crm/contacts${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      { method: 'GET' },
    ),

  // ---- Audit ----
  auditAgents: () => request<{ agents: AgentSummary[] }>('/api/audit/agents', { method: 'GET' }),

  auditStats: () => request<{ stats: AuditStats }>('/api/audit/stats', { method: 'GET' }),

  auditRuns: (filters: AuditRunFilters = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    const query = params.toString();
    return request<{ runs: AuditRun[]; nextCursor: string | null }>(
      `/api/audit/runs${query ? `?${query}` : ''}`,
      { method: 'GET' },
    );
  },

  /**
   * One run and its trace. `afterSeq` fetches only steps past the ones already
   * held, so tailing a running agent stays cheap however long it runs.
   */
  auditRun: (id: string, afterSeq = 0) =>
    request<{ run: AuditRun; steps: AuditStep[]; moreSteps: boolean }>(
      `/api/audit/runs/${id}${afterSeq > 0 ? `?afterSeq=${afterSeq}` : ''}`,
      { method: 'GET' },
    ),
  // ---- Jobs ----
  getJobs: (params: { status?: string; q?: string; mine?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.q) qs.set('q', params.q);
    if (params.mine) qs.set('mine', '1');
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<{ jobs: JobSummary[] }>(`/api/jobs${suffix}`, { method: 'GET' });
  },

  createJob: (input: CreateJobInput) =>
    request<{ job: Job }>('/api/jobs', { method: 'POST', body: JSON.stringify(input) }),

  getJob: (id: string) => request<JobDetail>(`/api/jobs/${id}`, { method: 'GET' }),

  updateJob: (id: string, patch: Partial<CreateJobInput>) =>
    request<{ job: Job }>(`/api/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  getJobMemory: (id: string) =>
    request<{ events: MemoryEvent[] }>(`/api/jobs/${id}/memory`, { method: 'GET' }),

  // ---- Tasks ----
  createTask: (jobId: string, input: CreateTaskInput) =>
    request<{ task: JobTask }>(`/api/jobs/${jobId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // ---- Technician app ----
  technicianCapabilities: () =>
    request<TechnicianCapabilities>('/api/technician/capabilities', { method: 'GET' }),

  assist: (message: string, history: AssistantTurn[], context?: AssistantContext) =>
    request<AssistantReply>('/api/technician/assist', {
      method: 'POST',
      body: JSON.stringify({ message, history, context }),
    }),

  /**
   * Server-side transcription for browsers with no usable SpeechRecognition.
   * The clip goes up as the raw request body — `request()` is bypassed because
   * it hard-codes a JSON content type.
   */
  transcribe: async (clip: Blob): Promise<{ text: string }> => {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/technician/transcribe`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': clip.type || 'audio/webm' },
        body: clip,
      });
    } catch {
      throw new ApiError(0, 'Network error — is the backend running?', 'network_error');
    }

    const text = await res.text();
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      throw new ApiError(
        res.status,
        (body.error as string) ?? `Transcription failed (${res.status})`,
        (body.code as string) ?? 'error',
      );
    }
    return body as { text: string };
  },
  // ---- Billing ----
  getCatalog: () => request<Catalog>('/api/billing/catalog', { method: 'GET' }),

  getBillingOverview: () => request<BillingOverview>('/api/billing/overview', { method: 'GET' }),

  setPlan: (planCode: PlanCode, billingInterval: BillingInterval = 'monthly', seats = 1) =>
    request<SetPlanResult>('/api/billing/plan', {
      method: 'POST',
      body: JSON.stringify({ planCode, billingInterval, seats }),
    }),

  updateBillingSettings: (patch: BillingSettingsPatch) =>
    request<{ settings: BillingSettings }>('/api/billing/settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  getLedger: (limit = 50) =>
    request<{ entries: LedgerEntry[] }>(`/api/billing/ledger?limit=${limit}`, { method: 'GET' }),

  getPurchases: () => request<{ purchases: Purchase[] }>('/api/billing/purchases', { method: 'GET' }),

  startPurchase: (input: { packCode?: string; amountCents?: number }) =>
    request<{ purchase: Purchase; checkoutUrl: string | null; requiresConfirmation: boolean }>(
      '/api/billing/purchases',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  /** Hosted Stripe Checkout for a paid plan. */
  startSubscriptionCheckout: (
    planCode: PlanCode,
    billingInterval: BillingInterval = 'monthly',
    seats = 1,
  ) =>
    request<{ checkoutUrl: string | null }>('/api/billing/checkout/subscription', {
      method: 'POST',
      body: JSON.stringify({ planCode, billingInterval, seats }),
    }),

  /** Stripe's hosted portal: cards, invoices and cancellation. */
  openBillingPortal: () =>
    request<{ portalUrl: string }>('/api/billing/portal', { method: 'POST' }),

  getBillingOnboarding: () =>
    request<BillingOnboardingStatus>('/api/billing/onboarding', { method: 'GET' }),

  startOnboardingCheckout: (returnPath?: string) =>
    request<{ checkoutUrl: string | null }>('/api/billing/checkout/onboarding', {
      method: 'POST',
      body: JSON.stringify(returnPath ? { returnPath } : {}),
    }),

  getPayments: (limit = 50) =>
    request<{ payments: Payment[] }>(`/api/billing/payments?limit=${limit}`, { method: 'GET' }),

  confirmPurchase: (purchaseId: string) =>
    request<{ purchaseId: string; status: string; creditedNanos: number; balance: CreditBalance }>(
      `/api/billing/purchases/${purchaseId}/confirm`,
      { method: 'POST' },
    ),

  // ---- Usage ----
  quoteUsage: (input: UsageTokens) =>
    request<UsageQuote>('/api/usage/quote', { method: 'POST', body: JSON.stringify(input) }),

  recordUsage: (input: UsageTokens & { requestId: string; feature?: string }) =>
    request<RecordUsageResult>('/api/usage/record', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // ---- Project Manager Agent ----
  pmOverview: () => request<PmOverview>('/api/pm/overview', { method: 'GET' }),

  pmProject: (id: string) => request<PmProjectDetail>(`/api/pm/projects/${id}`, { method: 'GET' }),

  pmCreateProject: (input: Record<string, unknown>) =>
    request<{ project: PmProject; seeded: PmSeedResult }>('/api/pm/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  pmUpdateProject: (id: string, patch: Record<string, unknown>) =>
    request<{ project: PmProject }>(`/api/pm/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  pmRun: (projectId?: string) =>
    request<{ result: PmEngineResult }>('/api/pm/run', {
      method: 'POST',
      body: JSON.stringify(projectId ? { projectId } : {}),
    }),

  pmAlertAction: (id: string, status: string, snoozeHours?: number) =>
    request<{ alert: PmAlert }>(`/api/pm/alerts/${id}`, {
      method: 'POST',
      body: JSON.stringify(snoozeHours ? { status, snoozeHours } : { status }),
    }),

  pmCreateTask: (projectId: string, input: Record<string, unknown>) =>
    request<{ task: PmTask }>(`/api/pm/projects/${projectId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  pmUpdateTask: (id: string, patch: Record<string, unknown>) =>
    request<{ task: PmTask }>(`/api/pm/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  pmCreateArea: (projectId: string, input: Record<string, unknown>) =>
    request<{ area: PmDryingArea }>(`/api/pm/projects/${projectId}/areas`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  pmCreateReadings: (projectId: string, readings: Record<string, unknown>[]) =>
    request<{ readings: PmReading[] }>(`/api/pm/projects/${projectId}/readings`, {
      method: 'POST',
      body: JSON.stringify({ readings }),
    }),

  pmUpdateDocument: (id: string, patch: Record<string, unknown>) =>
    request<{ document: PmDocument }>(`/api/pm/documents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  pmEquipment: () =>
    request<{ equipment: PmEquipment[]; placements: PmPlacement[] }>('/api/pm/equipment', {
      method: 'GET',
    }),

  pmPlaceEquipment: (projectId: string, input: Record<string, unknown>) =>
    request<{ placement: PmPlacement }>(`/api/pm/projects/${projectId}/equipment`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  pmRemovePlacement: (id: string) =>
    request<{ placement: PmPlacement }>(`/api/pm/placements/${id}/remove`, { method: 'POST' }),

  pmAssignCrew: (projectId: string, input: Record<string, unknown>) =>
    request<{ assignment: PmAssignment }>(`/api/pm/projects/${projectId}/crew`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  pmBrief: (refresh = false) =>
    request<{ brief: PmBrief; writingEnabled: boolean }>(
      `/api/pm/brief${refresh ? '?refresh=true' : ''}`,
      { method: 'GET' },
    ),

  pmDraftUpdate: (projectId: string, audience: string, instruction?: string) =>
    request<{ update: PmUpdate }>(`/api/pm/projects/${projectId}/updates`, {
      method: 'POST',
      body: JSON.stringify(instruction ? { audience, instruction } : { audience }),
    }),

  pmUpdateDraft: (id: string, status: string) =>
    request<{ update: PmUpdate }>(`/api/pm/updates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  pmSettings: () => request<PmSettingsResponse>('/api/pm/settings', { method: 'GET' }),

  pmUpdateSettings: (patch: Record<string, unknown>) =>
    request<{ settings: PmSettings }>('/api/pm/settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  pmSituation: (projectId?: string) =>
    request<PmSituation>(
      `/api/pm/situation${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`,
      { method: 'GET' },
    ),

  pmApprovals: (status = 'pending') =>
    request<{ approvals: PmApproval[] }>(
      `/api/pm/approvals?status=${encodeURIComponent(status)}`,
      { method: 'GET' },
    ),

  pmDecideApproval: (id: string, decision: 'approved' | 'rejected', note?: string) =>
    request<{ approval: PmApproval }>(`/api/pm/approvals/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify(note ? { decision, note } : { decision }),
    }),

  pmCommunications: (status?: string) =>
    request<{ communications: PmCommunication[] }>(
      `/api/pm/communications${status ? `?status=${encodeURIComponent(status)}` : ''}`,
      { method: 'GET' },
    ),

  pmUpdateCommunication: (id: string, patch: Record<string, unknown>) =>
    request<{ communication: PmCommunication }>(`/api/pm/communications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  pmPlatforms: () =>
    request<{
      catalogue: { platform: string; label: string; description: string }[];
      connections: PmPlatformConnection[];
    }>('/api/pm/platforms', { method: 'GET' }),

  pmConnectPlatform: (input: Record<string, unknown>) =>
    request<{ connection: PmPlatformConnection }>('/api/pm/platforms/connect', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  pmProcurement: (projectId?: string) =>
    request<{ requests: PmProcurementRequest[] }>(
      `/api/pm/procurement${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`,
      { method: 'GET' },
    ),

  pmProcurementBids: (id: string) =>
    request<{ request: PmProcurementRequest; bids: PmProcurementBid[] }>(
      `/api/pm/procurement/${id}/bids`,
      { method: 'GET' },
    ),

  pmSelectBid: (requestId: string, bidId: string) =>
    request<{ request: PmProcurementRequest; approvalId: string }>(
      `/api/pm/procurement/${requestId}/select-bid`,
      { method: 'POST', body: JSON.stringify({ bidId }) },
    ),

  pmReferrals: () =>
    request<{ referrals: PmVendorReferral[] }>('/api/pm/procurement/referrals', {
      method: 'GET',
    }),

  pmDeriveEquipmentPlan: (projectId: string, input: Record<string, unknown>) =>
    request<{
      plan: PmEquipmentPlan;
      items: PmEquipmentPlanItem[];
      derived: { summary: string; dumpsterRequired: boolean };
    }>(`/api/pm/projects/${projectId}/equipment-plan`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  pmDumpsterSearch: (projectId: string, input: Record<string, unknown> = {}) =>
    request<{ request: PmProcurementRequest; bids: PmProcurementBid[] }>(
      `/api/pm/projects/${projectId}/procurement/dumpster`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  pmMaterialReferral: (projectId: string, input: Record<string, unknown>) =>
    request<{ request: PmProcurementRequest; approvalId: string }>(
      `/api/pm/projects/${projectId}/procurement/materials`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  pmNetwork: () => request<PmNetworkSummary>('/api/pm/network', { method: 'GET' }),

  pmInvitePartner: (input: Record<string, unknown>) =>
    request<{ invite: PmPartnerInvite; inviteUrl: string; threadId: string | null }>(
      '/api/pm/network/invites',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  pmUpdatePartnerProfile: (patch: Record<string, unknown>) =>
    request<{ profile: PmPartnerProfile }>('/api/pm/network/profile', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  pmThreads: (status = 'open') =>
    request<{ threads: PmThread[] }>(
      `/api/pm/threads?status=${encodeURIComponent(status)}`,
      { method: 'GET' },
    ),

  pmThread: (id: string) =>
    request<{
      thread: PmThread;
      messages: PmThreadMessage[];
      participants: { id: string; userId: string | null; roleInThread: string }[];
    }>(`/api/pm/threads/${id}`, { method: 'GET' }),

  pmPostThreadMessage: (id: string, body: string) =>
    request<{ message: PmThreadMessage }>(`/api/pm/threads/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),

  pmCreateThread: (input: Record<string, unknown>) =>
    request<{ thread: PmThread }>('/api/pm/threads', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // ---- Financial Agent ----
  financeOverview: () => request<FinanceOverview>('/api/finance/overview', { method: 'GET' }),

  financeRun: (jobId?: string) =>
    request<{ result: FinanceEngineResult }>('/api/finance/run', {
      method: 'POST',
      body: JSON.stringify(jobId ? { jobId } : {}),
    }),

  financeBrief: (refresh = false) =>
    request<{ brief: FinanceBrief }>(`/api/finance/brief?refresh=${refresh ? 'true' : 'false'}`, {
      method: 'GET',
    }),

  financeAlertAction: (id: string, status: string, snoozeHours?: number) =>
    request<{ alert: FinanceAlert }>(`/api/finance/alerts/${id}`, {
      method: 'POST',
      body: JSON.stringify(snoozeHours ? { status, snoozeHours } : { status }),
    }),

  financeCreateConnection: (input: Record<string, unknown>) =>
    request<{ connection: FinanceConnection }>('/api/finance/connections', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  financeSyncConnection: (id: string) =>
    request<{
      connection: FinanceConnection;
      records: number;
      accountsUpdated: number;
    }>(`/api/finance/connections/${id}/sync`, { method: 'POST' }),

  financeCreateJobCost: (input: Record<string, unknown>) =>
    request<{ cost: FinanceJobCost }>('/api/finance/job-costs', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  financeCostCodes: () =>
    request<{ costCodes: FinanceCostCode[]; canManage: boolean }>('/api/finance/cost-codes', {
      method: 'GET',
    }),

  financeCreateAccount: (input: Record<string, unknown>) =>
    request<{ account: FinanceAccount }>('/api/finance/accounts', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  financeShares: () =>
    request<{ packages: FinanceSharePackage[]; canManage: boolean }>('/api/finance/shares', {
      method: 'GET',
    }),

  financeCreateShare: (input: Record<string, unknown>) =>
    request<{ package: FinanceSharePackage; link: FinanceShareLink | null }>('/api/finance/shares', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  financeShare: (id: string) =>
    request<{
      package: FinanceSharePackage;
      documents: FinanceShareDocument[];
      links: FinanceShareLink[];
      canManage: boolean;
    }>(`/api/finance/shares/${id}`, { method: 'GET' }),

  financePublishShare: (id: string, input: Record<string, unknown> = {}) =>
    request<{ package: FinanceSharePackage; link: FinanceShareLink }>(
      `/api/finance/shares/${id}/publish`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  financeRevokeShare: (id: string) =>
    request<{ package: FinanceSharePackage }>(`/api/finance/shares/${id}/revoke`, {
      method: 'POST',
    }),

  financeAddShareDocument: (id: string, input: Record<string, unknown>) =>
    request<{ document: FinanceShareDocument }>(`/api/finance/shares/${id}/documents`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  financeOpenPublicShare: (token: string) =>
    request<{ share: FinancePublicShare }>(`/api/finance/public/shares/${encodeURIComponent(token)}`, {
      method: 'GET',
    }),

// ---- HomeOwner Report portal (staff) ----
  portalProject: (projectId: string) =>
    request<PortalStaffView>(`/api/portal/projects/${projectId}`, { method: 'GET' }),

  portalCreateShare: (
    projectId: string,
    input: {
      label?: string | null;
      customerName?: string | null;
      customerEmail?: string | null;
      welcomeNote?: string | null;
      expiresAt?: string | null;
    } = {},
  ) =>
    request<{
      share: PortalShare;
      token: string;
      path: string;
      message: string;
    }>(`/api/portal/projects/${projectId}/shares`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  portalRevokeShare: (projectId: string, shareId: string) =>
    request<{ share: PortalShare }>(`/api/portal/projects/${projectId}/shares/${shareId}/revoke`, {
      method: 'POST',
    }),

  portalUpdateVisibility: (projectId: string, patch: Partial<PortalVisibility>) =>
    request<{ visibility: PortalVisibility }>(`/api/portal/projects/${projectId}/visibility`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  portalStaffReply: (
    projectId: string,
    conversationId: string,
    body: string,
    as: 'staff' | 'adjuster' = 'staff',
  ) =>
    request<{ message: PortalMessage; conversation: PortalConversation }>(
      `/api/portal/projects/${projectId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ conversationId, body, as }),
      },
    ),

  // ---- HomeOwner Report portal (guest) ----
  portalGuestReport: (token: string) =>
    request<{
      report: HomeownerReport;
      conversations: PortalConversation[];
      assistantEnabled: boolean;
    }>(`/api/portal/report/${encodeURIComponent(token)}`, { method: 'GET' }),

  portalGuestConversationMessages: (token: string, conversationId: string) =>
    request<{ conversation: PortalConversation; messages: PortalMessage[] }>(
      `/api/portal/report/${encodeURIComponent(token)}/conversations/${conversationId}/messages`,
      { method: 'GET' },
    ),

  portalGuestSendMessage: (token: string, conversationId: string, body: string, topic = 'general') =>
    request<{ message: PortalMessage; conversation: PortalConversation }>(
      `/api/portal/report/${encodeURIComponent(token)}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ conversationId, body, topic }),
      },
    ),

  portalGuestPolicies: (token: string) =>
    request<{ policies: PortalPolicyMeta[] }>(
      `/api/portal/report/${encodeURIComponent(token)}/policies`,
      { method: 'GET' },
    ),

  portalGuestUploadPolicy: (
    token: string,
    input: { fileName: string; mimeType?: string; contentText: string; byteSize?: number | null },
  ) =>
    request<{ policy: PortalPolicyMeta }>(
      `/api/portal/report/${encodeURIComponent(token)}/policies`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),

  portalGuestAsk: (
    token: string,
    question: string,
    history: { role: 'user' | 'assistant'; content: string }[] = [],
    conversationId?: string,
  ) =>
    request<{
      reply: string;
      model: string | null;
      conversationId: string;
      message: PortalMessage;
    }>(`/api/portal/report/${encodeURIComponent(token)}/ask`, {
      method: 'POST',
      body: JSON.stringify({ question, history, conversationId }),
    }),

  portalStaffConversationMessages: (projectId: string, conversationId: string) =>
    request<{ conversation: PortalConversation; messages: PortalMessage[] }>(
      `/api/portal/projects/${projectId}/conversations/${conversationId}/messages`,
      { method: 'GET' },
    ),

  // ---- Web Access ----
  webAccessStatus: () =>
    request<{ enabled: boolean; capacityAvailable: boolean; maxSteps: number }>(
      '/api/web-access/status',
      { method: 'GET' },
    ),

  getWebConnections: () =>
    request<{ connections: WebConnection[] }>('/api/web-access/connections', { method: 'GET' }),

  createWebConnection: (input: WebConnectionInput) =>
    request<{ connection: WebConnection }>('/api/web-access/connections', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateWebConnection: (id: string, input: Partial<WebConnectionInput>) =>
    request<{ connection: WebConnection }>(`/api/web-access/connections/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteWebConnection: (id: string) =>
    request<{ ok: boolean }>(`/api/web-access/connections/${id}`, { method: 'DELETE' }),

  verifyWebConnection: (id: string) =>
    request<{ ok: boolean; reason?: string }>(`/api/web-access/connections/${id}/verify`, {
      method: 'POST',
    }),

  startWebRun: (input: {
    connectionId: string;
    kind: WebRunKind;
    instruction: string;
    data?: unknown;
  }) =>
    request<{ run: WebRun }>('/api/web-access/runs', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  getWebRuns: () => request<{ runs: WebRun[] }>('/api/web-access/runs', { method: 'GET' }),

  getWebRun: (id: string) => request<{ run: WebRun }>(`/api/web-access/runs/${id}`, { method: 'GET' }),

  // ---- App Connectors ----
  getConnectorCatalog: (all = false) =>
    request<ConnectorCatalogResponse>(
      `/api/connectors/catalog${all ? '?all=1' : ''}`,
      { method: 'GET' },
    ),

  getAppConnections: () =>
    request<{ connections: AppConnectorConnection[] }>('/api/connectors/connections', {
      method: 'GET',
    }),

  connectAppConnector: (input: ConnectAppConnectorInput) =>
    request<{ connection: AppConnectorConnection }>('/api/connectors/connections', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateAppConnector: (id: string, input: { label?: string; notes?: string | null; status?: AppConnectorStatus }) =>
    request<{ connection: AppConnectorConnection }>(`/api/connectors/connections/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteAppConnector: (id: string, purge = true) =>
    request<{ ok: boolean }>(
      `/api/connectors/connections/${id}${purge ? '?purge=true' : ''}`,
      { method: 'DELETE' },
    ),

  startConnectorRun: (
    id: string,
    input: {
      templateId?: string;
      kind?: WebRunKind;
      instruction?: string;
      data?: unknown;
    },
  ) =>
    request<{ run: WebRun; workspace: string }>(`/api/connectors/connections/${id}/run`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // ---- Verifier ----
  verifierStatus: () =>
    request<{
      enabled: boolean;
      autoVerify: boolean;
      verifyPulls: boolean;
      maxRepairAttempts: number;
      pending: number;
      capacityAvailable: boolean;
    }>('/api/verifier/status', { method: 'GET' }),

  getVerifications: (runId?: string) =>
    request<{ verifications: Verification[] }>(
      `/api/verifier/verifications${runId ? `?runId=${encodeURIComponent(runId)}` : ''}`,
      { method: 'GET' },
    ),

  getVerification: (id: string) =>
    request<{ verification: Verification }>(`/api/verifier/verifications/${id}`, { method: 'GET' }),

  verifyRun: (runId: string) =>
    request<{ verificationId: string }>(`/api/verifier/runs/${runId}/verify`, { method: 'POST' }),

  getEscalations: (includeResolved = false) =>
    request<{ escalations: Escalation[] }>(
      `/api/verifier/escalations${includeResolved ? '?status=all' : ''}`,
      { method: 'GET' },
    ),

  resolveEscalation: (id: string, optionId: string, note?: string) =>
    request<{ status: string; verificationId: string }>(
      `/api/verifier/escalations/${id}/resolve`,
      { method: 'POST', body: JSON.stringify({ optionId, note }) },
    ),
  // ---- Mitigation estimator ----
  buildEstimate: (input: BuildEstimateInput) =>
    request<{ estimate: MitigationEstimate; priceListConnected: boolean }>(
      '/api/mitigation/build',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  saveEstimate: (input: BuildEstimateInput) =>
    request<{ estimateId: string; jobId: string; estimate: MitigationEstimate }>(
      '/api/mitigation/estimates',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  getEstimatorJobs: () =>
    request<{ jobs: EstimatorJob[] }>('/api/mitigation/jobs', { method: 'GET' }),

  getDemoSources: () =>
    request<{ sources: BuildEstimateInput }>('/api/mitigation/demo-sources', { method: 'GET' }),

  getCarriers: () =>
    request<{ carriers: Array<{ id: string; name: string }>; programs: Array<{ id: string; name: string }> }>(
      '/api/mitigation/carriers',
      { method: 'GET' },
    ),

  getAgreements: () =>
    request<{ agreements: ProgramAgreementSummary[]; source: string }>('/api/mitigation/agreements', {
      method: 'GET',
    }),

  getDeviations: (jobId: string) =>
    request<{ deviations: SlaDeviation[] }>(
      `/api/mitigation/jobs/${encodeURIComponent(jobId)}/deviations`,
      { method: 'GET' },
    ),

  acceptDeviation: (jobId: string, deviation: Omit<SlaDeviation, 'proposed'>) =>
    request<{ deviations: SlaDeviation[] }>(
      `/api/mitigation/jobs/${encodeURIComponent(jobId)}/deviations`,
      { method: 'POST', body: JSON.stringify(deviation) },
    ),

  removeDeviation: (jobId: string, ruleId: string) =>
    request<{ ok: boolean }>(
      `/api/mitigation/jobs/${encodeURIComponent(jobId)}/deviations/${encodeURIComponent(ruleId)}`,
      { method: 'DELETE' },
    ),

  appendDryingReport: (jobId: string, report: DryingReportInput) =>
    request<{ report: DryingReportInput & { id: string }; reports: Array<DryingReportInput & { id: string }> }>(
      `/api/mitigation/jobs/${encodeURIComponent(jobId)}/drying-reports`,
      { method: 'POST', body: JSON.stringify(report) },
    ),

  getJobProgress: (jobId: string) =>
    request<{
      jobId: string;
      reports: Array<DryingReportInput & { id: string }>;
      dryingProgress: DryingProgress;
      equipmentPlan: EquipmentPlan;
    }>(`/api/mitigation/jobs/${encodeURIComponent(jobId)}/progress`, { method: 'GET' }),

  rebuildEstimate: (jobId: string, input: BuildEstimateInput & { save?: boolean }) =>
    request<{
      estimate: MitigationEstimate;
      saved: boolean;
      estimateId?: string;
      jobId?: string;
    }>(`/api/mitigation/jobs/${encodeURIComponent(jobId)}/rebuild`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  captureStatus: () =>
    request<CaptureStatus>('/api/mitigation/capture/status', { method: 'GET' }),

  runCaptureAgent: (input?: {
    jobId?: string;
    claimNumber?: string;
    docusketch?: unknown;
    mica?: unknown;
    photos?: PhotoManifestEntry[];
    notes?: string;
  }) =>
    request<
      | { scope: 'job'; result: CaptureSyncResult }
      | {
          scope: 'org';
          pass: {
            jobsConsidered: number;
            jobsUpdated: number;
            visitsImported: number;
            estimatesSaved: number;
            ranAt: string;
          };
        }
    >('/api/mitigation/capture/agent/run', {
      method: 'POST',
      body: JSON.stringify(input ?? {}),
    }),

  captureSync: (
    jobId: string,
    input: {
      sources?: CaptureSourceKind[];
      claimNumber?: string;
      since?: string;
      autoRebuild?: boolean;
      save?: boolean;
      payload?: unknown;
      payloadSource?: CaptureSourceKind;
      docusketch?: unknown;
      mica?: unknown;
      photos?: PhotoManifestEntry[];
      notes?: string;
    },
  ) =>
    request<CaptureSyncResult>(`/api/mitigation/jobs/${encodeURIComponent(jobId)}/capture/sync`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  captureImport: (
    jobId: string,
    input: {
      source: CaptureSourceKind;
      payload: unknown;
      claimNumber?: string;
      autoRebuild?: boolean;
      save?: boolean;
      docusketch?: unknown;
      mica?: unknown;
      photos?: PhotoManifestEntry[];
      notes?: string;
    },
  ) =>
    request<CaptureSyncResult>(`/api/mitigation/jobs/${encodeURIComponent(jobId)}/capture/import`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  getStandards: () =>
    request<{
      editions: { s500: string; s520: string };
      note: string;
      references: Array<StandardReference & { formatted: string }>;
    }>('/api/mitigation/standards', { method: 'GET' }),

  getEstimatorSettings: () =>
    request<{ settings: EstimatorSettings }>('/api/mitigation/settings', { method: 'GET' }),

  saveEstimatorSettings: (settings: EstimatorSettings) =>
    request<{ settings: EstimatorSettings }>('/api/mitigation/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  /** Export URL for an estimate. The browser downloads it directly (cookies ride along). */
  estimateExportUrl: (estimateId: string, format: 'csv' | 'xml' | 'scope') =>
    `${API_BASE}/api/mitigation/estimates/${estimateId}/export?format=${format}`,

  // ---- Xactimate connection ----
  xactimateStatus: () => request<XactimateStatus>('/api/xactimate/status', { method: 'GET' }),

  xactimateConnect: (input: XactimateConnectInput) =>
    request<XactimateConnectResponse>('/api/xactimate/connect', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  xactimateDisconnect: () =>
    request<{ ok: boolean }>('/api/xactimate/disconnect', { method: 'POST' }),

  xactimatePriceLists: () =>
    request<{ priceLists: PriceListSummary[]; selected: string | null }>(
      '/api/xactimate/price-lists',
      { method: 'GET' },
    ),

  xactimateSyncPriceList: (priceListId: string) =>
    request<{
      priceListId: string;
      name: string;
      entryCount: number;
      matched?: number;
      unmatched?: string[];
      remapped?: Array<{ from: string; to: string; description: string; via: string }>;
      warnings?: string[];
    }>('/api/xactimate/price-lists/sync', {
      method: 'POST',
      body: JSON.stringify({ priceListId }),
    }),

  xactimateUploadPriceList: (input: {
    id: string;
    name: string;
    effectiveDate?: string;
    content?: string;
    format?: 'csv' | 'tsv' | 'json' | 'auto';
    entries?: Array<{ code: string; description: string; unit: string; unitPrice: number }>;
  }) =>
    request<{
      priceListId: string;
      name?: string;
      entryCount: number;
      matched?: number;
      unmatched?: string[];
      remapped?: Array<{ from: string; to: string; description: string; via: string }>;
      warnings?: string[];
    }>('/api/xactimate/price-lists/upload', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  xactimateSearchCodes: (q: string, opts?: { limit?: number; preferUnit?: string; preferCategory?: string }) => {
    const params = new URLSearchParams({ q });
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.preferUnit) params.set('preferUnit', opts.preferUnit);
    if (opts?.preferCategory) params.set('preferCategory', opts.preferCategory);
    return request<{
      hits: CodeSearchHit[];
      priceListId: string | null;
      entryCount?: number;
      message?: string;
    }>(`/api/xactimate/catalog/codes?${params.toString()}`, { method: 'GET' });
  },

  xactimateReconcileCatalog: () =>
    request<{
      live: boolean;
      priceListId?: string;
      entryCount?: number;
      matched: number;
      unmatched: string[];
      remapped: Array<{ from: string; to: string; description: string; via: string }>;
      warnings: string[];
      remaps: Record<string, string>;
    }>('/api/xactimate/catalog/reconcile', { method: 'GET' }),

  xactimateSaveRemaps: (remaps: Record<string, string>) =>
    request<{ remaps: Record<string, string> }>('/api/xactimate/catalog/remaps', {
      method: 'PUT',
      body: JSON.stringify({ remaps }),
    }),

  xactimateOverrideCode: (key: string, code: string, persist = true) =>
    request<{ key: string; code: string; persisted: boolean; remaps?: Record<string, string> }>(
      '/api/xactimate/catalog/override',
      { method: 'POST', body: JSON.stringify({ key, code, persist }) },
    ),

  xactimateResume: () =>
    request<{ status: 'connected'; profile: { username: string; displayName?: string } }>(
      '/api/xactimate/resume',
      { method: 'POST', body: JSON.stringify({}) },
    ),

  xactimateActivity: () =>
    request<{ activity: XactimateActivity[] }>('/api/xactimate/activity', { method: 'GET' }),

  xactimatePush: (estimate: MitigationEstimate, confirmedFindings: boolean) =>
    request<{ estimateId: string; url?: string; lineItemsWritten: number; warnings: string[] }>(
      '/api/xactimate/push',
      { method: 'POST', body: JSON.stringify({ estimate, confirmedFindings }) },
    ),

  // ---- Symbility (Claims Connect) ----
  symbilityStatus: () => request<SymbilityStatus>('/api/symbility/status', { method: 'GET' }),

  symbilityConnect: (input: SymbilityConnectInput) =>
    request<SymbilityConnectResponse>('/api/symbility/connect', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  symbilityDisconnect: () =>
    request<{ ok: boolean }>('/api/symbility/disconnect', { method: 'POST' }),


  // ---- Construction Estimator ----
  estimatorStatus: () => request<EstimatorStatus>('/api/estimator/status', { method: 'GET' }),

  saveEstimatorCredential: (provider: EstimatorProvider, input: EstimatorCredentialInput) =>
    request<{ credential: EstimatorCredential }>(`/api/estimator/credentials/${provider}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  deleteEstimatorCredential: (provider: EstimatorProvider) =>
    request<{ ok: boolean }>(`/api/estimator/credentials/${provider}`, { method: 'DELETE' }),

  testEstimatorCredential: (provider: EstimatorProvider) =>
    request<{ ok: boolean; connector: string }>(`/api/estimator/credentials/${provider}/test`, {
      method: 'POST',
    }),

  listScanProjects: (search?: string) =>
    request<{ projects: ScanProjectSummary[] }>(
      `/api/estimator/projects${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      { method: 'GET' },
    ),

  startEstimatorRun: (scanProjectId: string, mitigationText?: string) =>
    request<{ run: EstimatorRun }>('/api/estimator/runs', {
      method: 'POST',
      body: JSON.stringify({ scanProjectId, mitigationText: mitigationText || undefined }),
    }),

  listEstimatorRuns: () =>
    request<{ runs: EstimatorRun[] }>('/api/estimator/runs', { method: 'GET' }),

  getEstimatorRun: (runId: string) =>
    request<{ run: EstimatorRun }>(`/api/estimator/runs/${runId}`, { method: 'GET' }),

  selectEstimatorJob: (runId: string, jobId: string) =>
    request<{ run: EstimatorRun }>(`/api/estimator/runs/${runId}/job`, {
      method: 'POST',
      body: JSON.stringify({ jobId }),
    }),

  approveEstimatorRun: (runId: string) =>
    request<{ run: EstimatorRun }>(`/api/estimator/runs/${runId}/approve`, { method: 'POST' }),

  /** Download URL — the browser fetches it directly so the file streams. */
  estimatorExportUrl: (runId: string, format: 'csv' | 'xml') =>
    `${API_BASE}/api/estimator/runs/${runId}/export?format=${format}`,
  // ---- Computer use ----
  computerStatus: () => request<ComputerStatus>('/api/computer/status', { method: 'GET' }),

  connectAnthropicKey: (apiKey: string) =>
    request<{ credential: CredentialStatus }>('/api/computer/credentials', {
      method: 'PUT',
      body: JSON.stringify({ apiKey }),
    }),

  disconnectAnthropicKey: () =>
    request<{ credential: CredentialStatus }>('/api/computer/credentials', { method: 'DELETE' }),

  createPairingCode: () =>
    request<{ code: string; expiresAt: string }>('/api/computer/agents/pair-code', {
      method: 'POST',
    }),

  getAgents: () => request<{ agents: ComputerAgent[] }>('/api/computer/agents', { method: 'GET' }),

  getAgentScreen: (agentId: string) =>
    request<{ image: string; width: number; height: number }>(
      `/api/computer/agents/${encodeURIComponent(agentId)}/screen`,
      { method: 'GET' },
    ),

  startRun: (input: {
    agentId: string;
    instruction: string;
    model?: string;
    quality?: CaptureQuality;
  }) =>
    request<{ run: ComputerRun }>('/api/computer/runs', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateTask: (jobId: string, taskId: string, patch: Partial<CreateTaskInput>) =>
    request<{ task: JobTask }>(`/api/jobs/${jobId}/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  // ---- Crew ----
  assignAgent: (jobId: string, userId: string, roleOnJob?: AssignmentRole) =>
    request<{ assignment: JobAssignment }>(`/api/jobs/${jobId}/crew`, {
      method: 'POST',
      body: JSON.stringify({ userId, roleOnJob }),
    }),

  releaseAgent: (jobId: string, assignmentId: string) =>
    request<{ assignment: JobAssignment }>(`/api/jobs/${jobId}/crew/${assignmentId}/release`, {
      method: 'POST',
    }),

  // ---- Work logs ----
  addWorkLog: (jobId: string, input: CreateWorkLogInput) =>
    request<{ workLog: WorkLog }>(`/api/jobs/${jobId}/logs`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // ---- Memory ----
  getMemory: (params: MemoryQuery = {}) => {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
    }
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<{ events: MemoryEvent[]; nextCursor: number | null }>(`/api/memory${suffix}`, {
      method: 'GET',
    });
  },

  getMemoryStats: () => request<MemoryStats>('/api/memory/stats', { method: 'GET' }),

  getMemoryAgents: () =>
    request<{ agents: AgentMemory[] }>('/api/memory/agents', { method: 'GET' }),

  getMemoryAgent: (userId: string, before?: number) =>
    request<{
      agent: AgentMemory;
      openTasks: unknown[];
      events: MemoryEvent[];
      nextCursor: number | null;
    }>(`/api/memory/agents/${userId}${before ? `?before=${before}` : ''}`, { method: 'GET' }),

  /** The export streams NDJSON, so it is a plain link rather than a fetch. */
  memoryExportUrl: () => `${API_BASE}/api/memory/export`,
  getUsageEvents: (limit = 50) =>
    request<{ events: UsageEvent[] }>(`/api/usage/events?limit=${limit}`, { method: 'GET' }),

  getUsageDaily: (days = 30) =>
    request<{ days: UsageDay[] }>(`/api/usage/daily?days=${days}`, { method: 'GET' }),

  /** Customer-facing billing period usage — jobs and compute, not tokens. */
  getMeteringSummary: () =>
    request<CustomerMeteringSummary>('/api/metering/summary', { method: 'GET' }),

  // ---- Model calls (metered server-side) ----

  /** Exact pre-flight token count from the provider's tokenizer. */
  countTokens: (input: { model?: string; messages: ChatMessage[]; system?: string }) =>
    request<{ model: string; inputTokens: number; inputPriceNanos: number }>(
      '/api/model/count-tokens',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  /**
   * Run a model call. Usage is metered from the provider's response, never from
   * anything this client reports, so the returned charge is authoritative.
   */
  sendMessages: (input: {
    model?: string;
    messages: ChatMessage[];
    system?: string;
    maxTokens?: number;
    thinking?: boolean;
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    feature?: string;
    requestId?: string;
  }) => request<CompletionResult>('/api/model/messages', { method: 'POST', body: JSON.stringify(input) }),
  getRuns: () => request<{ runs: ComputerRun[] }>('/api/computer/runs', { method: 'GET' }),

  stopRun: (runId: string) =>
    request<{ run: ComputerRun }>(`/api/computer/runs/${encodeURIComponent(runId)}/stop`, {
      method: 'POST',
    }),

  /** SSE URL for a run's transcript. `after` replays what the browser missed. */
  runEventsUrl: (runId: string, after = 0) =>
    `${API_BASE}/api/computer/runs/${encodeURIComponent(runId)}/events?after=${after}`,

  // ---- Atmosphere Outreach (internal) ----
  salesStatus: () => request<{ status: SalesStatus }>('/api/sales/status', { method: 'GET' }),

  listSalesCampaigns: () =>
    request<{ campaigns: SalesCampaign[] }>('/api/sales/campaigns', { method: 'GET' }),

  createSalesCampaign: (input: {
    name?: string;
    territory: string;
    salesFocus: string;
    valueProp?: string | null;
    senderName?: string | null;
    senderEmail?: string | null;
    meetingDurationMin?: number;
    availability?: Record<string, string[]>;
  }) =>
    request<{ campaign: SalesCampaign }>('/api/sales/campaigns', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  getSalesCampaign: (id: string) =>
    request<{ campaign: SalesCampaign; running: boolean }>(`/api/sales/campaigns/${id}`, {
      method: 'GET',
    }),

  updateSalesCampaign: (id: string, input: Record<string, unknown>) =>
    request<{ campaign: SalesCampaign }>(`/api/sales/campaigns/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  startSalesCampaign: (id: string) =>
    request<{ campaign: SalesCampaign; running: boolean }>(`/api/sales/campaigns/${id}/start`, {
      method: 'POST',
    }),

  pauseSalesCampaign: (id: string) =>
    request<{ campaign: SalesCampaign }>(`/api/sales/campaigns/${id}/pause`, { method: 'POST' }),

  resumeSalesCampaign: (id: string) =>
    request<{ campaign: SalesCampaign; running: boolean }>(`/api/sales/campaigns/${id}/resume`, {
      method: 'POST',
    }),

  listSalesBusinesses: (campaignId: string) =>
    request<{ businesses: SalesBusiness[] }>(`/api/sales/campaigns/${campaignId}/businesses`, {
      method: 'GET',
    }),

  listSalesContacts: (campaignId: string) =>
    request<{ contacts: SalesContact[] }>(`/api/sales/campaigns/${campaignId}/contacts`, {
      method: 'GET',
    }),

  listSalesOutreach: (campaignId: string) =>
    request<{ outreach: SalesOutreach[] }>(`/api/sales/campaigns/${campaignId}/outreach`, {
      method: 'GET',
    }),

  listSalesMeetings: (campaignId: string) =>
    request<{ meetings: SalesMeeting[] }>(`/api/sales/campaigns/${campaignId}/meetings`, {
      method: 'GET',
    }),

  listSalesEvents: (campaignId: string) =>
    request<{ events: SalesEvent[] }>(`/api/sales/campaigns/${campaignId}/events`, {
      method: 'GET',
    }),

  replySalesOutreach: (outreachId: string, body: string, subject?: string) =>
    request<{ intent: string; meetingId?: string }>(`/api/sales/outreach/${outreachId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ body, subject }),
    }),

  searchSalesPeople: (query: string) =>
    request<{ search: PeopleSearchRecord }>('/api/sales/people-search', {
      method: 'POST',
      body: JSON.stringify({ query }),
    }),

  listSalesPeopleSearches: () =>
    request<{ searches: PeopleSearchRecord[] }>('/api/sales/people-search', { method: 'GET' }),

  getSalesPeopleSearch: (id: string) =>
    request<{ search: PeopleSearchRecord }>(`/api/sales/people-search/${id}`, { method: 'GET' }),

  // ---- Email Marketing (storm outreach) ----
  emMap: () => request<EmMapResponse>('/api/email-marketing/map', { method: 'GET' }),

  emSettings: () =>
    request<{ settings: EmSettings; emailProvider: string; weatherProvider: string }>(
      '/api/email-marketing/settings',
      { method: 'GET' },
    ),

  emUpdateSettings: (input: Partial<EmSettingsUpdate>) =>
    request<{ settings: EmSettings }>('/api/email-marketing/settings', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  emScanStorms: (input: { demo?: boolean; region?: string } = {}) =>
    request<EmScanResult>('/api/email-marketing/storms/scan', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  emListStorms: (params: { status?: string; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));
    const qs = q.toString();
    return request<{ items: EmStorm[]; total: number }>('/api/email-marketing/storms' + (qs ? `?${qs}` : ''), {
      method: 'GET',
    });
  },

  emStormMatches: (stormId: string) =>
    request<{ storm: EmStorm; matches: EmStormMatch[] }>(
      `/api/email-marketing/storms/${encodeURIComponent(stormId)}/matches`,
      { method: 'GET' },
    ),

  emCreateOutreach: (input: {
    stormId: string;
    subjectTemplate?: string;
    bodyTemplate?: string;
  }) =>
    request<EmOutreachDetail>('/api/email-marketing/outreach', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  emListOutreach: (params: { status?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    if (params.limit != null) q.set('limit', String(params.limit));
    const qs = q.toString();
    return request<{ items: EmOutreach[]; total: number }>(
      '/api/email-marketing/outreach' + (qs ? `?${qs}` : ''),
      { method: 'GET' },
    );
  },

  emGetOutreach: (id: string) =>
    request<EmOutreachDetail>(`/api/email-marketing/outreach/${encodeURIComponent(id)}`, {
      method: 'GET',
    }),

  emSendOutreach: (id: string) =>
    request<EmOutreachDetail>(`/api/email-marketing/outreach/${encodeURIComponent(id)}/send`, {
      method: 'POST',
    }),

  emSendOutreachMessage: (outreachId: string, messageId: string) =>
    request<{ message: EmOutreachMessage }>(
      `/api/email-marketing/outreach/${encodeURIComponent(outreachId)}/messages/${encodeURIComponent(messageId)}/send`,
      { method: 'POST' },
    ),

  emUpdateOutreachMessage: (
    outreachId: string,
    messageId: string,
    input: { subject?: string; bodyText?: string },
  ) =>
    request<{ message: EmOutreachMessage }>(
      `/api/email-marketing/outreach/${encodeURIComponent(outreachId)}/messages/${encodeURIComponent(messageId)}`,
      { method: 'PATCH', body: JSON.stringify(input) },
    ),

  emScheduleCheckins: (input: {
    stormId: string;
    outreachId?: string;
    followUpDays?: number;
  }) =>
    request<{ items: EmCheckin[]; scheduledFor: string; count: number }>(
      '/api/email-marketing/checkins/schedule',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  emListCheckins: (params: { status?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    if (params.limit != null) q.set('limit', String(params.limit));
    const qs = q.toString();
    return request<{ items: EmCheckin[]; total: number }>(
      '/api/email-marketing/checkins' + (qs ? `?${qs}` : ''),
      { method: 'GET' },
    );
  },

  emSendCheckin: (id: string) =>
    request<{ checkin: EmCheckin; provider: string; messageId: string }>(
      `/api/email-marketing/checkins/${encodeURIComponent(id)}/send`,
      { method: 'POST' },
    ),

  emUpdateCheckin: (
    id: string,
    input: {
      status?: EmCheckin['status'];
      outcomeNotes?: string | null;
      subject?: string;
      bodyText?: string;
    },
  ) =>
    request<{ checkin: EmCheckin }>(`/api/email-marketing/checkins/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  // ---- CRM Integrations (connect any CRM) ----
  integrationCatalog: () =>
    request<{ systems: CrmCatalogEntry[]; vaultConfigured: boolean; envPrefix: string }>(
      '/api/integrations/catalog',
      { method: 'GET' },
    ),

  listIntegrationSources: () =>
    request<{ sources: IntegrationSource[] }>('/api/integrations/sources', { method: 'GET' }),

  connectCrm: (input: {
    system: string;
    label?: string;
    sandbox?: boolean;
    baseUrl?: string;
    direction?: 'pull' | 'push' | 'bidirectional';
    credentials?: Record<string, string>;
    credentialRef?: string;
    config?: Record<string, unknown>;
  }) =>
    request<{ source: IntegrationSource; catalog: CrmCatalogEntry }>('/api/integrations/connect', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  syncIntegrationSource: (id: string, opts: { promote?: boolean } = {}) =>
    request<{ sync: SyncResult; promotion: PromoteStats | null }>(
      `/api/integrations/sources/${encodeURIComponent(id)}/sync${opts.promote ? '?promote=true' : ''}`,
      { method: 'POST', body: JSON.stringify({ promote: opts.promote }) },
    ),

  promoteIntegrationSource: (id: string) =>
    request<{ promotion: PromoteStats }>(
      `/api/integrations/sources/${encodeURIComponent(id)}/promote`,
      { method: 'POST' },
    ),

  pushToIntegration: (
    id: string,
    input: {
      operation: 'create_note' | 'create_task' | 'create_contact' | 'update_contact';
      entityType?: string;
      externalId?: string;
      contactId?: string;
      subject?: string;
      body?: string;
      fields?: Record<string, unknown>;
    },
  ) =>
    request<{ push: { status: string; externalId?: string; error?: string; runId: string } }>(
      `/api/integrations/sources/${encodeURIComponent(id)}/push`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  importIntegrationCsv: (
    id: string,
    input: {
      entityType: string;
      csv: string;
      idColumn: string;
      delimiter?: string;
      promote?: boolean;
    },
  ) =>
    request<{
      sync: SyncResult;
      promotion: PromoteStats | null;
      parsed: { rows: number; skippedWithoutId: number; truncated: boolean };
    }>(
      `/api/integrations/sources/${encodeURIComponent(id)}/import${input.promote ? '?promote=true' : ''}`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),
};

/** Labels for the run states, kept next to the other shared UI copy. */
export const RUN_STATUS_LABELS: Record<AgentRunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const STEP_TYPE_LABELS: Record<AgentStepType, string> = {
  status: 'Status',
  thought: 'Reasoning',
  message: 'Message',
  tool_call: 'Action',
  tool_result: 'Result',
  observation: 'Observation',
  navigation: 'Navigation',
  decision: 'Decision',
  artifact: 'Artifact',
  usage: 'Usage',
  error: 'Error',
  event: 'Event',
};

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | unknown[];
}

export interface MeasuredUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
}

export interface CompletionResult {
  id: string;
  model: string;
  stopReason: string | null;
  content: unknown[];
  usage: MeasuredUsage;
  billing: {
    /** Worst-case amount reserved before the call ran. */
    authorizedNanos: number;
    /** What was actually charged, from the provider's usage totals. */
    chargedNanos: number;
    duplicate: boolean;
    balance: CreditBalance;
  };
}

/* ------------------------------------------------------------ billing types */

export type PlanCode = 'free' | 'pro' | 'max_5x' | 'max_20x' | 'team' | 'enterprise';
export type BillingInterval = 'monthly' | 'annual';

export interface Plan {
  code: PlanCode;
  name: string;
  tagline: string | null;
  monthlyPriceCents: number;
  annualPriceCents: number | null;
  includedCreditsNanos: number;
  perSeat: boolean;
  minSeats: number;
  rateMultiplier: number;
  features: string[];
  isContactSales: boolean;
}

export interface CreditPack {
  code: string;
  name: string;
  priceCents: number;
  creditsNanos: number;
  bonusNanos: number;
}

/**
 * Sell prices only. The cost basis and markup live in a private schema the
 * browser can never read.
 */
export interface ModelRate {
  modelId: string;
  displayName: string;
  family: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWrite5mPerMTok: number;
  cacheWrite1hPerMTok: number;
  cacheReadPerMTok: number;
  batchDiscountPct: number;
  contextWindow: number | null;
  maxOutputTokens: number | null;
}

export interface Catalog {
  plans: Plan[];
  packs: CreditPack[];
  rateCard: ModelRate[];
  /** `stripe` whenever a Stripe key is configured server-side. */
  paymentProvider: 'stripe' | 'dev' | 'manual';
}

export interface CreditBalance {
  totalNanos: number;
  planNanos: number;
  purchasedNanos: number;
  promoNanos: number;
  nextExpiry: string | null;
}

export interface BillingSettings {
  autoReloadEnabled: boolean;
  autoReloadThresholdNanos: number;
  autoReloadAmountNanos: number;
  /** `null` means no cap. */
  monthlySpendLimitNanos: number | null;
}

export type BillingSettingsPatch = Partial<BillingSettings>;

export interface BillingOverview {
  subscription: {
    planCode: PlanCode;
    planName: string;
    billingInterval: BillingInterval;
    seats: number;
    status: string;
    periodStart: string;
    periodEnd: string;
    cancelAtPeriodEnd: boolean;
    monthlyPriceCents: number;
    includedCreditsNanos: number;
    rateMultiplier: number;
  };
  settings: BillingSettings;
  balance: CreditBalance;
  periodUsage: {
    events: number;
    priceNanos: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
  };
  usageByModel: {
    modelId: string;
    displayName: string;
    events: number;
    inputTokens: number;
    outputTokens: number;
    priceNanos: number;
  }[];
  /** False for roles that may view billing but not change it. */
  canManage: boolean;
}

/** Customer-safe metering summary — no tokens, models, or margin. */
export interface CustomerMeteringSummary {
  periodStart: string;
  periodEnd: string;
  planName: string;
  processedJobs: number;
  includedJobs: number;
  excessJobs: number;
  videoVerificationHours: number;
  computeOverage: { units: number; chargeCents: number } | null;
  basePlatformChargeCents: number;
  jobOverageChargeCents: number;
  videoProcessingChargeCents: number;
  estimatedUpcomingBillCents: number;
}

export interface BillingOnboardingStatus {
  paymentProvider: 'stripe' | 'dev' | 'manual';
  required: boolean;
  complete: boolean;
  isCreator: boolean;
  hasSubscription: boolean;
  plan: {
    name: string;
    baseMonthlyFeeCents: number;
    includedJobs: number;
    additionalJobPriceCents: number;
  };
}

export interface SetPlanResult {
  plan: string;
  changed: boolean;
  effectiveAt: string | null;
  cancelAtPeriodEnd: boolean;
  grantedNanos: number;
  balance: CreditBalance;
}

export interface LedgerEntry {
  id: string;
  entryType: 'plan_grant' | 'purchase' | 'usage' | 'refund' | 'expiration' | 'adjustment';
  bucket: 'plan' | 'purchased' | 'promotional' | null;
  /** Signed: positive adds credits, negative consumes them. */
  amountNanos: number;
  description: string | null;
  createdAt: string;
}

export interface Purchase {
  id: string;
  packCode: string | null;
  creditsNanos: number;
  bonusNanos: number;
  amountCents: number;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  provider: string;
  isAutoReload?: boolean;
  createdAt?: string;
  completedAt?: string | null;
}

/**
 * One row of the in-product payment history. `receiptUrl` and `invoicePdfUrl`
 * come from Stripe, so a customer can always retrieve proof of payment.
 */
export interface Payment {
  id: string;
  kind: 'subscription' | 'credits' | 'refund';
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  amountCents: number;
  currency: string;
  description: string | null;
  receiptUrl: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  receiptEmail: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  failureReason: string | null;
  createdAt: string;
}

export const PAYMENT_KIND_LABELS: Record<Payment['kind'], string> = {
  subscription: 'Subscription',
  credits: 'Usage credits',
  refund: 'Refund',
};

/* -------------------------------------------------------------- usage types */

export interface UsageTokens {
  modelId: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheWrite5mTokens?: number;
  cacheWrite1hTokens?: number;
  cacheReadTokens?: number;
  isBatch?: boolean;
}

export interface UsageBreakdown {
  input: { tokens: number; priceNanos: number };
  output: { tokens: number; priceNanos: number };
  cacheWrite5m: { tokens: number; priceNanos: number };
  cacheWrite1h: { tokens: number; priceNanos: number };
  cacheRead: { tokens: number; priceNanos: number };
}

export interface UsageQuote {
  modelId: string;
  isBatch: boolean;
  priceNanos: number;
  breakdown: UsageBreakdown;
}

export interface RecordUsageResult {
  eventId: string;
  priceNanos: number;
  /** True when this request id had already been billed. */
  duplicate: boolean;
  breakdown: UsageBreakdown;
  balance: CreditBalance;
}

export interface UsageEvent {
  id: string;
  modelId: string;
  feature: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  isBatch: boolean;
  priceNanos: number;
  createdAt: string;
}

export interface UsageDay {
  day: string;
  modelId: string;
  events: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  priceNanos: number;
}

export const PLAN_ORDER: PlanCode[] = ['free', 'pro', 'max_5x', 'max_20x', 'team', 'enterprise'];

export const LEDGER_LABELS: Record<LedgerEntry['entryType'], string> = {
  plan_grant: 'Plan credits',
  purchase: 'Credit purchase',
  usage: 'Usage',
  refund: 'Refund',
  expiration: 'Expired',
  adjustment: 'Adjustment',
};


/* ------------------------------------------------------------------ *
 * Project Manager Agent types
 * ------------------------------------------------------------------ */

export type PmPhase =
  | 'intake'
  | 'inspection'
  | 'approval'
  | 'scheduled'
  | 'mitigation'
  | 'drying'
  | 'drying_complete'
  | 'permitting'
  | 'production'
  | 'punch_list'
  | 'final_review'
  | 'invoicing'
  | 'paid';

export interface PmProject {
  id: string;
  orgId: string;
  projectNumber: string;
  name: string;
  description: string | null;
  workType: WorkType;
  lossType: string | null;
  status: 'active' | 'on_hold' | 'closed' | 'cancelled';
  phase: PmPhase;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  pmUserId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  addressLine1: string | null;
  city: string | null;
  region: string | null;
  carrier: string | null;
  claimNumber: string | null;
  adjusterName: string | null;
  scheduledStartAt: string | null;
  targetCompletionAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ---- HomeOwner Report portal -------------------------------------- */

export interface PortalShare {
  id: string;
  orgId: string;
  projectId: string;
  label: string | null;
  customerName: string | null;
  customerEmail: string | null;
  status: 'active' | 'revoked' | 'expired';
  expiresAt: string | null;
  lastAccessedAt: string | null;
  welcomeNote: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface PortalVisibility {
  projectId: string;
  orgId: string;
  showSchedule: boolean;
  showPhaseProgress: boolean;
  showMilestones: boolean;
  showCustomerUpdates: boolean;
  showDryingSummary: boolean;
  showDocuments: boolean;
  showClaimBasics: boolean;
  showDeductible: boolean;
  showOfficeContact: boolean;
  showAdjusterContact: boolean;
  showFieldContact: boolean;
  allowChat: boolean;
  allowAdjusterChat: boolean;
  allowGroupChat: boolean;
  allowPolicyUpload: boolean;
  allowInsuranceQa: boolean;
  brandName: string | null;
  logoUrl: string | null;
  officeName: string | null;
  officePhone: string | null;
  officeEmail: string | null;
  fieldContactName: string | null;
  fieldContactPhone: string | null;
  customMessage: string | null;
}

export type PortalConversationKind = 'assistant' | 'company' | 'adjuster' | 'group';

export interface PortalConversation {
  id: string;
  orgId: string;
  projectId: string;
  shareId: string;
  kind: PortalConversationKind;
  title: string;
  includesHomeowner: boolean;
  includesCompany: boolean;
  includesAdjuster: boolean;
  includesAssistant: boolean;
  status: 'open' | 'archived';
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PortalMessage {
  id: string;
  orgId: string;
  projectId: string;
  shareId: string;
  conversationId: string;
  authorKind: 'homeowner' | 'staff' | 'adjuster' | 'assistant' | 'system';
  authorUserId: string | null;
  authorName: string | null;
  body: string;
  topic: string | null;
  createdAt: string;
}

export interface PortalPolicyMeta {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number | null;
  summary: string | null;
  uploadedAt: string;
}

export interface PortalStaffView {
  projectId: string;
  shares: PortalShare[];
  visibility: PortalVisibility;
  conversations: PortalConversation[];
  messages: PortalMessage[];
  portalPathPrefix: string;
}

export interface HomeownerReport {
  orgName: string | null;
  brand: {
    name: string;
    logoUrl: string | null;
  };
  share: { id: string; welcomeNote: string | null; customerName: string | null };
  project: {
    projectNumber: string;
    name: string;
    workType: string;
    lossType: string | null;
    status: string;
    phase: string | null;
    phaseLabel: string | null;
    address: string | null;
    city: string | null;
    region: string | null;
  };
  schedule: {
    scheduledStartAt: string | null;
    targetCompletionAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
  claim: {
    carrier: string | null;
    claimNumber: string | null;
    deductibleCents: number | null;
  } | null;
  contacts: {
    office: { name: string | null; phone: string | null; email: string | null } | null;
    adjuster: { name: string | null; phone: string | null; email: string | null } | null;
    field: { name: string | null; phone: string | null } | null;
  };
  milestones: { label: string; dueAt: string; kind: string; completedAt: string | null }[] | null;
  updates: { subject: string | null; body: string; sentAt: string | null; createdAt: string }[] | null;
  drying: {
    isDrying: boolean;
    openAreas: number;
    areasAtGoal: number;
    daysDrying: number | null;
    headline: string;
  } | null;
  documents: { label: string; kind: string; status: string }[] | null;
  customMessage: string | null;
  capabilities: {
    chat: boolean;
    adjusterChat: boolean;
    groupChat: boolean;
    policyUpload: boolean;
    insuranceQa: boolean;
  };
  regulation: {
    regionLabel: string;
    carrierLabel: string | null;
    bullets: string[];
    disclaimer: string;
  };
}

export interface PmHealth {
  score: number;
  band: 'good' | 'watch' | 'at_risk' | 'critical';
  reasons: { weight: number; text: string }[];
}

export interface PmTask {
  id: string;
  projectId: string;
  title: string;
  details: string | null;
  status: 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  category: string;
  assignedTo: string | null;
  dueAt: string | null;
  source: 'manual' | 'playbook' | 'agent';
  originKey: string | null;
  blockedReason: string | null;
  completedAt: string | null;
}

export interface PmAlert {
  id: string;
  projectId: string | null;
  ruleKey: string;
  severity: 'info' | 'warn' | 'critical';
  category: string;
  title: string;
  detail: string | null;
  suggestedAction: string | null;
  status: 'open' | 'acknowledged' | 'snoozed' | 'resolved' | 'dismissed';
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  facts: Record<string, unknown>;
  project?: { id: string; projectNumber: string; name: string } | null;
}

export interface PmDryingArea {
  id: string;
  projectId: string;
  label: string;
  material: string;
  dryGoalPct: number;
  waterClass: number | null;
  affectedSqft: number | null;
  affectedCuft: number | null;
  driedAt: string | null;
  signedOffAt: string | null;
}

export interface PmReading {
  id: string;
  areaId: string | null;
  kind: string;
  moisturePct: number | null;
  temperatureF: number | null;
  humidityPct: number | null;
  gpp: number | null;
  note: string | null;
  takenAt: string;
}

export interface PmDocument {
  id: string;
  projectId: string;
  requirementKey: string;
  label: string;
  kind: string;
  status: 'missing' | 'provided' | 'waived' | 'rejected';
  isBlocking: boolean;
  requiredByPhase: string | null;
  note: string | null;
  externalRef: string | null;
}

export interface PmMilestone {
  id: string;
  label: string;
  kind: string;
  dueAt: string;
  completedAt: string | null;
  note: string | null;
}

export interface PmEquipment {
  id: string;
  assetTag: string;
  kind: string;
  makeModel: string | null;
  capacityPintsDay: number | null;
  capacityCfm: number | null;
  status: 'available' | 'deployed' | 'maintenance' | 'retired';
  dailyRateCents: number | null;
}

export interface PmPlacement {
  id: string;
  projectId: string;
  equipmentId: string;
  areaLabel: string | null;
  placedAt: string;
  removedAt: string | null;
  equipment?: {
    assetTag: string;
    kind: string;
    capacityPintsDay: number | null;
    capacityCfm: number | null;
  } | null;
}

export interface PmAssignment {
  id: string;
  projectId: string;
  userId: string;
  roleOnProject: string;
  allocationPct: number;
  releasedAt: string | null;
}

export interface PmUpdate {
  id: string;
  projectId: string;
  audience: 'customer' | 'adjuster' | 'team';
  channel: string;
  status: 'draft' | 'approved' | 'sent' | 'discarded';
  subject: string | null;
  body: string;
  origin: 'agent' | 'manual';
  modelId: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface PmBrief {
  id: string;
  forDate: string;
  kind: string;
  headline: string | null;
  body: string;
  modelId: string | null;
  facts: Record<string, unknown>;
  createdAt: string;
}

export interface PmSettings {
  orgId: string;
  enabled: boolean;
  timezone: string;
  digestHour: number;
  readingIntervalHours: number;
  dryingStallDays: number;
  dryingProgressMinPct: number;
  equipmentIdleHours: number;
  staleProjectDays: number;
  milestoneLeadDays: number;
  maxProjectsPerCrew: number;
  disabledRules: string[];
  autoCreateTasks: boolean;
}

export interface PmRule {
  key: string;
  label: string;
  description: string;
  category: string;
  scope: string;
}

export interface PmSettingsResponse {
  settings: PmSettings;
  rules: PmRule[];
  canManage: boolean;
  writingEnabled: boolean;
}

export interface PmCrewLoad {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: string;
  projectCount: number;
  allocationPct: number;
  openTaskCount: number;
  overdueTaskCount: number;
  projectNumbers: string[];
}

export interface PmProjectSummary {
  project: PmProject;
  health: PmHealth;
  openTasks: number;
  overdueTasks: number;
  crewCount: number;
  daysSinceActivity: number;
  drying: {
    openAreas: number;
    areasAtGoal: number;
    areasOverdue: number;
    areasStalled: number;
    daysDrying: number;
    allAreasAtGoal: boolean;
  } | null;
  documentation: { completionPct: number; invoiceReady: boolean; blocking: number };
}

export interface PmOverview {
  settings: PmSettings;
  role: MemberRole;
  canManage: boolean;
  writingEnabled: boolean;
  counts: {
    projects: number;
    critical: number;
    warn: number;
    mine: number;
    pendingApprovals?: number;
    unreviewedComms?: number;
    openProcurement?: number;
  };
  alerts: PmAlert[];
  projects: PmProjectSummary[];
  crew: PmCrewLoad[];
  members: { userId: string; email: string | null; fullName: string | null; role: string }[];
}

export interface PmApproval {
  id: string;
  projectId: string | null;
  kind: string;
  title: string;
  detail: string | null;
  platform: string | null;
  priority: string;
  status: string;
  proposedAction: Record<string, unknown>;
  createdAt: string;
  decidedAt: string | null;
}

export interface PmCommunication {
  id: string;
  projectId: string | null;
  channel: string;
  direction: string;
  intake: string;
  counterpartyName: string | null;
  counterpartyHandle: string | null;
  counterpartyKind: string;
  body: string;
  mentionExcerpt: string | null;
  status: string;
  occurredAt: string;
}

export interface PmPlatformConnection {
  id: string;
  platform: string;
  label: string | null;
  status: string;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface PmProcurementRequest {
  id: string;
  projectId: string;
  kind: string;
  title: string;
  description: string | null;
  status: string;
  referralUrl: string | null;
  referralVendorKey: string | null;
  selectedBidId: string | null;
  updatedAt: string;
}

export interface PmProcurementBid {
  id: string;
  requestId: string;
  vendorName: string;
  vendorUrl: string | null;
  amountCents: number | null;
  leadDays: number | null;
  notes: string | null;
  status: string;
}

export interface PmVendorReferral {
  id: string;
  vendorKey: string;
  name: string;
  category: string;
  commissionBps: number;
  active: boolean;
}

export interface PmEquipmentPlan {
  id: string;
  projectId: string;
  source: string;
  status: string;
  summary: string | null;
  dumpsterRequired: boolean;
}

export interface PmEquipmentPlanItem {
  id: string;
  planId: string;
  itemKind: string;
  label: string;
  quantity: number;
  unit: string;
  fulfillment: string;
  status: string;
}

export interface PmSituationEvent {
  id: string;
  kind: string;
  projectId: string | null;
  occurredAt: string;
  title: string;
  detail: string | null;
  severity?: string;
  status?: string;
}

export interface PmSituation {
  events: PmSituationEvent[];
  counts: {
    pendingApprovals: number;
    unreviewedComms: number;
    openProcurement: number;
    staleLinks: number;
    openAlerts: number;
    openThreads?: number;
    pendingInvites?: number;
    partners?: number;
  };
}

export interface PmPartnerProfile {
  orgId: string;
  displayName: string;
  kind: string;
  blurb: string | null;
  trades: string[];
  serviceAreas: string[];
  invitesSent: number;
  invitesAccepted: number;
  jobsCompleted: number;
  discoverable: boolean;
}

export interface PmPartnerInvite {
  id: string;
  inviteeKind: string;
  inviteeName: string;
  inviteeEmail: string | null;
  inviteePhone: string | null;
  inviteeCompany: string | null;
  status: string;
  token: string;
  expiresAt: string;
  createdAt: string;
}

export interface PmPartnership {
  id: string;
  partnerOrgId: string;
  partnerKind: string;
  status: string;
  preferred: boolean;
  sharedJobs: number;
}

export interface PmNetworkSummary {
  profile: PmPartnerProfile;
  partnerships: PmPartnership[];
  invites: PmPartnerInvite[];
  counts: { partners: number; pendingInvites: number; preferred: number };
}

export interface PmThread {
  id: string;
  projectId: string | null;
  kind: string;
  mode: string;
  title: string;
  status: string;
  urgency: string;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface PmThreadMessage {
  id: string;
  threadId: string;
  authorUserId: string | null;
  authorKind: string;
  body: string;
  createdAt: string;
}

export interface PmAreaAnalysis {
  areaId: string;
  label: string;
  material: string;
  dryGoalPct: number;
  state: 'drying' | 'stalled' | 'wetter' | 'goal_met' | 'signed_off' | 'no_readings';
  latestMoisturePct: number | null;
  latestReadingAt: string | null;
  hoursSinceReading: number | null;
  readingOverdue: boolean;
  remainingPct: number | null;
  projectedDaysToGoal: number | null;
  daysDrying: number;
  trend: {
    daily: { takenAt: string; moisturePct: number }[];
    totalDropPct: number | null;
    lastDropPct: number | null;
    flatDays: number;
  };
}

export interface PmProjectDetail {
  project: PmProject;
  tasks: PmTask[];
  assignments: PmAssignment[];
  areas: PmDryingArea[];
  readings: PmReading[];
  placements: PmPlacement[];
  documents: PmDocument[];
  milestones: PmMilestone[];
  alerts: PmAlert[];
  updates: PmUpdate[];
  analysis: {
    drying: {
      isDrying: boolean;
      areas: PmAreaAnalysis[];
      openAreas: number;
      areasAtGoal: number;
      areasOverdue: number;
      areasStalled: number;
      daysDrying: number;
      allAreasAtGoal: boolean;
      equipmentStillOnDriedProject: boolean;
      ambient: { temperatureF: number; humidityPct: number; gpp: number; dewPointF: number } | null;
      outside: { temperatureF: number; humidityPct: number; gpp: number } | null;
      equipment: {
        airMoversOnSite: number;
        airMoversRequired: number;
        dehuPintsOnSite: number;
        dehuPintsRequired: number;
        sufficient: boolean | null;
        shortfallNote: string | null;
      };
    };
    schedule: {
      overdueTasks: PmTask[];
      dueTodayTasks: PmTask[];
      blockedTasks: PmTask[];
      hasNoNextStep: boolean;
      daysSinceActivity: number;
      overrunDays: number | null;
      daysUntilTarget: number | null;
    };
    compliance: {
      missingBlocking: PmDocument[];
      overdueBlocking: PmDocument[];
      completionPct: number;
      invoiceReady: boolean;
      blockingInvoiceNow: boolean;
      milestones: {
        milestone: PmMilestone;
        state: 'done' | 'overdue' | 'due_soon' | 'upcoming';
        daysOverdue: number;
      }[];
    };
    health: PmHealth;
  };
  phases: PmPhase[];
  playbook: { phase: string; label: string; intent: string } | null;
  canManage: boolean;
}

export interface PmSeedResult {
  documents: number;
  milestones: number;
  tasks: number;
}

export interface PmEngineResult {
  ranAt: string;
  durationMs: number;
  projectsEvaluated: number;
  rulesEvaluated: number;
  findings: number;
  alertsOpened: number;
  alertsUpdated: number;
  alertsCleared: number;
  tasksCreated: number;
  rulesSkipped: string[];
  warnings: string[];
}

/* ------------------------------------------------------------------ *
 * Financial Agent
 * ------------------------------------------------------------------ */

export interface FinanceAlert {
  id: string;
  ruleKey: string;
  severity: 'info' | 'warn' | 'critical';
  category: string;
  title: string;
  detail: string | null;
  suggestedAction: string | null;
  status: 'open' | 'acknowledged' | 'snoozed' | 'resolved' | 'dismissed';
  jobId: string | null;
  connectionId: string | null;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  facts: Record<string, unknown>;
}

export interface FinanceJobRollup {
  jobId: string;
  title: string;
  jobNumber: number | null;
  contractCents: number | null;
  invoicedCents: number;
  paidCents: number;
  openArCents: number;
  costCents: number;
  laborCents: number;
  materialsCents: number;
  equipmentCents: number;
  subcontractCents: number;
  otherCents: number;
  marginCents: number | null;
  marginPct: number | null;
  agingDays: number | null;
}

export interface FinanceConnection {
  id: string;
  label: string;
  kind: 'bank' | 'accounting';
  provider: string;
  accessPath: string;
  accessMode: 'read_only' | 'draft_writes';
  enabled: boolean;
  status: string;
  statusDetail: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  credentialConfigured: boolean;
}

export interface FinanceAccount {
  id: string;
  name: string;
  accountType: string;
  currency: string;
  balanceCents: number | null;
  balanceAsOf: string | null;
  connectionId: string | null;
  isActive: boolean;
}

export interface FinanceBrief {
  id: string;
  forDate: string;
  kind: string;
  headline: string | null;
  body: string;
  modelId: string | null;
  facts: Record<string, unknown>;
  createdAt: string;
}

export interface FinanceCostCode {
  id: string;
  code: string;
  label: string;
  category: string;
  isActive: boolean;
}

export interface FinanceJobCost {
  id: string;
  jobId: string | null;
  category: string;
  description: string | null;
  quantity: number;
  unit: string;
  unitCostCents: number;
  amountCents: number;
  incurredOn: string;
  status: string;
  origin: string;
}

export interface FinanceEngineResult {
  ranAt: string;
  durationMs: number;
  jobsEvaluated: number;
  rulesEvaluated: number;
  findings: number;
  alertsOpened: number;
  alertsUpdated: number;
  alertsCleared: number;
  rulesSkipped: string[];
  warnings: string[];
  cashCents: number;
  openArCents: number;
  totalCostCents: number;
}

export interface FinanceOverview {
  settings: {
    enabled: boolean;
    timezone: string;
    arWarnDays: number;
    arCriticalDays: number;
    marginFloorPct: number;
    cashFloorCents: number;
  };
  role: MemberRole;
  canManage: boolean;
  writingEnabled: boolean;
  providers: Record<string, string>;
  health: {
    cashCents: number;
    cashFloorCents: number;
    openArCents: number;
    totalCostCents: number;
    totalContractCents: number;
    marginPct: number | null;
  };
  counts: {
    jobs: number;
    connections: number;
    accounts: number;
    critical: number;
    warn: number;
  };
  alerts: FinanceAlert[];
  jobs: FinanceJobRollup[];
  connections: FinanceConnection[];
  accounts: FinanceAccount[];
}

export function formatMoneyCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export interface FinanceSharePackage {
  id: string;
  title: string;
  purpose: string;
  recipientName: string | null;
  recipientOrg: string | null;
  recipientEmail: string | null;
  coverNote: string | null;
  status: string;
  publishedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  documentCount?: number;
  linkCount?: number;
  report?: Record<string, unknown>;
  companyProfile?: Record<string, unknown>;
}

export interface FinanceShareDocument {
  id: string;
  packageId: string;
  title: string;
  kind: string;
  description: string | null;
  externalRef: string | null;
  periodLabel: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface FinanceShareLink {
  id: string;
  packageId: string;
  tokenPrefix: string;
  label: string | null;
  expiresAt: string;
  maxViews: number | null;
  viewCount: number;
  lastViewedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  token?: string;
  url?: string;
}

export interface FinancePublicShare {
  packageId: string;
  title: string;
  purpose: string;
  recipientName: string | null;
  recipientOrg: string | null;
  coverNote: string | null;
  sections: Record<string, boolean>;
  report: Record<string, unknown>;
  companyProfile: Record<string, unknown>;
  documents: {
    id: string;
    title: string;
    kind: string;
    description: string | null;
    externalRef: string | null;
    periodLabel: string | null;
    sortOrder: number;
  }[];
  orgName: string;
  publishedAt: string | null;
  expiresAt: string;
  viewCount: number;
}

export const FINANCE_SHARE_PURPOSE_LABELS: Record<string, string> = {
  loan: 'Bank / loan underwriting',
  insurance: 'Insurance / bonding',
  investor: 'Investor',
  auditor: 'Auditor',
  partner: 'Partner / GC',
  other: 'Other',
};

export const FINANCE_DOC_KIND_LABELS: Record<string, string> = {
  articles_of_incorporation: 'Articles of incorporation',
  operating_agreement: 'Operating agreement',
  ein_letter: 'EIN letter',
  business_license: 'Business license',
  contractor_license: 'Contractor license',
  insurance_coi: 'Insurance certificate (COI)',
  tax_return: 'Tax return',
  financial_statement: 'Financial statement',
  bank_statement: 'Bank statement',
  ar_aging: 'AR aging',
  job_cost_summary: 'Job cost summary',
  org_chart: 'Org chart',
  resume_key_person: 'Key-person resume',
  other: 'Other',
};

/** Human-readable phase labels, shared by the PM screens. */
export const PM_PHASE_LABELS: Record<PmPhase, string> = {
  intake: 'Intake',
  inspection: 'Inspection',
  approval: 'Approval',
  scheduled: 'Scheduled',
  mitigation: 'Mitigation',
  drying: 'Drying',
  drying_complete: 'Dry-out complete',
  permitting: 'Permitting',
  production: 'Production',
  punch_list: 'Punch list',
  final_review: 'Final review',
  invoicing: 'Invoicing',
  paid: 'Paid',
};

/** How each verification state reads in the UI. */
export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  queued: 'Check queued',
  running: 'Checking…',
  verified: 'Verified',
  repaired: 'Fixed and verified',
  escalated: 'Needs your answer',
  rejected: 'Confirmed not done',
  failed: "Couldn't be checked",
  cancelled: 'Check cancelled',
};

export const VERDICT_LABELS: Record<Verdict, string> = {
  satisfied: 'Found on the site',
  violated: 'Missing or wrong',
  indeterminate: 'Could not tell',
};

/** Friendly labels for the platform string the agent reports. */
export const PLATFORM_LABELS: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
};

export const QUALITY_LABELS: Record<CaptureQuality, string> = {
  economical: 'Economical — smallest screenshots, lowest cost',
  balanced: 'Balanced — about 1080p (recommended)',
  detailed: 'Detailed — highest resolution the model allows',
};

/* ------------------------------------------------------------------ */
/* Construction Estimator types                                        */
/* ------------------------------------------------------------------ */

export type EstimatorProvider = 'docusketch' | 'dash' | 'xactimate';

export interface EstimatorCredential {
  provider: EstimatorProvider;
  label: string | null;
  fingerprint: string;
  baseUrl: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface EstimatorCredentialInput {
  label?: string;
  username?: string;
  password?: string;
  apiKey?: string;
  accountId?: string;
  baseUrl?: string;
}

export interface EstimatorStatus {
  /** True when the server is serving fixtures instead of talking to vendors. */
  sandbox: boolean;
  modelAvailable: boolean;
  credentialStorageAvailable: boolean;
  canManageCredentials: boolean;
  maxPhotosPerRun: number;
  credentials: EstimatorCredential[];
}

export interface ScanProjectSummary {
  id: string;
  name: string;
  address?: string;
  claimNumber?: string;
  capturedAt?: string;
}

export type EstimatorRunStatus = 'running' | 'awaiting_review' | 'complete' | 'failed' | 'cancelled';

export type EstimatorRunStage =
  | 'queued'
  | 'connecting'
  | 'fetching_scan'
  | 'matching_job'
  | 'analyzing_photos'
  | 'reading_mitigation'
  | 'building_scope'
  | 'pricing'
  | 'awaiting_review'
  | 'exporting'
  | 'complete';

export interface EstimatorRunEvent {
  at: string;
  stage: EstimatorRunStage;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface MatchSignal {
  field: string;
  weight: number;
  score: number;
  detail: string;
}

export interface MatchCandidate {
  jobId: string;
  jobNumber?: string;
  claimNumber?: string;
  insuredName?: string;
  address?: string;
  lossDate?: string;
  score: number;
  signals: MatchSignal[];
}

export interface EstimateLineItem {
  roomId: string;
  roomName: string;
  code: string;
  category: string;
  selector: string;
  description: string;
  unit: string;
  quantity: number;
  quantityWithWaste: number;
  trade: string;
  rationale: string;
  confidence: number;
  evidence: string[];
  needsReview?: boolean;
}

export interface ConstructionEstimate {
  jobId: string;
  jobNumber?: string;
  claimNumber?: string;
  insuredName?: string;
  address: { street?: string; city?: string; state?: string; postalCode?: string };
  basis: 'scan' | 'mitigation' | 'both';
  lineItems: EstimateLineItem[];
  summary: {
    lineItemCount: number;
    roomCount: number;
    quantityByUnit: Record<string, number>;
    itemsNeedingReview: number;
    emptyRooms: string[];
  };
  completeness?: {
    issues: {
      severity: 'critical' | 'warning' | 'info';
      roomName?: string;
      code?: string;
      message: string;
    }[];
    unmatchedRemovals: { description: string; roomName?: string; reason: string }[];
    criticalCount: number;
    warningCount: number;
  };
  warnings: string[];
  generatedAt: string;
}

export interface EstimatorRun {
  id: string;
  status: EstimatorRunStatus;
  stage: EstimatorRunStage;
  scanProjectId: string;
  crmJobId: string | null;
  matchScore: number | null;
  matchNeedsReview: boolean;
  matchCandidates: MatchCandidate[];
  matchReason: string | null;
  job: { jobNumber?: string; claimNumber?: string; insuredName?: string } | null;
  estimate: ConstructionEstimate | null;
  exportRef: string | null;
  error: string | null;
  events: EstimatorRunEvent[];
  createdAt: string;
  updatedAt: string;
}

/** Stage labels, in the order the pipeline runs them. */
export const ESTIMATOR_STAGE_LABELS: Record<EstimatorRunStage, string> = {
  queued: 'Queued',
  connecting: 'Connecting',
  fetching_scan: 'Reading the scan',
  matching_job: 'Finding the job',
  analyzing_photos: 'Reading the photos',
  reading_mitigation: 'Reading the mitigation estimate',
  building_scope: 'Building scope',
  pricing: 'Assembling the estimate',
  awaiting_review: 'Ready for review',
  exporting: 'Writing to Xactimate',
  complete: 'Complete',
};

export const PROVIDER_LABELS: Record<EstimatorProvider, string> = {
  docusketch: 'DocuSketch',
  dash: 'Dash (CRM)',
  xactimate: 'Xactimate',
};

/** Human-readable labels for roles and work types (shared UI copy). */
export const ROLE_LABELS: Record<MemberRole, string> = {
  project_manager: 'Project Manager',
  field_technician: 'Field Technician',
  accountant: 'Accountant',
  office_manager: 'Office Manager',
  sales: 'Sales',
};

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  mitigation: 'Mitigation',
  construction: 'Construction',
};

export const CONTRACTOR_TYPE_LABELS: Record<ContractorType, string> = {
  restoration: 'Restoration company',
  roofing: 'Roofing company',
  general_contractor: 'General contractor',
  other: 'Something else',
};

export const USAGE_INTENT_LABELS: Record<UsageIntent, string> = {
  mitigation_estimating: 'Mitigation estimating',
  construction_estimating: 'Construction estimating',
  project_management: 'Project management',
  crm: 'CRM / leads and jobs',
  web_access: 'AI access to other systems',
  field_work: 'Field / technician work',
  billing: 'Billing and credits',
  financial: 'Financial / books & job cost',
  exploring: 'Still exploring',
};



/* ------------------------------------------------------------------ *
 * Estimator types
 *
 * Mirrors backend/src/estimator/types.ts. Only the fields the UI actually
 * renders are declared — the payload carries more (the full assessment, every
 * scope item) and it round-trips untouched when an estimate is pushed.
 * ------------------------------------------------------------------ */

export interface BuildEstimateInput {
  jobId?: string;
  /** A human's correction to who the estimate is for. Always beats inference. */
  carrier?: { carrierId?: string; programId?: string };
  docusketch?: unknown;
  mica?: unknown;
  photos?: PhotoManifestEntry[];
  notes?: string;
  /** Visit timeline — merges into the live assessment as the job progresses. */
  dryingReports?: DryingReportInput[];
  overrides?: Record<string, unknown>;
  settings?: EstimatorSettings;
  /** Knowledge key or scope item id → live account Xactimate code. */
  codeOverrides?: Record<string, string>;
}

/** One drying visit / export sent with build or appended to a saved job. */
export interface DryingReportInput {
  id?: string;
  takenAt: string;
  source: 'mica' | 'manual' | 'notes' | 'photos' | 'outlook';
  notes?: string;
  moistureReadings?: Array<{
    roomId: string;
    material: string;
    value: number;
    dryStandard: number;
    takenAt: string;
    location?: string;
  }>;
  psychrometrics?: Array<{
    takenAt: string;
    zone: 'affected' | 'unaffected' | 'outside' | 'dehu_outlet';
    temperatureF: number;
    relativeHumidity: number;
    gpp?: number;
  }>;
  equipment?: Array<{
    kind: string;
    quantity: number;
    roomId?: string;
    placedAt: string;
    removedAt?: string;
    days?: number;
  }>;
  roomsAtDryStandard?: string[];
  roomsStillWet?: string[];
}

export type CaptureSourceKind = 'mica_dash' | 'outlook';

export interface CaptureStatus {
  mode: 'live' | 'sandbox';
  connectors: Array<{ kind: CaptureSourceKind; name: string }>;
  configured: { micaDash: boolean; outlook: boolean };
  note: string;
  agent?: {
    enabled: boolean;
    intervalMinutes: number;
    lastRunAt?: string;
    sources: CaptureSourceKind[];
    lastPass?: {
      jobsConsidered: number;
      jobsUpdated: number;
      visitsImported: number;
      estimatesSaved: number;
      ranAt: string;
    };
  };
}

export interface CaptureSyncResult {
  jobId: string;
  reportsImported: number;
  reportsSkipped: number;
  totalReports: number;
  warnings: string[];
  estimate?: MitigationEstimate;
  estimateId?: string;
  saved: boolean;
  modified: boolean;
  importedReports?: Array<{
    id: string;
    takenAt: string;
    source: DryingReportInput['source'];
    notes?: string;
    roomsAtDryStandard?: string[];
    roomsStillWet?: string[];
  }>;
}

export interface DryingProgress {
  reports: Array<{
    id: string;
    takenAt: string;
    source: DryingReportInput['source'];
    notes?: string;
  }>;
  latestAt?: string;
  visitCount: number;
  moistureReadingCount: number;
  psychrometricCount: number;
  roomsAtDryStandard: string[];
  roomsStillWet: string[];
  gppDifferential: number | null;
  dryingComplete: boolean;
  suggestedRemainingDays: number;
  timeline: Array<{
    takenAt: string;
    source: DryingReportInput['source'];
    summary: string;
  }>;
}

export interface RoomEquipmentPlan {
  roomId: string;
  roomName: string;
  cutHeightIn: number;
  openWallSF: number;
  wetFloorSF: number;
  wetCeilingSF: number;
  airMoversRequired: number;
  injectidryRecommended: boolean;
  floodCutRequired: boolean;
  rationale: string;
}

export interface EquipmentPlan {
  rooms: RoomEquipmentPlan[];
  lines: Array<{
    kind: string;
    units: number;
    days: number;
    unitDays: number;
    source: 'plan' | 'log' | 'merged';
    rationale: string;
  }>;
  dehu: {
    affectedCF: number;
    requiredPintsPerDay: number;
    unitsRequired: number;
    factor: number;
    dehuType: string;
  };
  scrubbersRequired: number;
  airMoversRequired: number;
  warnings: string[];
  billingMode: 'as_logged' | 'recommended' | 'max';
}

export interface PhotoManifestEntry {
  filename?: string;
  capturedAt?: string;
  caption?: string;
  roomName?: string;
  uri?: string;
}

export interface EstimatorSettings {
  targetMargin?: number;
  overheadAndProfitRate?: number;
  oAndPEligible?: boolean;
  taxRate?: number;
  costMultiplier?: number;
  lineMarginFloor?: number;
  hoursPerMonitoringVisit?: number;
  techniciansOnSite?: number;
  category3CutHeightIn?: number;
  costOverrides?: Record<string, number>;
}

export interface EstimatorJob {
  id: string;
  name: string;
  claimNumber: string | null;
  status: string;
  createdAt: string;
}

export interface MitigationLineItem {
  id: string;
  catalogKey?: string;
  code: string;
  category: string;
  description: string;
  roomName?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  rcv: number;
  totalCost: number;
  justification: string;
  /** Registry ids of the IICRC requirements behind this line. */
  citations: string[];
  evidenceIds: string[];
  evidenceGap?: string;
  priceVerified: boolean;
}

/* ---- IICRC standards ---- */

/**
 * How firmly a citation is anchored. `convention` is the one that matters most
 * to render honestly — it marks a practice the industry attributes to the
 * standard that the standard itself leaves to judgement.
 */
export type CitationConfidence = 'clause' | 'chapter' | 'convention';

export interface StandardReference {
  id: string;
  standard: 'S500' | 'S520';
  edition: string;
  chapter: string;
  section?: string;
  title: string;
  requirement: string;
  application: string;
  confidence: CitationConfidence;
  caveat?: string;
}

export type ComplianceStatus = 'met' | 'unmet' | 'undetermined' | 'not_applicable';

/* ---- Carrier program terms ---- */

export type SlaStatus =
  | 'met'
  | 'violated'
  | 'deviation_documented'
  | 'approval_required'
  | 'not_applicable'
  | 'undetermined';

export interface SlaDeviation {
  ruleId: string;
  reason: string;
  evidenceIds: string[];
  authorizedBy?: string;
  authorizedAt?: string;
  proposed?: boolean;
}

export interface SlaCheck {
  ruleId: string;
  title: string;
  status: SlaStatus;
  severity: 'hard' | 'soft';
  detail: string;
  remedy?: string;
  revenueImpact?: number;
  deviation?: SlaDeviation;
  sourceRef?: string;
}

export interface CarrierIdentification {
  carrierId: string | null;
  carrierName: string | null;
  programId: string | null;
  programName: string | null;
  confidence: 'stated' | 'inferred' | 'unknown';
  basis: string[];
  alternatives: Array<{ carrierId: string; carrierName: string; basis: string }>;
}

export interface ProgramAgreementSummary {
  carrierId: string;
  carrierName: string;
  programId: string;
  programName: string;
  version: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  rules: Array<{ id: string; title: string; summary: string; severity: 'hard' | 'soft'; sourceRef?: string }>;
  source: { kind: string; reference?: string; retrievedAt: string; enteredBy?: string };
}

export interface SlaComplianceReport {
  identification: CarrierIdentification;
  agreement: ProgramAgreementSummary | null;
  checks: SlaCheck[];
  met: number;
  violated: number;
  deviations: number;
  proposedDeviations: SlaDeviation[];
  blocksSubmission: boolean;
  summary: string;
}

export interface ComplianceCheck {
  id: string;
  citation: string;
  title: string;
  status: ComplianceStatus;
  detail: string;
  remedy?: string;
  affectsEstimate?: boolean;
}

export interface ComplianceReport {
  checks: ComplianceCheck[];
  met: number;
  unmet: number;
  undetermined: number;
  citations: string[];
  summary: string;
}

export interface ProfitFinding {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  kind: string;
  title: string;
  detail: string;
  revenueImpact: number;
  marginImpact: number;
  actionRequired?: string;
  relatedCode?: string;
}

export interface ProfitabilitySummary {
  subtotal: number;
  overheadAndProfit: number;
  tax: number;
  total: number;
  totalCost: number;
  grossProfit: number;
  grossMargin: number;
  targetMargin: number;
  marginGap: number;
  findings: ProfitFinding[];
  recoverableRevenue: number;
}

export interface AssessedRoomSummary {
  id: string;
  name: string;
  level: string;
  geometry: { floorSF: number; wallSF: number; ceilingSF: number; perimeterLF: number; heightFt: number };
  affectedFloorFraction: number;
  ceilingAffected: boolean;
}

export interface LossAssessmentSummary {
  jobId: string;
  propertyAddress?: string;
  claimNumber?: string;
  carrier?: string;
  insuredName?: string;
  dateOfLoss?: string;
  cause: string;
  sourceCategory: 1 | 2 | 3;
  category: 1 | 2 | 3;
  class: 1 | 2 | 3 | 4;
  rooms: AssessedRoomSummary[];
  dryingDays: number;
  monitoringVisits: number;
  microbialGrowthPresent: boolean;
  sourcesUsed: string[];
  evidence: Array<{ id: string; kind: string; description: string; tags: string[] }>;
  findings?: DamageFinding[];
}

export interface DamageFinding {
  id: string;
  kind: string;
  summary: string;
  roomName?: string;
  material?: string;
  evidenceIds: string[];
  confidence: 'stated' | 'inferred' | 'undetermined';
  tags: string[];
}

export interface MitigationRequirement {
  id: string;
  authority: 'iicrc' | 'insurance' | 'construction_code' | 'carrier_sla';
  status: 'required' | 'recommended' | 'documentation_required' | 'undetermined';
  title: string;
  detail: string;
  action: string;
  citationId?: string;
  sourceRef?: string;
  findingIds: string[];
  addressed: boolean;
}

export interface MitigationEstimate {
  jobId: string;
  generatedAt: string;
  assessment: LossAssessmentSummary;
  lineItems: MitigationLineItem[];
  profitability: ProfitabilitySummary;
  /** The estimate read back against the IICRC standards. */
  compliance: ComplianceReport;
  /** The carrier program terms, and whether the estimate satisfies them. */
  sla: SlaComplianceReport;
  /** Every standard cited anywhere in this estimate, resolved. */
  references: StandardReference[];
  /** What must be mitigated / documented, by authority. */
  requirements?: MitigationRequirement[];
  /** S500-sized equipment plan (flood-cut open wall → air movers, class → dehu). */
  equipmentPlan?: EquipmentPlan;
  /** Progress from the drying-report timeline. */
  dryingProgress?: DryingProgress;
  narrative: string;
  openQuestions: string[];
}

/* ---- Xactimate ---- */

export type ConsentScope =
  | 'read_profile'
  | 'read_price_list'
  | 'read_estimates'
  | 'write_estimate'
  | 'submit_estimate';

export interface XactimateStatus {
  connected: boolean;
  sessionActive: boolean;
  driver: 'mock' | 'api' | 'web';
  storageAvailable: boolean;
  webAutomationEnabled: boolean;
  username: string | null;
  scopes: ConsentScope[];
  storageMode: 'session' | 'stored';
  grantedAt: string | null;
  expiresAt: string | null;
  priceListId: string | null;
  availableScopes: Array<{ scope: ConsentScope; description: string; defaultGranted: boolean }>;
}

export interface XactimateConnectInput {
  username: string;
  password: string;
  mfaCode?: string;
  scopes: ConsentScope[];
  storageMode: 'session' | 'stored';
  consentDays: number;
  acknowledgedTerms: true;
}

export type XactimateConnectResponse =
  | { status: 'connected'; profile: { username: string; displayName?: string; companyName?: string }; scopes: ConsentScope[]; expiresAt: string }
  | { status: 'mfa_required'; challengeId: string; message: string };

export type SymbilityScope = 'read_profile' | 'read_claims' | 'write_estimate';

export interface SymbilityStatus {
  connected: boolean;
  sessionActive: boolean;
  driver: 'mock' | 'web';
  webAutomationEnabled: boolean;
  storageAvailable: boolean;
  username: string | null;
  scopes: SymbilityScope[];
  storageMode: 'session' | 'stored';
  grantedAt: string | null;
  expiresAt: string | null;
  availableScopes: Array<{
    scope: SymbilityScope;
    label: string;
    description: string;
    defaultGranted: boolean;
  }>;
}

export interface SymbilityConnectInput {
  username: string;
  password: string;
  mfaCode?: string;
  scopes: SymbilityScope[];
  storageMode: 'session' | 'stored';
  consentDays: number;
  acknowledgedTerms: true;
}

export type SymbilityConnectResponse =
  | {
      status: 'connected';
      profile: { username: string; displayName?: string; companyName?: string };
      scopes: SymbilityScope[];
      expiresAt: string;
    }
  | { status: 'mfa_required'; challengeId: string; message: string };

export interface PriceListSummary {
  id: string;
  name: string;
  effectiveDate?: string;
}

export interface CodeSearchHit {
  code: string;
  description: string;
  unit: string;
  unitPrice: number;
  score: number;
  match: 'exact_code' | 'prefix_code' | 'description' | 'token';
}

export interface XactimateActivity {
  id: string;
  scope: string;
  action: string;
  detail: string;
  succeeded: boolean;
  at: string;
}

/** Shared currency formatting so every surface agrees to the cent. */
export const usd = (value: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  on_hold: 'On hold',
  completed: 'Completed',
  invoiced: 'Invoiced',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

export const JOB_PRIORITY_LABELS: Record<JobPriority, string> = {
  1: 'Urgent',
  2: 'High',
  3: 'Normal',
  4: 'Low',
  5: 'Lowest',
};

export const JOB_PRIORITY_STYLES: Record<JobPriority, string> = {
  1: 'text-rose-300',
  2: 'text-amber-300',
  3: 'text-gray-300',
  4: 'text-gray-400',
  5: 'text-gray-500',
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

export const LOSS_TYPE_LABELS: Record<LossType, string> = {
  water: 'Water',
  fire: 'Fire',
  mold: 'Mold',
  storm: 'Storm',
  biohazard: 'Biohazard',
  contents: 'Contents',
  other: 'Other',
};

export const WORK_LOG_KIND_LABELS: Record<WorkLogKind, string> = {
  work: 'Work',
  note: 'Note',
  call: 'Call',
  site_visit: 'Site visit',
  photo: 'Photo',
  material: 'Material',
  issue: 'Issue',
};

export const ASSIGNMENT_ROLE_LABELS: Record<AssignmentRole, string> = {
  lead: 'Lead',
  crew: 'Crew',
  estimator: 'Estimator',
  supervisor: 'Supervisor',
  observer: 'Observer',
};

/** Tailwind classes per job status, so a board reads at a glance. */
export const JOB_STATUS_STYLES: Record<JobStatus, string> = {
  draft: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
  scheduled: 'border-violet-400/30 bg-violet-400/10 text-violet-200',
  in_progress: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  on_hold: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  completed: 'border-teal-400/30 bg-teal-400/10 text-teal-200',
  invoiced: 'border-blue-400/30 bg-blue-400/10 text-blue-200',
  paid: 'border-white/15 bg-white/5 text-gray-300',
  cancelled: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
};

export const PRIORITY_STYLES: Record<Priority, string> = {
  low: 'text-gray-400',
  normal: 'text-gray-300',
  high: 'text-amber-300',
  urgent: 'text-rose-300',
};

/**
 * How a person is shown throughout the memory. Falls back through name, then
 * email, then the raw id — an event must always name somebody, even if the
 * profile behind it has gone.
 */
export function displayName(person: Person | null | undefined, fallback = 'Someone'): string {
  if (!person) return fallback;
  return person.fullName || person.email || fallback;
}

/** '2h 15m' — minutes are how the work is logged, hours are how it is read. */
export function formatMinutes(minutes: number): string {
  if (!minutes) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Relative time for the feed; absolute dates stay in tooltips. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const units: [number, string][] = [
    [60, 'min'],
    [3600, 'hr'],
    [86400, 'day'],
    [604800, 'week'],
    [2592000, 'month'],
  ];
  for (let i = 0; i < units.length; i += 1) {
    const [limit, label] = units[i];
    if (seconds < limit) {
      const divisor = i === 0 ? 1 : units[i - 1][0];
      const value = Math.round(seconds / divisor);
      return `${value} ${label}${value === 1 ? '' : 's'} ago`;
    }
  }
  return new Date(iso).toLocaleDateString();
}

/* ------------------------------------------------------------------ */
/* Email Marketing                                                     */
/* ------------------------------------------------------------------ */

export type EmStormSeverity = 'advisory' | 'watch' | 'warning' | 'emergency';
export type EmStormStatus = 'active' | 'expired' | 'cancelled';
export type EmOutreachStatus = 'draft' | 'sending' | 'sent' | 'cancelled';
export type EmMessageStatus = 'draft' | 'queued' | 'sent' | 'failed' | 'skipped';
export type EmCheckinStatus = 'scheduled' | 'sent' | 'completed' | 'cancelled';

export interface EmMapContact {
  contactId: string;
  propertyId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  region: string | null;
  lat: number;
  lng: number;
  marketingOptOut: boolean;
  label: string | null;
}

export interface EmStorm {
  id: string;
  orgId: string;
  externalId: string;
  source: string;
  name: string;
  eventType: string;
  severity: EmStormSeverity;
  status: EmStormStatus;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  centerLat: number;
  centerLng: number;
  radiusMiles: number;
  geometry: unknown | null;
  areaDesc: string | null;
  onsetAt: string | null;
  endsAt: string | null;
}

export interface EmSettings {
  id: string;
  orgId: string;
  fromName: string;
  replyToEmail: string | null;
  companySignature: string | null;
  autoSend: boolean;
  followUpDays: number;
  includeOfferOfHelp: boolean;
}

export interface EmSettingsUpdate {
  fromName: string;
  replyToEmail: string | null;
  companySignature: string | null;
  autoSend: boolean;
  followUpDays: number;
  includeOfferOfHelp: boolean;
}

export interface EmMapResponse {
  contacts: EmMapContact[];
  unmappedCount: number;
  storms: EmStorm[];
  settings: EmSettings;
  emailProvider: string;
  weatherProvider: string;
}

export interface EmStormMatch {
  contactId: string;
  propertyId: string | null;
  name: string;
  email: string | null;
  city: string | null;
  region: string | null;
  lat: number;
  lng: number;
  distanceMiles: number;
  marketingOptOut: boolean;
  skipReason: string | null;
}

export interface EmScanResult {
  sourceUsed: string;
  note: string | null;
  storms: EmStorm[];
  matches: Array<{
    stormId: string;
    name: string;
    eventType: string;
    severity: EmStormSeverity;
    matchedCount: number;
    emailableCount: number;
    skippedCount: number;
  }>;
  contactCount: number;
}

export interface EmOutreach {
  id: string;
  orgId: string;
  stormId: string;
  status: EmOutreachStatus;
  subjectTemplate: string;
  bodyTemplate: string;
  matchedCount: number;
  sentCount: number;
  skippedCount: number;
  failedCount: number;
  createdAt: string;
  sentAt: string | null;
  emStorms?: Partial<EmStorm> | null;
}

export interface EmOutreachMessage {
  id: string;
  outreachId: string;
  contactId: string;
  propertyId: string | null;
  toEmail: string;
  toName: string | null;
  subject: string;
  bodyText: string;
  status: EmMessageStatus;
  skipReason: string | null;
  errorMessage: string | null;
  distanceMiles: number | null;
  sentAt: string | null;
}

export interface EmOutreachDetail {
  outreach: EmOutreach;
  messages: EmOutreachMessage[];
}

export interface EmCheckin {
  id: string;
  orgId: string;
  stormId: string;
  outreachId: string | null;
  contactId: string;
  propertyId: string | null;
  status: EmCheckinStatus;
  scheduledFor: string;
  subject: string | null;
  bodyText: string | null;
  toEmail: string | null;
  outcomeNotes: string | null;
  sentAt: string | null;
  completedAt: string | null;
  emStorms?: Partial<EmStorm> | null;
  crmContacts?: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  } | null;
}

export const EM_SEVERITY_LABELS: Record<EmStormSeverity, string> = {
  advisory: 'Advisory',
  watch: 'Watch',
  warning: 'Warning',
  emergency: 'Emergency',
};

export const EM_MESSAGE_STATUS_LABELS: Record<EmMessageStatus, string> = {
  draft: 'Draft',
  queued: 'Queued',
  sent: 'Sent',
  failed: 'Failed',
  skipped: 'Skipped',
};

/* ------------------------------------------------------------------ */
/* CRM Integrations                                                    */
/* ------------------------------------------------------------------ */

export interface CrmCatalogEntry {
  id: string;
  name: string;
  blurb: string;
  kind: 'rest' | 'csv' | 'manual';
  direction: 'pull' | 'push' | 'bidirectional';
  auth: string;
  defaultConfig: Record<string, unknown>;
  credentialFields: string[];
  entities: string[];
  supportsSandbox: boolean;
}

export interface IntegrationSource {
  id: string;
  system: string;
  label: string;
  kind: string;
  config: Record<string, unknown>;
  direction: 'pull' | 'push' | 'bidirectional';
  credentialRef: string | null;
  credentialConfigured: boolean;
  credentialFingerprint: string | null;
  credentialStorage: 'sealed' | 'env' | 'none';
  enabled: boolean;
  syncIntervalMinutes: number;
  lastSyncAt: string | null;
  lastPromoteAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncResult {
  runId: string;
  status: 'succeeded' | 'partial' | 'failed';
  stats: {
    seen: number;
    created: number;
    changed: number;
    unchanged: number;
    failed: number;
  };
  truncated: boolean;
  error?: string;
}

export interface PromoteStats {
  contactsUpserted: number;
  propertiesUpserted: number;
  accountsUpserted: number;
  linked: number;
  skipped: number;
  errors: string[];
}
