/**
 * The site catalog: the major business and contractor websites Computer
 * knows, as data. One entry drives the Logins "Add a login" picker (name,
 * category, official sign-in URL, two-step note), the practice tasks, the
 * playbook task types, and the terms-of-service guard.
 *
 * Terms review (checked 2026-10-06 against each site's published terms):
 * - allowed:        terms permit or plainly contemplate AI agents acting for the account holder.
 * - restricted:     terms ban scraping, bulk copying or above-human request rates, not a
 *                   person's own tasks at human pace. Computer works one task at a time.
 * - no_ban_found:   the terms we read have no automation clause.
 * - unverified:     we could not read the full terms; shown with a note.
 * - flagged:        terms prohibit bots or automated access/use of the site. Staff-visible
 *                   data only (the internal coverage page): these sites are listed, practiced
 *                   and learned like any other, by the customer's choice (2026-10-06), with no
 *                   warning in the Logins UI. Kept so the decision can be revisited.
 *
 * Excluded entirely (EXCLUDED_SITES): Xactimate, XactAnalysis, Restoration Manager and
 * ClaimXperience, because Verisk's EULA bans AI and automation tools.
 *
 * Quoted clauses for every flagged site, and what was read versus inferred:
 * kept in the staff research notes (site-terms-automation.md, 2026-10-06), outside the repo.
 *
 * To add a site: add an entry here. Nothing in the UI is hardcoded per site.
 */

import type { PlaybookStep } from '../iq/playbookSteps.js';

export type SiteCategory =
  | 'email_calendar'
  | 'chat_meetings'
  | 'crm'
  | 'suppliers'
  | 'measurements'
  | 'permits'
  | 'property_management'
  | 'work_orders'
  | 'insurance_claims'
  | 'restoration'
  | 'financing'
  | 'accounting_payments'
  | 'payroll_hr'
  | 'docs_esign'
  | 'marketing_reviews'
  | 'hiring'
  | 'general';

export const CATEGORY_LABELS: Record<SiteCategory, string> = {
  email_calendar: 'Email and calendar',
  chat_meetings: 'Team chat and meetings',
  crm: 'CRM and job management',
  suppliers: 'Suppliers',
  measurements: 'Measurements',
  permits: 'Permits',
  property_management: 'Property management',
  work_orders: 'Vendor and work-order portals',
  insurance_claims: 'Insurance carriers and claims',
  restoration: 'Restoration job management',
  financing: 'Customer financing',
  accounting_payments: 'Accounting and payments',
  payroll_hr: 'Payroll and HR',
  docs_esign: 'Documents and e-signature',
  marketing_reviews: 'Marketing and reviews',
  hiring: 'Hiring',
  general: 'General web',
};

/** Extra words that find a category in the Logins search ("supply" finds Suppliers). */
export const CATEGORY_SEARCH_TERMS: Partial<Record<SiteCategory, string[]>> = {
  email_calendar: ['email', 'mail', 'inbox', 'calendar'],
  chat_meetings: ['chat', 'messages', 'video', 'meeting'],
  crm: ['crm', 'jobs', 'projects', 'pipeline', 'leads', 'field service'],
  suppliers: ['supply', 'supplies', 'supplier', 'materials', 'distributor', 'lumber', 'roofing supply', 'store'],
  measurements: ['measure', 'measurement', 'roof report', 'aerial', 'estimate'],
  permits: ['permit', 'city', 'county', 'inspection'],
  property_management: ['property', 'landlord', 'rental', 'tenant', 'maintenance'],
  work_orders: ['work order', 'vendor', 'facility', 'maintenance', 'dispatch'],
  insurance_claims: ['insurance', 'claim', 'carrier', 'adjuster', 'tpa', 'assignment'],
  restoration: ['restoration', 'water', 'mitigation', 'fire', 'mold', 'drying'],
  financing: ['financing', 'loan', 'lender', 'credit'],
  accounting_payments: ['accounting', 'invoice', 'payment', 'bookkeeping', 'pay'],
  payroll_hr: ['payroll', 'hr', 'timesheet', 'benefits'],
  docs_esign: ['documents', 'files', 'storage', 'sign', 'signature', 'contract'],
  marketing_reviews: ['marketing', 'reviews', 'leads', 'social', 'ads'],
  hiring: ['hiring', 'jobs', 'recruit', 'applicants'],
};

export type TermsStatus = 'allowed' | 'restricted' | 'no_ban_found' | 'unverified' | 'flagged';

export interface SiteTerms {
  status: TermsStatus;
  /** One plain sentence on what the terms say about automation. */
  note: string;
  url: string;
  checkedOn: string;
}

/** A category template for a daily practice task (read-only or stops before the approval click). */
export type PracticeTemplate =
  | 'read_inbox'
  | 'draft_email'
  | 'read_calendar'
  | 'read_channels'
  | 'read_meetings'
  | 'crm_status'
  | 'supplier_search'
  | 'measurement_orders'
  | 'permit_search'
  | 'work_orders_open'
  | 'claim_assignments'
  | 'restoration_jobs'
  | 'financing_status'
  | 'accounting_recent'
  | 'payroll_next'
  | 'recent_files'
  | 'recent_envelopes'
  | 'sign_in_check'
  | 'fill_form'
  | 'upload_file'
  | 'download_file';

/**
 * How a site's sign-in works, checked against its live sign-in page on
 * 2026-10-06. The server-side saved sign-in (autoSignIn) follows it so a
 * person only enters a username and password once: nothing else to set up.
 */
export interface SignInRecipe {
  /**
   * one_page: username and password on one form.
   * username_first: username, Next, then a password page (Microsoft, Google...).
   * open_first: the sign-in URL is a landing page; click a Sign in link to reach the form.
   */
  flow: 'one_page' | 'username_first' | 'open_first';
  /** Visible link or button text that opens the form (open_first). */
  openWith?: string[];
  /** Hosts the sign-in hands off to (the site's identity provider). The saved password may be typed there. */
  identityHosts?: string[];
  /** live_page: seen on the live page. blocked_probe: the page blocks automated browsers; steps follow the site's help pages. */
  checked: 'live_page' | 'blocked_probe';
  /** One plain sentence for the person or the model (codes, extra fields). */
  note?: string;
}

export interface CatalogSite {
  id: string;
  name: string;
  category: SiteCategory;
  /** Official sign-in page (verified 2026-10-06). */
  signInUrl: string;
  /** Hosts a saved Login for this site may carry (first is the canonical Login host). */
  hosts: string[];
  /** Words people use in Chat for this site. */
  aliases: string[];
  /** Two-step verification: 'likely' shows "You'll be asked for a code when signing in". */
  twoStep: 'likely' | 'sometimes' | 'rare';
  /** Company accounts often sign in through single sign-on (Google, Microsoft, Okta). */
  sso: boolean;
  /** Monogram and brand colour for the picker (no third-party logo files are loaded). */
  logo: { text: string; color: string };
  terms: SiteTerms;
  /** Practice templates this site runs daily (needs a saved Login unless public). */
  practice: PracticeTemplate[];
  /** True for public test sites built for automation practice (no Login needed). */
  publicTestSite?: boolean;
  /** Short hints that seed a starter playbook before Computer has learned the site. */
  guide?: string[];
  /** How sign-in works (null only for sign-in-free test pages and entries kept out of the picker). */
  signIn: SignInRecipe | null;
  /** Kept out of the "Add a login" picker (practice or recognition only), with the reason. */
  notInPicker?: string;
}

const C = '2026-10-06';
const t = (status: TermsStatus, note: string, url: string): SiteTerms => ({ status, note, url, checkedOn: C });

const RAW_SITES: Array<Omit<CatalogSite, 'signIn'>> = [
  /* ---------------------------------------------------- email and calendar -- */
  {
    id: 'outlook', name: 'Outlook (Microsoft 365)', category: 'email_calendar', signInUrl: 'https://outlook.office.com/mail/',
    hosts: ['outlook.office.com', 'outlook.live.com', 'login.microsoftonline.com'], aliases: ['outlook', 'office 365', 'o365', 'hotmail'],
    twoStep: 'likely', sso: true, logo: { text: 'O', color: '#0F6CBD' },
    terms: t('allowed', 'Microsoft sets rules for AI services that act for you and bans only impermissible scraping.', 'https://www.microsoft.com/en-us/servicesagreement'),
    practice: ['read_inbox', 'draft_email'], guide: ['New mail is the top-left button.', 'Send needs approval; drafts save on their own.'],
  },
  {
    id: 'microsoft365', name: 'Microsoft 365 (Office)', category: 'email_calendar', signInUrl: 'https://m365.cloud.microsoft/',
    hosts: ['m365.cloud.microsoft', 'www.office.com', 'login.microsoftonline.com'], aliases: ['microsoft 365', 'office', 'word online', 'excel online'],
    twoStep: 'likely', sso: true, logo: { text: 'M', color: '#D83B01' },
    terms: t('allowed', 'Microsoft sets rules for AI services that act for you and bans only impermissible scraping.', 'https://www.microsoft.com/en-us/servicesagreement'),
    practice: ['recent_files'],
  },
  {
    id: 'gmail', name: 'Gmail (Google)', category: 'email_calendar', signInUrl: 'https://mail.google.com/',
    hosts: ['mail.google.com', 'accounts.google.com'], aliases: ['gmail', 'google mail', 'google workspace'],
    twoStep: 'likely', sso: true, logo: { text: 'G', color: '#EA4335' },
    terms: t('restricted', 'Google bans automated access that ignores its robots instructions and abusive use; a person’s own tasks at human pace are fine.', 'https://policies.google.com/terms'),
    practice: ['read_inbox'],
  },
  {
    id: 'google_calendar', name: 'Google Calendar', category: 'email_calendar', signInUrl: 'https://accounts.google.com/ServiceLogin?service=cl&continue=https://calendar.google.com/calendar/',
    hosts: ['calendar.google.com', 'accounts.google.com'], aliases: ['google calendar', 'gcal'],
    twoStep: 'likely', sso: true, logo: { text: 'C', color: '#1A73E8' },
    terms: t('restricted', 'Google bans automated access that ignores its robots instructions and abusive use; a person’s own tasks at human pace are fine.', 'https://policies.google.com/terms'),
    practice: ['read_calendar'],
  },
  /* ------------------------------------------------- team chat and meetings -- */
  {
    id: 'slack', name: 'Slack', category: 'chat_meetings', signInUrl: 'https://slack.com/signin',
    hosts: ['slack.com', 'app.slack.com'], aliases: ['slack'],
    twoStep: 'likely', sso: true, logo: { text: 'S', color: '#4A154B' },
    terms: t('no_ban_found', 'Slack uses the Salesforce Acceptable Use Policy, which has no clause against automating your own account; Slack’s API terms ban background scraping.', 'https://slack.com/acceptable-use-policy'),
    practice: ['read_channels'],
  },
  {
    id: 'teams', name: 'Microsoft Teams', category: 'chat_meetings', signInUrl: 'https://teams.microsoft.com/',
    hosts: ['teams.microsoft.com', 'login.microsoftonline.com'], aliases: ['teams', 'ms teams'],
    twoStep: 'likely', sso: true, logo: { text: 'T', color: '#5B5FC7' },
    terms: t('allowed', 'Microsoft sets rules for AI services that act for you and bans only impermissible scraping.', 'https://www.microsoft.com/en-us/servicesagreement'),
    practice: ['read_channels'],
  },
  {
    id: 'zoom', name: 'Zoom', category: 'chat_meetings', signInUrl: 'https://zoom.us/signin',
    hosts: ['zoom.us'], aliases: ['zoom'],
    twoStep: 'sometimes', sso: true, logo: { text: 'Z', color: '#0B5CFF' },
    terms: t('no_ban_found', 'Zoom’s terms ban overloading or disrupting the service; no automation clause found.', 'https://www.zoom.com/en/trust/terms/'),
    practice: ['read_meetings'],
  },
  /* ------------------------------------------------ CRM and job management -- */
  {
    id: 'acculynx', name: 'AccuLynx', category: 'crm', signInUrl: 'https://my.acculynx.com/signin',
    hosts: ['my.acculynx.com', 'app.acculynx.com'], aliases: ['acculynx', 'accu lynx'],
    twoStep: 'sometimes', sso: false, logo: { text: 'AL', color: '#00539B' },
    terms: t('no_ban_found', 'AccuLynx’s terms ban sharing passwords and unauthorized access; no automation clause found.', 'https://acculynx.com/terms-of-use/'),
    practice: ['crm_status'],
  },
  {
    id: 'jobnimbus', name: 'JobNimbus', category: 'crm', signInUrl: 'https://app.jobnimbus.com/',
    hosts: ['app.jobnimbus.com'], aliases: ['jobnimbus', 'job nimbus', 'jn'],
    twoStep: 'sometimes', sso: false, logo: { text: 'JN', color: '#F26B21' },
    terms: t('restricted', 'JobNimbus bars sharing a login with anyone other than its assigned user; Computer only acts for that user. No automation clause found.', 'https://www.jobnimbus.com/terms-of-service'),
    practice: ['crm_status'],
  },
  {
    id: 'housecallpro', name: 'Housecall Pro', category: 'crm', signInUrl: 'https://pro.housecallpro.com/app/log_in',
    hosts: ['pro.housecallpro.com'], aliases: ['housecall pro', 'housecall', 'hcp'],
    twoStep: 'sometimes', sso: false, logo: { text: 'HP', color: '#0073E6' },
    terms: t('no_ban_found', 'Housecall Pro’s terms have no automation clause.', 'https://www.housecallpro.com/terms/'),
    practice: ['crm_status'],
  },
  {
    id: 'jobber', name: 'Jobber', category: 'crm', signInUrl: 'https://secure.getjobber.com/login',
    hosts: ['secure.getjobber.com'], aliases: ['jobber', 'getjobber'],
    twoStep: 'sometimes', sso: false, logo: { text: 'J', color: '#1F8A4C' },
    terms: t('restricted', 'Jobber bans data mining, robots and scraping used to gather or extract data.', 'https://getjobber.com/terms-of-service/'),
    practice: ['crm_status'],
  },
  {
    id: 'jobtread', name: 'JobTread', category: 'crm', signInUrl: 'https://app.jobtread.com/',
    hosts: ['app.jobtread.com'], aliases: ['jobtread', 'job tread'],
    twoStep: 'rare', sso: false, logo: { text: 'JT', color: '#2B6CB0' },
    terms: t('restricted', 'JobTread bans automated processes that copy, scrape or systematically acquire content.', 'https://www.jobtread.com/terms'),
    practice: ['crm_status'],
  },
  {
    id: 'buildertrend', name: 'Buildertrend', category: 'crm', signInUrl: 'https://buildertrend.net/',
    hosts: ['buildertrend.net'], aliases: ['buildertrend', 'builder trend'],
    twoStep: 'sometimes', sso: false, logo: { text: 'BT', color: '#003865' },
    terms: t('unverified', 'Buildertrend’s terms page blocks automated reading; we could not review it.', 'https://buildertrend.com/terms-of-service/'),
    practice: ['crm_status'],
  },
  {
    id: 'companycam', name: 'CompanyCam', category: 'crm', signInUrl: 'https://app.companycam.com/users/sign_in',
    hosts: ['app.companycam.com'], aliases: ['companycam', 'company cam'],
    twoStep: 'rare', sso: false, logo: { text: 'CC', color: '#0C77D8' },
    terms: t('restricted', 'CompanyCam bans automated processes that copy, scrape or systematically acquire content.', 'https://companycam.com/terms'),
    practice: ['crm_status'],
  },
  {
    id: 'salesforce', name: 'Salesforce', category: 'crm', signInUrl: 'https://login.salesforce.com/',
    hosts: ['login.salesforce.com'], aliases: ['salesforce', 'sfdc'],
    twoStep: 'likely', sso: true, logo: { text: 'SF', color: '#00A1E0' },
    terms: t('no_ban_found', 'Salesforce’s Acceptable Use Policy limits scraping other sites with Salesforce, not automating your own account.', 'https://www.salesforce.com/company/legal/agreements/'),
    practice: ['crm_status'],
  },
  {
    id: 'hubspot', name: 'HubSpot', category: 'crm', signInUrl: 'https://app.hubspot.com/login',
    hosts: ['app.hubspot.com'], aliases: ['hubspot'],
    twoStep: 'likely', sso: true, logo: { text: 'H', color: '#FF7A59' },
    terms: t('restricted', 'HubSpot’s Acceptable Use Policy bans robots that send more requests than a person could with a normal browser.', 'https://legal.hubspot.com/acceptable-use'),
    practice: ['crm_status'],
  },
  {
    id: 'servicetitan', name: 'ServiceTitan', category: 'crm', signInUrl: 'https://go.servicetitan.com/',
    hosts: ['go.servicetitan.com', 'login.servicetitan.com'], aliases: ['servicetitan', 'service titan'],
    twoStep: 'likely', sso: true, logo: { text: 'ST', color: '#0B1F3A' },
    terms: t('flagged', 'ServiceTitan bars letting any third party, including an AI agent, use your login.', 'https://www.servicetitan.com/legal/terms-of-use'),
    practice: ['crm_status'],
  },
  /* -------------------------------------------------------------- suppliers -- */
  {
    id: 'grainger', name: 'Grainger', category: 'suppliers', signInUrl: 'https://www.grainger.com/myaccount/signin',
    hosts: ['www.grainger.com'], aliases: ['grainger'],
    twoStep: 'rare', sso: false, logo: { text: 'GR', color: '#D3262F' },
    terms: t('no_ban_found', 'Grainger’s terms of access have no automation clause; its robots file blocks AI crawlers (Computer is not a crawler).', 'https://www.grainger.com/content/general-terms-of-access'),
    practice: ['supplier_search'],
  },
  { id: 'homedepot', name: 'The Home Depot / Pro', category: 'suppliers', signInUrl: 'https://www.homedepot.com/auth/view/signin', hosts: ['www.homedepot.com'], aliases: ['home depot', 'homedepot', 'home depot pro'], twoStep: 'sometimes', sso: false, logo: { text: 'HD', color: '#F96302' },
    terms: t('flagged', 'Home Depot reportedly bans access through robots or other automated means (its terms page blocks automated fetches; not verified).', 'https://www.homedepot.com/c/Terms_of_Use'), practice: ['supplier_search'] },
  { id: 'lowes', name: 'Lowe’s / Lowe’s Pro', category: 'suppliers', signInUrl: 'https://www.lowes.com/mylowes/login', hosts: ['www.lowes.com'], aliases: ["lowe's", 'lowes', 'lowes pro'], twoStep: 'sometimes', sso: false, logo: { text: 'L', color: '#004990' },
    terms: t('flagged', 'Lowe’s reportedly bans robots or automatic processes that retrieve, index or data-mine the site (its terms page blocks automated fetches; not verified).', 'https://www.lowes.com/l/about/terms-and-conditions-of-use'), practice: ['supplier_search'] },
  { id: 'abcsupply', name: 'ABC Supply (myABCsupply)', category: 'suppliers', signInUrl: 'https://account.abcsupply.com/', hosts: ['account.abcsupply.com', 'www.abcsupply.com'], aliases: ['abc supply', 'abcsupply', 'myabcsupply', 'my abc supply'], twoStep: 'rare', sso: false, logo: { text: 'ABC', color: '#C8102E' },
    terms: t('flagged', 'ABC Supply bans any robot or automatic means to access the website for any purpose.', 'https://www.abcsupply.com/terms-of-use/'), practice: ['supplier_search'] },
  { id: 'srs', name: 'SRS Distribution / Roof Hub', category: 'suppliers', signInUrl: 'https://www.roofhub.pro/', hosts: ['www.roofhub.pro', 'www.srsdistribution.com'], aliases: ['srs', 'roof hub', 'srs distribution'], twoStep: 'rare', sso: false, logo: { text: 'SRS', color: '#00467F' },
    terms: t('flagged', 'SRS bans access by any automatic program, electronic agent or bot.', 'https://www.srsdistribution.com/en/terms-of-use/'), practice: ['supplier_search'] },
  { id: 'beacon', name: 'QXO (formerly Beacon PRO+)', category: 'suppliers', signInUrl: 'https://www.qxo.com/', hosts: ['www.qxo.com', 'login.qxo.com', 'www.becn.com'], aliases: ['beacon', 'beacon pro', 'beacon pro+', 'qxo', 'becn'], twoStep: 'rare', sso: false, logo: { text: 'B', color: '#00A651' },
    terms: t('flagged', 'QXO (formerly Beacon) bans accessing the site through any automated means.', 'https://www.qxo.com/terms-of-use'), practice: ['supplier_search'] },
  { id: 'ferguson', name: 'Ferguson', category: 'suppliers', signInUrl: 'https://www.ferguson.com/login', hosts: ['www.ferguson.com'], aliases: ['ferguson'], twoStep: 'rare', sso: false, logo: { text: 'F', color: '#003A70' },
    terms: t('flagged', 'Ferguson bans any software agent used to navigate, search or extract from the site.', 'https://www.ferguson.com/content/website-info/terms-of-sale'), practice: ['supplier_search'] },
  { id: 'sherwinwilliams', name: 'Sherwin-Williams PRO+', category: 'suppliers', signInUrl: 'https://www.sherwin-williams.com/en-us/auth/login', hosts: ['www.sherwin-williams.com'], aliases: ['sherwin williams', 'sherwin-williams', 'sherwin williams pro', 'pro+'], twoStep: 'rare', sso: false, logo: { text: 'SW', color: '#0067A0' },
    terms: t('flagged', 'Sherwin-Williams bans robots, scrapers or other automated means to access its websites.', 'https://www.sherwin-williams.com/terms-of-use'), practice: ['supplier_search'] },
  { id: 'amazonbusiness', name: 'Amazon Business', category: 'suppliers', signInUrl: 'https://www.amazon.com/gp/sign-in.html', hosts: ['www.amazon.com'], aliases: ['amazon business', 'amazon'], twoStep: 'likely', sso: false, logo: { text: 'a', color: '#232F3E' },
    terms: t('flagged', 'Amazon bans robots and requires AI agents to identify themselves; it has won a court order against an AI shopping agent.', 'https://www.amazon.com/gp/help/customer/display.html?nodeId=508088'), practice: ['supplier_search'] },
  /* ----------------------------------------------------------- measurements -- */
  {
    id: 'gafquickmeasure', name: 'GAF QuickMeasure', category: 'measurements', signInUrl: 'https://quickmeasure.gaf.com/',
    hosts: ['quickmeasure.gaf.com'], aliases: ['quickmeasure', 'gaf quickmeasure', 'quick measure'],
    twoStep: 'rare', sso: false, logo: { text: 'GAF', color: '#E31837' },
    terms: t('unverified', 'GAF’s website terms have no automation clause; the QuickMeasure terms were not reviewed in full.', 'https://www.gaf.com/en-us/about-us/privacy-legal/terms-of-use'),
    practice: ['measurement_orders'],
  },
  { id: 'eagleview', name: 'EagleView', category: 'measurements', signInUrl: 'https://my.eagleview.com/', hosts: ['my.eagleview.com', 'signin.eagleview.com'], aliases: ['eagleview', 'eagle view', 'eagleview assess', 'assess'], twoStep: 'rare', sso: false, logo: { text: 'EV', color: '#00205B' },
    terms: t('flagged', 'Re-checked 2026-10-06: EagleView’s US terms have no bot or automation clause, only a ban on obtaining material “through any means not intentionally made available”. Flag kept for review.', 'https://www.eagleview.com/terms/'), practice: ['measurement_orders'] },
  { id: 'hover', name: 'Hover', category: 'measurements', signInUrl: 'https://hover.to/onboarding/login', hosts: ['hover.to'], aliases: ['hover', 'hover.to', 'hover for carriers'], twoStep: 'rare', sso: false, logo: { text: 'HV', color: '#111111' },
    terms: t('flagged', 'Hover bans any automatic program that monitors, copies, summarizes or extracts information.', 'https://hover.to/terms-of-use/'), practice: ['measurement_orders'] },
  { id: 'roofr', name: 'Roofr', category: 'measurements', signInUrl: 'https://app.roofr.com/login', hosts: ['app.roofr.com'], aliases: ['roofr'], twoStep: 'rare', sso: false, logo: { text: 'R', color: '#0F172A' },
    terms: t('flagged', 'Roofr bans automated crawling or scraping and processes that run while you are not logged in.', 'https://roofr.com/terms'), practice: ['measurement_orders'] },
  /* ---------------------------------------------------------------- permits -- */
  {
    id: 'accela', name: 'Permit portal (Accela Citizen Access)', category: 'permits', signInUrl: 'https://aca-prod.accela.com/',
    hosts: ['aca-prod.accela.com'], aliases: ['accela', 'permit portal', 'citizen access', 'permits'],
    twoStep: 'rare', sso: false, logo: { text: 'P', color: '#4B5563' },
    terms: t('no_ban_found', 'Accela’s terms have no automation clause. Each city or county portal can add its own terms.', 'https://www.accela.com/terms-of-use/'),
    practice: ['permit_search'],
    notInPicker: 'Each city or county has its own Accela address; add yours with Custom website.',
    guide: ['Most city and county portals use Accela Citizen Access or Tyler EnerGov: Search, then Building, then enter the address or permit number.'],
  },
  /* ---------------------------------------------------- property management -- */
  { id: 'appfolio', name: 'AppFolio', category: 'property_management', signInUrl: 'https://account.appfolio.com/property/sign-in', hosts: ['account.appfolio.com'], aliases: ['appfolio', 'app folio'], twoStep: 'sometimes', sso: false, logo: { text: 'AF', color: '#0B6CB5' },
    terms: t('flagged', 'AppFolio bans robots or other automated means to access its services, and scraping or monitoring in its vendor portal.', 'https://www.appfolio.com/terms/listings'), practice: ['work_orders_open'] },
  { id: 'buildium', name: 'Buildium', category: 'property_management', signInUrl: 'https://signin.managebuilding.com/manager/public/authentication/login', hosts: ['signin.managebuilding.com'], aliases: ['buildium', 'managebuilding'], twoStep: 'sometimes', sso: false, logo: { text: 'B', color: '#1F8A70' },
    terms: t('flagged', 'Buildium bans robots or other automatic devices that monitor, copy or gather any part of the site.', 'https://www.buildium.com/website-terms-of-service/'), practice: ['work_orders_open'] },
  { id: 'realpage', name: 'RealPage Vendor Credentialing (Compliance Depot)', category: 'property_management', signInUrl: 'https://vendorcredentialing.realpage.com/webapp/login.aspx', hosts: ['vendorcredentialing.realpage.com'], aliases: ['realpage', 'real page', 'compliance depot', 'realpage vendor'], twoStep: 'sometimes', sso: true, logo: { text: 'RP', color: '#E4002B' },
    terms: t('flagged', 'RealPage bans robots or other automatic devices that monitor, copy or gather any part of the site.', 'https://www.realpage.com/legal/terms-of-use/'), practice: ['work_orders_open'] },
  { id: 'propertyware', name: 'Propertyware', category: 'property_management', signInUrl: 'https://app.propertyware.com/pw/login.jsp', hosts: ['app.propertyware.com'], aliases: ['propertyware', 'property ware'], twoStep: 'sometimes', sso: false, logo: { text: 'PW', color: '#3A7D44' },
    terms: t('flagged', 'Propertyware bans any robot or other automatic means to access the services for any purpose.', 'https://www.propertyware.com/terms-of-use/'), practice: ['work_orders_open'] },
  { id: 'entrata', name: 'Entrata', category: 'property_management', signInUrl: 'https://sso.entrata.com/entrata/login', hosts: ['sso.entrata.com', 'www.entrata.com'], aliases: ['entrata'], twoStep: 'sometimes', sso: true, logo: { text: 'E', color: '#E9582B' },
    terms: t('flagged', 'Entrata bans robots, scrapers or other automated means not provided by Entrata to access the site.', 'https://legal.entrata.com/entrata-terms-of-use'), practice: ['work_orders_open'] },
  {
    id: 'managecasa', name: 'ManageCasa', category: 'property_management', signInUrl: 'https://app.managecasa.com/',
    hosts: ['app.managecasa.com'], aliases: ['managecasa', 'manage casa'],
    twoStep: 'rare', sso: false, logo: { text: 'MC', color: '#2E5AAC' },
    terms: t('restricted', 'ManageCasa bans robots or other tools that collect, scrape or download its content or other people’s information without permission.', 'https://managecasa.com/terms-of-service'),
    practice: ['work_orders_open'],
  },
  /* ------------------------------------------- vendor and work-order portals -- */
  {
    id: 'propertymeld', name: 'Property Meld', category: 'work_orders', signInUrl: 'https://app.propertymeld.com/login/',
    hosts: ['app.propertymeld.com'], aliases: ['property meld', 'propertymeld', 'meld'],
    twoStep: 'rare', sso: false, logo: { text: 'PM', color: '#0E7C86' },
    terms: t('no_ban_found', 'Property Meld’s terms of use have no automation clause.', 'https://propertymeld.com/terms-of-use/'),
    practice: ['work_orders_open'],
  },
  {
    id: 'vendorcafe', name: 'Yardi VendorCafe', category: 'work_orders', signInUrl: 'https://prod.vendorcafe.com/content2/access/login',
    hosts: ['prod.vendorcafe.com'], aliases: ['vendorcafe', 'vendor cafe', 'yardi vendor portal', 'yardi'],
    twoStep: 'sometimes', sso: false, logo: { text: 'VC', color: '#00467F' },
    terms: t('unverified', 'Yardi’s published legal pages have no automation clause; the VendorCafe terms are shown only after sign-in.', 'https://www.yardi.com/company/legal/'),
    practice: ['work_orders_open'],
  },
  { id: 'servicechannel', name: 'ServiceChannel', category: 'work_orders', signInUrl: 'https://login.servicechannel.com/', hosts: ['login.servicechannel.com'], aliases: ['servicechannel', 'service channel'], twoStep: 'sometimes', sso: true, logo: { text: 'SC', color: '#0072CE' },
    terms: t('flagged', 'ServiceChannel bans accessing, monitoring or copying its sites with robots or any other automatic device or process.', 'https://servicechannel.com/terms/'), practice: ['work_orders_open'] },
  { id: 'corrigo', name: 'CorrigoPro', category: 'work_orders', signInUrl: 'https://am-desktop.corrigopro.com/', hosts: ['am-desktop.corrigopro.com', 'login.corrigo.com'], aliases: ['corrigo', 'corrigopro', 'corrigo pro'], twoStep: 'sometimes', sso: false, logo: { text: 'C', color: '#E30613' },
    terms: t('flagged', 'CorrigoPro’s own terms have no bot clause but bar giving your user ID or password to third parties without Corrigo’s consent; JLL’s corporate site terms ban automated queries.', 'https://help.corrigopro.com/terms-of-use/?lang=en_ca'), practice: ['work_orders_open'] },
  { id: 'latchel', name: 'Latchel', category: 'work_orders', signInUrl: 'https://app.latchel.com/login', hosts: ['app.latchel.com'], aliases: ['latchel'], twoStep: 'rare', sso: false, logo: { text: 'L', color: '#5B3FD9' },
    terms: t('flagged', 'Latchel bans any robot, scraper or other automated system that accesses the site or services.', 'https://latchel.com/terms-of-service/'), practice: ['work_orders_open'] },
  { id: 'procore', name: 'Procore', category: 'work_orders', signInUrl: 'https://login.procore.com/', hosts: ['login.procore.com', 'app.procore.com'], aliases: ['procore'], twoStep: 'sometimes', sso: true, logo: { text: 'P', color: '#F47E42' },
    terms: t('flagged', 'Procore bans robots, scrapers and other automated devices or processes that access or use its services.', 'https://procore.pactsafe.io/'), practice: ['work_orders_open'] },
  /* ------------------------------------------- insurance carriers and claims -- */
  {
    id: 'alacnet', name: 'AlacNet (Altimeter Solutions, formerly Alacrity)', category: 'insurance_claims', signInUrl: 'https://www.alacrity.net/Login.aspx',
    hosts: ['www.alacrity.net', 'alacrity.net'], aliases: ['alacrity', 'alacrity solutions', 'accltery', 'alacnet', 'altimeter', 'altimeter solutions'],
    twoStep: 'sometimes', sso: false, logo: { text: 'AN', color: '#003B71' },
    terms: t('unverified', 'Altimeter (Alacrity’s former managed-repair network) publishes no website terms; AlacNet is limited to authorized users.', 'https://altimetersolutionsgroup.com/legal/privacy-policy'),
    practice: ['claim_assignments'],
  },
  {
    id: 'allcat', name: 'Allcat ClaimAssist', category: 'insurance_claims', signInUrl: 'https://www.claimassist.com/user-management/auth/login',
    hosts: ['www.claimassist.com'], aliases: ['allcat', 'all cat', 'claimassist', 'claim assist'],
    twoStep: 'rare', sso: false, logo: { text: 'AC', color: '#B91C1C' },
    terms: t('unverified', 'ClaimAssist’s terms page did not load, so we could not review it.', 'https://www.claimassist.com/site/terms-of-use'),
    practice: ['claim_assignments'],
  },
  { id: 'accuserve', name: 'Accuserve (Code Blue)', category: 'insurance_claims', signInUrl: 'https://interiors.app.accuserve.com/login', hosts: ['interiors.app.accuserve.com'], aliases: ['accuserve', 'code blue', 'codeblue'], twoStep: 'sometimes', sso: false, logo: { text: 'AS', color: '#0054A6' },
    terms: t('flagged', 'Accuserve bans any robot or other automatic means to access or use the website for any purpose.', 'https://www.accuserve.com/terms-and-conditions'), practice: ['claim_assignments'] },
  { id: 'contractorconnection', name: 'Contractor Connection (Crawford)', category: 'insurance_claims', signInUrl: 'https://www.contractorconnection.com/Auth/login', hosts: ['www.contractorconnection.com'], aliases: ['contractor connection', 'crawford'], twoStep: 'sometimes', sso: false, logo: { text: 'CC', color: '#002D72' },
    terms: t('flagged', 'Crawford & Company, which runs Contractor Connection, bans robots, scrapers or other automated means to access its sites.', 'https://www.crawco.com/legal/terms-of-use'), practice: ['claim_assignments'] },
  { id: 'symbility', name: 'Cotality Symbility', category: 'insurance_claims', signInUrl: 'https://www.symbility.net/', hosts: ['www.symbility.net'], aliases: ['symbility', 'corelogic', 'cotality', 'mobile claims'], twoStep: 'sometimes', sso: false, logo: { text: 'Sy', color: '#00A3AD' },
    terms: t('flagged', 'Cotality bans any robot or other automatic device or process to access, monitor or retrieve any part of its services.', 'https://www.cotality.com/legal/terms-of-use'), practice: ['claim_assignments'] },
  { id: 'allstate', name: 'Allstate provider portal', notInPicker: 'Allstate’s public provider portal is for roadside and towing providers; no contractor or claims sign-in URL could be verified.', category: 'insurance_claims', signInUrl: 'https://providerportal.allstate.com/', hosts: ['providerportal.allstate.com'], aliases: ['allstate'], twoStep: 'sometimes', sso: false, logo: { text: 'A', color: '#0033A0' },
    terms: t('flagged', 'Allstate bans bots, scrapers and any automated process that retrieves or gathers content from its site.', 'https://www.allstate.com/terms'), practice: [] },
  /* -------------------------------------------- restoration job management -- */
  {
    id: 'encircle', name: 'Encircle', category: 'restoration', signInUrl: 'https://encircleapp.com/login',
    hosts: ['encircleapp.com', 'auth.encircleapp.com'], aliases: ['encircle', 'encircle app'],
    twoStep: 'rare', sso: false, logo: { text: 'En', color: '#00A88F' },
    terms: t('no_ban_found', 'Encircle’s terms of service have no automation clause; the account holder answers for its users.', 'https://www.getencircle.com/home/terms-of-service/'),
    practice: ['restoration_jobs'],
  },
  {
    id: 'albi', name: 'Albi', category: 'restoration', signInUrl: 'https://app.albiware.com/login',
    hosts: ['app.albiware.com'], aliases: ['albi', 'albiware'],
    twoStep: 'rare', sso: false, logo: { text: 'Al', color: '#1E3A8A' },
    terms: t('no_ban_found', 'Albi’s terms and conditions have no automation clause.', 'https://albiware.com/terms-and-conditions/'),
    practice: ['restoration_jobs'],
  },
  {
    id: 'docusketch', name: 'DocuSketch', category: 'restoration', signInUrl: 'https://app.docusketch.com/portal/',
    hosts: ['app.docusketch.com'], aliases: ['docusketch', 'docu sketch'],
    twoStep: 'rare', sso: false, logo: { text: 'DS', color: '#F15A24' },
    terms: t('no_ban_found', 'DocuSketch’s terms of service have no automation clause.', 'https://www.docusketch.com/terms-of-service'),
    practice: ['restoration_jobs'],
  },
  {
    id: 'xcelerate', name: 'Xcelerate', category: 'restoration', signInUrl: 'https://app.xceleraterestoration.com/',
    hosts: ['app.xceleraterestoration.com'], aliases: ['xcelerate', 'xcelerate restoration', 'xl restoration'],
    twoStep: 'sometimes', sso: false, logo: { text: 'X', color: '#0F4C81' },
    terms: t('no_ban_found', 'Xcelerate’s terms and conditions have no automation clause.', 'https://www.xlrestorationsoftware.com/terms-and-conditions'),
    practice: ['restoration_jobs'],
  },
  { id: 'nextgear', name: 'DASH by Next Gear Solutions', category: 'restoration', signInUrl: 'https://dash-ngs.net/NextGear/Enterprise/Module/User/Login.aspx', hosts: ['dash-ngs.net', 'www.dash-ngs.net'], aliases: ['dash', 'next gear', 'nextgear', 'next gear solutions', 'nextgen'], twoStep: 'sometimes', sso: false, logo: { text: 'NG', color: '#1D4F91' },
    terms: t('flagged', 'Next Gear (Cotality) bans robots, crawlers, data mining and systematic retrieval from DASH without written permission.', 'https://www.nextgearsolutions.com/legal/'), practice: ['restoration_jobs'] },
  { id: 'matterport', name: 'Matterport', category: 'restoration', signInUrl: 'https://my.matterport.com/', hosts: ['my.matterport.com', 'authn.matterport.com'], aliases: ['matterport'], twoStep: 'sometimes', sso: false, logo: { text: 'M', color: '#1C1C1C' },
    terms: t('flagged', 'Matterport bans AI agents, robots, scrapers and any other automated means to access its website or service.', 'https://matterport.com/terms-of-use'), practice: ['sign_in_check'] },
  /* -------------------------------------------------------------- financing -- */
  {
    id: 'servicefinance', name: 'Service Finance Company', category: 'financing', signInUrl: 'https://apps.svcfin.com/dealerportal/',
    hosts: ['apps.svcfin.com'], aliases: ['service finance', 'svcfin', 'sfc'],
    twoStep: 'sometimes', sso: false, logo: { text: 'SFC', color: '#00594F' },
    terms: t('unverified', 'We found no published website terms with an automation clause.', 'https://www.svcfin.com/'),
    practice: ['financing_status'],
  },
  { id: 'greensky', name: 'GreenSky', category: 'financing', signInUrl: 'https://portal.greensky.com/', hosts: ['portal.greensky.com', 'auth.prod.greensky.com', 'www.greensky.com'], aliases: ['greensky'], twoStep: 'sometimes', sso: false, logo: { text: 'GS', color: '#00A859' },
    terms: t('flagged', 'GreenSky bans robots, scripts or other automatic means to access or collect information.', 'https://www.greensky.com/terms/website_terms_of_use/'), practice: ['financing_status'] },
  { id: 'hearth', name: 'Hearth', category: 'financing', signInUrl: 'https://app.gethearth.com/login', hosts: ['app.gethearth.com'], aliases: ['hearth'], twoStep: 'rare', sso: false, logo: { text: 'He', color: '#F2542D' },
    terms: t('flagged', 'Hearth bans robots, scrapers and any non-manual access method.', 'https://gethearth.com/terms/'), practice: ['financing_status'] },
  /* ------------------------------------------------ accounting and payments -- */
  {
    id: 'quickbooks', name: 'QuickBooks Online', category: 'accounting_payments', signInUrl: 'https://qbo.intuit.com/',
    hosts: ['qbo.intuit.com', 'accounts.intuit.com'], aliases: ['quickbooks', 'qbo', 'intuit'],
    twoStep: 'likely', sso: false, logo: { text: 'QB', color: '#2CA01C' },
    terms: t('restricted', 'Intuit bans scraping content that is not yours, and its Bill Pay add-on bans robots (Computer does not use Bill Pay).', 'https://www.intuit.com/legal/terms/en-us/quickbooks/online/'),
    practice: ['accounting_recent'],
  },
  {
    id: 'stripe', name: 'Stripe', category: 'accounting_payments', signInUrl: 'https://dashboard.stripe.com/login',
    hosts: ['dashboard.stripe.com'], aliases: ['stripe'],
    twoStep: 'likely', sso: true, logo: { text: 'S', color: '#635BFF' },
    terms: t('allowed', 'Stripe permits AI agents; the account holder is responsible for what the agent does.', 'https://stripe.com/legal/ssa'),
    practice: ['accounting_recent'],
  },
  { id: 'xero', name: 'Xero', category: 'accounting_payments', signInUrl: 'https://login.xero.com/', hosts: ['login.xero.com', 'go.xero.com'], aliases: ['xero'], twoStep: 'likely', sso: false, logo: { text: 'X', color: '#13B5EA' },
    terms: t('flagged', 'Xero’s developer terms ban browser automation that simulates user actions without its authorization; its subscriber terms have no automation clause.', 'https://developer.xero.com/xero-developer-platform-terms-conditions'), practice: ['accounting_recent'] },
  { id: 'square', name: 'Square', category: 'accounting_payments', signInUrl: 'https://app.squareup.com/login', hosts: ['app.squareup.com', 'squareup.com'], aliases: ['square'], twoStep: 'likely', sso: false, logo: { text: 'Sq', color: '#000000' },
    terms: t('flagged', 'Square bans accessing or monitoring its systems with robots or other automated means.', 'https://squareup.com/us/en/legal/general/ua'), practice: ['accounting_recent'] },
  { id: 'paypal', name: 'PayPal', category: 'accounting_payments', signInUrl: 'https://www.paypal.com/signin', hosts: ['www.paypal.com'], aliases: ['paypal'], twoStep: 'likely', sso: false, logo: { text: 'PP', color: '#003087' },
    terms: t('flagged', 'PayPal bans robots or other automatic devices that monitor or copy its websites.', 'https://www.paypal.com/us/legalhub/paypal/useragreement-full'), practice: ['accounting_recent'] },
  /* ----------------------------------------------------------- payroll / HR -- */
  {
    id: 'gusto', name: 'Gusto', category: 'payroll_hr', signInUrl: 'https://app.gusto.com/login',
    hosts: ['app.gusto.com', 'login.gusto.com'], aliases: ['gusto'],
    twoStep: 'likely', sso: false, logo: { text: 'Gu', color: '#F45D48' },
    terms: t('restricted', 'Gusto bars third parties that use an admin login to harvest, crawl or scrape data.', 'https://gusto.com/about/terms'),
    practice: ['payroll_next'],
  },
  { id: 'adp', name: 'ADP', category: 'payroll_hr', signInUrl: 'https://workforcenow.adp.com/', hosts: ['workforcenow.adp.com', 'online.adp.com'], aliases: ['adp', 'adp workforce now', 'adp run'], twoStep: 'likely', sso: true, logo: { text: 'ADP', color: '#D0271D' },
    terms: t('flagged', 'ADP bars unauthorized third parties from accessing data through scrapers or other automated means.', 'https://www.adp.com/legal.aspx'), practice: ['payroll_next'] },
  /* ------------------------------------------------------ docs and e-sign -- */
  {
    id: 'google_drive', name: 'Google Drive', category: 'docs_esign', signInUrl: 'https://accounts.google.com/ServiceLogin?service=wise&continue=https://drive.google.com/',
    hosts: ['drive.google.com', 'accounts.google.com'], aliases: ['google drive', 'drive', 'google docs'],
    twoStep: 'likely', sso: true, logo: { text: 'D', color: '#188038' },
    terms: t('restricted', 'Google bans automated access that ignores its robots instructions and abusive use; a person’s own tasks at human pace are fine.', 'https://policies.google.com/terms'),
    practice: ['recent_files'],
  },
  {
    id: 'dropbox', name: 'Dropbox', category: 'docs_esign', signInUrl: 'https://www.dropbox.com/login',
    hosts: ['www.dropbox.com'], aliases: ['dropbox'],
    twoStep: 'sometimes', sso: true, logo: { text: 'Db', color: '#0061FE' },
    terms: t('restricted', 'Dropbox requires its publicly supported interfaces (the website is one) and bans scraping.', 'https://www.dropbox.com/acceptable_use'),
    practice: ['recent_files'],
  },
  {
    id: 'docusign', name: 'DocuSign', category: 'docs_esign', signInUrl: 'https://account.docusign.com/',
    hosts: ['account.docusign.com', 'app.docusign.com'], aliases: ['docusign', 'docu sign'],
    twoStep: 'sometimes', sso: true, logo: { text: 'DS', color: '#4C00FF' },
    terms: t('no_ban_found', 'DocuSign’s website terms have no automation clause. Signing for someone else is never automated.', 'https://www.docusign.com/legal/terms-and-conditions/web-site'),
    practice: ['recent_envelopes'],
  },
  {
    id: 'adobe', name: 'Adobe (Acrobat Sign, Document Cloud)', category: 'docs_esign', signInUrl: 'https://account.adobe.com/',
    hosts: ['account.adobe.com', 'auth.services.adobe.com'], aliases: ['adobe', 'acrobat', 'adobe sign'],
    twoStep: 'sometimes', sso: true, logo: { text: 'A', color: '#EB1000' },
    terms: t('restricted', 'Adobe bans data mining, scraping and automated extraction, and limits access to its provided interfaces.', 'https://www.adobe.com/legal/terms.html'),
    practice: ['recent_files'],
  },
  { id: 'box', name: 'Box', category: 'docs_esign', signInUrl: 'https://account.box.com/login', hosts: ['account.box.com', 'app.box.com'], aliases: ['box'], twoStep: 'sometimes', sso: true, logo: { text: 'box', color: '#0061D5' },
    terms: t('flagged', 'Box bans any automated process or service, such as a bot, to access or use the service.', 'https://www.box.com/legal/termsofservice'), practice: ['recent_files'] },
  /* --------------------------------------------------- marketing and reviews -- */
  {
    id: 'google_business', name: 'Google Business Profile', category: 'marketing_reviews', signInUrl: 'https://accounts.google.com/ServiceLogin?continue=https://business.google.com/',
    hosts: ['business.google.com', 'accounts.google.com'], aliases: ['google business profile', 'google my business', 'gbp'],
    twoStep: 'likely', sso: true, logo: { text: 'GB', color: '#4285F4' },
    terms: t('restricted', 'Google bans automated access that ignores its robots instructions and abusive use; a person’s own tasks at human pace are fine.', 'https://policies.google.com/terms'),
    practice: ['sign_in_check'],
  },
  { id: 'meta_business', name: 'Meta Business (Facebook)', category: 'marketing_reviews', signInUrl: 'https://www.facebook.com/login/?next=https%3A%2F%2Fbusiness.facebook.com%2F', hosts: ['business.facebook.com', 'www.facebook.com'], aliases: ['facebook', 'meta business', 'instagram'], twoStep: 'likely', sso: false, logo: { text: 'f', color: '#0866FF' },
    terms: t('flagged', 'Meta bans accessing or collecting data with automated means without its permission, even when logged in.', 'https://www.facebook.com/terms'), practice: ['sign_in_check'] },
  { id: 'linkedin', name: 'LinkedIn', category: 'marketing_reviews', signInUrl: 'https://www.linkedin.com/login', hosts: ['www.linkedin.com'], aliases: ['linkedin'], twoStep: 'sometimes', sso: false, logo: { text: 'in', color: '#0A66C2' },
    terms: t('flagged', 'LinkedIn bans bots, scripts and browser add-ons that access, scrape or copy the service.', 'https://www.linkedin.com/legal/user-agreement'), practice: ['sign_in_check'] },
  { id: 'yelp_business', name: 'Yelp for Business', category: 'marketing_reviews', signInUrl: 'https://biz.yelp.com/login', hosts: ['biz.yelp.com'], aliases: ['yelp', 'yelp for business'], twoStep: 'rare', sso: false, logo: { text: 'Y', color: '#D32323' },
    terms: t('flagged', 'Yelp bans any robot or automated means to access any part of the service.', 'https://terms.yelp.com/tos/en_us/20260101_en_us/'), practice: ['sign_in_check'] },
  { id: 'angi', name: 'Angi (Angi Leads)', category: 'marketing_reviews', signInUrl: 'https://office.angi.com/', hosts: ['office.angi.com', 'id.angi.com', 'pro.angi.com'], aliases: ['angi', 'angies list', 'homeadvisor'], twoStep: 'rare', sso: false, logo: { text: 'An', color: '#FF6153' },
    terms: t('flagged', 'Angi bans access, monitoring or copying through robots, spiders or other automatic means.', 'https://www.angi.com/terms/'), practice: ['sign_in_check'] },
  { id: 'thumbtack', name: 'Thumbtack for Pros', category: 'marketing_reviews', signInUrl: 'https://www.thumbtack.com/login', hosts: ['www.thumbtack.com'], aliases: ['thumbtack'], twoStep: 'rare', sso: false, logo: { text: 'Tt', color: '#009FD9' },
    terms: t('flagged', 'Thumbtack bans robots, spiders or scrapers that access its platform.', 'https://www.thumbtack.com/terms/'), practice: ['sign_in_check'] },
  { id: 'nextdoor', name: 'Nextdoor', category: 'marketing_reviews', signInUrl: 'https://nextdoor.com/login/', hosts: ['nextdoor.com'], aliases: ['nextdoor'], twoStep: 'rare', sso: false, logo: { text: 'N', color: '#8ED500' },
    terms: t('flagged', 'Nextdoor bans scripts, robots and browser add-ons that scrape or copy the service.', 'https://nextdoorcrm.my.site.com/s/article/Member-Agreement-2024'), practice: ['sign_in_check'] },
  /* ----------------------------------------------------------------- hiring -- */
  { id: 'indeed', name: 'Indeed for Employers', category: 'hiring', signInUrl: 'https://secure.indeed.com/auth', hosts: ['secure.indeed.com', 'employers.indeed.com'], aliases: ['indeed'], twoStep: 'sometimes', sso: false, logo: { text: 'i', color: '#2164F3' },
    terms: t('flagged', 'Indeed bans bots and scripts outside its official tools, and scraping.', 'https://www.indeed.com/legal'), practice: ['sign_in_check'] },
  /* ------------------------------------------------------------ general web -- */
  {
    id: 'practice_signin', name: 'Practice site: sign-in', category: 'general', signInUrl: 'https://the-internet.herokuapp.com/login',
    hosts: ['the-internet.herokuapp.com'], aliases: ['the internet test site'],
    twoStep: 'rare', sso: false, logo: { text: 'TI', color: '#6B7280' }, publicTestSite: true,
    terms: t('allowed', 'A public test site built for practicing browser automation.', 'https://github.com/saucelabs/the-internet'),
    practice: ['sign_in_check', 'download_file'],
  },
  {
    id: 'practice_forms', name: 'Practice site: web forms', category: 'general', signInUrl: 'https://www.selenium.dev/selenium/web/web-form.html',
    hosts: ['www.selenium.dev'], aliases: ['selenium test form'],
    twoStep: 'rare', sso: false, logo: { text: 'Se', color: '#43B02A' }, publicTestSite: true,
    terms: t('allowed', 'Selenium’s public test pages exist for browser automation practice.', 'https://www.selenium.dev/'),
    practice: ['fill_form', 'upload_file'],
  },
];

const MS_ID = ['login.microsoftonline.com', 'login.live.com'];
const GOOGLE_ID = ['accounts.google.com'];
const live = (flow: SignInRecipe['flow'], more: Partial<SignInRecipe> = {}): SignInRecipe => ({ flow, checked: 'live_page', ...more });
const GOOGLE_CODE = 'Google may ask for a code or a tap on the person’s phone; that step goes to the person.';
const MS_CODE = 'Microsoft may ask for a code or an Authenticator number; that step goes to the person.';

/** Sign-in recipes for every site Computer may use (checked on the live sign-in pages, 2026-10-06). */
export const SIGN_IN_RECIPES: Record<string, SignInRecipe> = {
  outlook: live('username_first', { identityHosts: MS_ID, note: MS_CODE }),
  microsoft365: live('open_first', { openWith: ['Sign in'], identityHosts: MS_ID, note: MS_CODE }),
  teams: live('username_first', { identityHosts: MS_ID, note: MS_CODE }),
  gmail: live('username_first', { identityHosts: GOOGLE_ID, note: GOOGLE_CODE }),
  google_calendar: live('username_first', { identityHosts: GOOGLE_ID, note: GOOGLE_CODE }),
  google_drive: live('username_first', { identityHosts: GOOGLE_ID, note: GOOGLE_CODE }),
  google_business: live('username_first', { identityHosts: GOOGLE_ID, note: GOOGLE_CODE }),
  slack: { flow: 'username_first', checked: 'blocked_probe', note: 'Slack often emails a sign-in code instead of asking for a password; that code goes to the person.' },
  zoom: live('username_first'),
  acculynx: live('one_page'),
  jobnimbus: live('one_page'),
  housecallpro: live('one_page'),
  jobber: live('one_page', { identityHosts: ['login.auth.getjobber.com'] }),
  jobtread: live('one_page'),
  buildertrend: live('one_page', { identityHosts: ['login.buildertrend.com'], note: 'Buildertrend may show a captcha; that goes to the person.' }),
  companycam: live('one_page'),
  salesforce: live('username_first', { note: 'Company Salesforce accounts may use a custom domain or single sign-on.' }),
  hubspot: live('username_first'),
  grainger: { flow: 'one_page', checked: 'blocked_probe' },
  gafquickmeasure: live('open_first', { openWith: ['Login', 'LOGIN', 'Log in', 'Sign in'] }),
  accela: live('open_first', { openWith: ['Login', 'Log in', 'Sign in'], note: 'Searching permits needs no sign-in on most portals.' }),
  managecasa: live('one_page'),
  propertymeld: live('one_page'),
  vendorcafe: live('username_first', { note: 'VendorCafe may show a captcha; that goes to the person.' }),
  alacnet: live('one_page'),
  allcat: live('one_page'),
  encircle: live('username_first', { identityHosts: ['auth.encircleapp.com'] }),
  albi: live('username_first'),
  docusketch: live('one_page'),
  xcelerate: live('one_page', { note: 'Accounts that use “Sign In With Google” or Microsoft need that account saved instead.' }),
  servicefinance: live('one_page'),
  quickbooks: live('username_first', { identityHosts: ['accounts.intuit.com'], note: 'Intuit usually sends a code by text or email; that goes to the person.' }),
  stripe: live('one_page', { note: 'Stripe asks for a code from the person’s authenticator app or phone.' }),
  gusto: live('username_first', { identityHosts: ['login.gusto.com'], note: 'Gusto asks for a code; that goes to the person.' }),
  dropbox: live('username_first'),
  docusign: live('username_first'),
  adobe: live('username_first', { identityHosts: ['auth.services.adobe.com'] }),
  practice_signin: live('one_page'),
  // Added back by the customer's decision (2026-10-06); terms flags stay staff-only data.
  servicetitan: live('username_first', { identityHosts: ['login.servicetitan.com'], note: 'ServiceTitan may ask for a code; that goes to the person.' }),
  homedepot: live('username_first', { note: 'Home Depot may send a code by text or email; that goes to the person.' }),
  lowes: live('username_first', { note: 'Lowe’s may send a code by text or email; that goes to the person.' }),
  abcsupply: live('one_page'),
  srs: live('one_page', { note: 'Roof Hub signs in from its home page.' }),
  beacon: live('open_first', { openWith: ['Login', 'Log in', 'Sign in'], identityHosts: ['login.qxo.com'] }),
  ferguson: live('one_page'),
  sherwinwilliams: { flow: 'username_first', checked: 'blocked_probe', note: 'Sherwin-Williams blocks automated browsers at times; if it does, Computer hands the sign-in to the person.' },
  amazonbusiness: { flow: 'username_first', checked: 'blocked_probe', note: 'Amazon often shows automated browsers a stop page or asks for a code; Computer then hands the sign-in to the person.' },
  eagleview: live('username_first', { identityHosts: ['signin.eagleview.com'] }),
  hover: live('username_first', { note: 'Hover emails a one-time sign-in link instead of asking for a password; the person opens that link.' }),
  roofr: live('one_page'),
  appfolio: live('one_page'),
  buildium: live('one_page'),
  realpage: live('one_page'),
  propertyware: live('one_page'),
  entrata: live('username_first'),
  servicechannel: live('one_page'),
  corrigo: live('one_page', { identityHosts: ['login.corrigo.com'] }),
  latchel: live('one_page'),
  procore: live('username_first'),
  accuserve: live('username_first'),
  contractorconnection: { flow: 'one_page', checked: 'blocked_probe', note: 'Contractor Connection blocks automated browsers at times; if it does, Computer hands the sign-in to the person.' },
  symbility: live('one_page'),
  nextgear: live('one_page'),
  matterport: live('one_page', { identityHosts: ['authn.matterport.com'] }),
  greensky: live('one_page', { identityHosts: ['auth.prod.greensky.com'] }),
  hearth: live('one_page'),
  xero: live('one_page', { note: 'Xero asks for a code from the person’s authenticator app.' }),
  square: live('username_first', { note: 'Square may send a code by text; that goes to the person.' }),
  paypal: { flow: 'username_first', checked: 'blocked_probe', note: 'PayPal blocks automated browsers at times and may send a code; both go to the person.' },
  adp: live('username_first', { identityHosts: ['online.adp.com'], note: 'ADP may send a code by text or email; that goes to the person.' }),
  box: live('username_first'),
  meta_business: live('one_page', { note: 'Facebook may ask for a code or a confirmation on the person’s phone; that goes to the person.' }),
  linkedin: live('one_page', { note: 'LinkedIn may ask for a code sent by email; that goes to the person.' }),
  yelp_business: { flow: 'one_page', checked: 'blocked_probe' },
  angi: live('one_page', { identityHosts: ['id.angi.com'] }),
  thumbtack: live('one_page'),
  nextdoor: live('one_page'),
  indeed: live('username_first', { note: 'Indeed may email a code instead of asking for a password; that code goes to the person.' }),
};

export const SITE_CATALOG: CatalogSite[] = RAW_SITES.map((s) => ({
  ...s,
  signIn: SIGN_IN_RECIPES[s.id] ?? null,
}));

/** Starter playbook hints per category, used until Computer has a learned playbook for the site. */
export const CATEGORY_GUIDES: Record<SiteCategory, string[]> = {
  email_calendar: [
    'Mail apps put New or Compose at the top left and the folder list (Inbox, Sent, Drafts) down the left side.',
    'Opening a message only reads it; Send, Delete and Move change things.',
  ],
  chat_meetings: ['Channels or chats are listed on the left; the newest messages are at the bottom of a conversation.', 'Posting a message is a send: it needs approval.'],
  crm: [
    'Job management apps list jobs or projects from the main menu (Jobs, Projects, Pipeline or Board). Use the list search or filters to find one job.',
    'A job page shows status or milestone near the top; tabs hold documents, photos, tasks and notes.',
  ],
  suppliers: ['Use the site search box and its Search button, then read name, price and availability from the results.', 'Add to cart is safe; Place order needs approval.'],
  measurements: ['Reports or orders are listed on the dashboard with their status; open one to read its details.', 'Ordering a new report costs money: it needs approval.'],
  permits: [
    'City and county permit portals usually run Accela Citizen Access, Tyler EnerGov or a similar system: choose Search (often under Building), then search by address or permit number.',
    'Applying for a permit or paying a fee needs approval.',
  ],
  property_management: [
    'Property management apps put work orders or maintenance requests in the main menu; filter by status (Open, Assigned, In progress).',
    'Accepting, scheduling or closing a work order, and uploading an invoice, need approval.',
  ],
  work_orders: [
    'Vendor portals list work orders with their status, property and due date; open one to read details and notes.',
    'Checking in, accepting, completing a work order or sending an invoice needs approval.',
  ],
  insurance_claims: [
    'Claims and contractor portals list assignments or claims with status; search by claim number or the policyholder’s last name.',
    'Accepting an assignment, uploading documents or submitting an estimate needs approval.',
  ],
  restoration: [
    'Restoration apps list jobs or claims on the dashboard; search by job name, claim number or address, then open the job to read status, notes, photos and documents.',
    'Changing a job’s status, sending a report to a carrier or uploading documents needs approval.',
  ],
  financing: ['Lender portals list applications with their status on the dashboard; use search to find one customer.', 'Submitting an application needs approval.'],
  accounting_payments: ['Invoices, payments and customers are in the left or top menu; lists sort newest first.', 'Sending an invoice, recording a payment or refunding needs approval.'],
  payroll_hr: ['The dashboard shows the next payroll date and anything due.', 'Running payroll or changing pay needs approval.'],
  docs_esign: ['Recent files or envelopes are on the home page; use search to find a document.', 'Sending for signature, signing or deleting needs approval.'],
  marketing_reviews: ['Business profile tools show reviews, messages and insights from the home page.', 'Replying publicly is a post: it needs approval.'],
  hiring: ['Job posts and candidates are listed on the dashboard.'],
  general: ['Read the page outline for fields and buttons; fill fields in order and check them before the final button.'],
};

/** The sign-in steps in plain words (shown on Logins and given to the model as a hint). */
export function signInStepsLine(r: SignInRecipe, audience: 'model' | 'person' = 'model'): string {
  const steps =
    r.flow === 'one_page'
      ? 'Username and password on one page'
      : r.flow === 'username_first'
        ? 'Username, then Next, then password'
        : `Click “${r.openWith?.[0] ?? 'Sign in'}”, then username and password`;
  const note = r.note && audience === 'person' ? r.note.replace(/the person’s/g, 'your').replace(/the person/g, 'you') : r.note;
  return `${steps}. Computer fills in the saved login itself${note ? `. ${note}` : '.'}`;
}

/**
 * Starter playbook for signing in, seeded for every ready site before
 * Computer has learned anything: open the official sign-in page, open the
 * form if it sits behind a link, then the server fills the saved login.
 * There is no typed step: usernames and passwords never become playbook
 * slots and never reach the model.
 */
export function starterSignInPlaybook(site: CatalogSite): PlaybookStep[] {
  if (!site.signIn) return [];
  const steps: PlaybookStep[] = [{ kind: 'navigate', url: site.signInUrl }];
  if (site.signIn.flow === 'open_first' && site.signIn.openWith?.length) {
    steps.push({ kind: 'click', target: { role: 'link', name: site.signIn.openWith[0], tag: null } });
  }
  steps.push({ kind: 'explore', note: 'Use the saved login (sign_in_saved): the server fills it in. A code or captcha goes to the person.' });
  return steps;
}

/** Starter hints for a site: how to sign in, its own guide, then its category's. */
export function siteGuideFor(host: string | null | undefined): string[] {
  const site = catalogSiteForHost(host);
  if (!site) return [];
  const signIn = site.signIn ? [`Sign-in: ${signInStepsLine(site.signIn)}`] : [];
  return [...signIn, ...(site.guide ?? []), ...CATEGORY_GUIDES[site.category]].slice(0, 6);
}

/** Hosts where a saved password for this catalog site may be typed: its own hosts and its identity provider. */
export function signInHostsFor(host: string | null | undefined): string[] {
  const site = catalogSiteForHost(host);
  if (!site?.signIn) return [];
  return [...site.hosts, ...(site.signIn.identityHosts ?? [])];
}

/** Sites never automated: Verisk's EULA bans AI and automation tools (pending Verisk's permission). */
export const EXCLUDED_SITES = [
  { name: 'Xactimate', hosts: ['identity.xactware.com', 'xactimate.com', 'xactware.com'], reason: 'Verisk’s EULA prohibits AI and automation tools.' },
  { name: 'XactAnalysis', hosts: ['www.xactanalysis.com', 'xactanalysis.com'], reason: 'Verisk’s EULA prohibits AI and automation tools.' },
  { name: 'Restoration Manager', hosts: ['rl.restorationmanager.net', 'restorationmanager.net'], reason: 'A Verisk (Xactware) product; signing in accepts Xactware’s license, which prohibits AI and automation tools.' },
  { name: 'ClaimXperience', hosts: ['www.claimxperience.com', 'claimxperience.com'], reason: 'A Verisk product; Verisk’s terms prohibit AI and automation tools.' },
];

const EXCLUDED_DOMAINS = ['xactware.com', 'xactimate.com', 'xactanalysis.com', 'claimxperience.com', 'restorationmanager.net', 'verisk.com'];

function hostMatches(host: string, candidate: string): boolean {
  const h = host.toLowerCase();
  const c = candidate.toLowerCase();
  return h === c || h.endsWith(`.${c}`) || c.endsWith(`.${h}`);
}

/** The catalog entry for a host (any listed host, or its registrable domain). */
export function catalogSiteForHost(host: string | null | undefined): CatalogSite | null {
  if (!host) return null;
  const h = host.toLowerCase();
  return (
    SITE_CATALOG.find((s) => s.hosts.some((x) => x === h)) ??
    SITE_CATALOG.find((s) => s.hosts.some((x) => hostMatches(h, x.split('.').slice(-2).join('.')) && !['google.com', 'microsoft.com', 'microsoftonline.com', 'amazon.com'].includes(x.split('.').slice(-2).join('.')))) ??
    null
  );
}

/**
 * True when Computer must not practice on or learn playbooks for this site:
 * the Verisk sites (EXCLUDED_SITES). A terms flag in the catalog is
 * staff-visible data only and does not restrict anything.
 */
export function isAutomationRestrictedSite(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  return EXCLUDED_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Entries shown in the Logins picker: every catalog site except practice-only test sites and notInPicker entries. */
export function pickerSites(): CatalogSite[] {
  return SITE_CATALOG.filter((s) => !s.publicTestSite && !s.notInPicker);
}

/** One picker entry as the Logins page sees it (no terms internals beyond a short note). */
export interface LoginCatalogEntry {
  id: string;
  name: string;
  category: SiteCategory;
  signInUrl: string;
  host: string;
  aliases: string[];
  twoStep: CatalogSite['twoStep'];
  sso: boolean;
  logo: CatalogSite['logo'];
  /** Always null: the Logins UI shows no terms warnings (terms verdicts are staff-only data). Kept for API compatibility. */
  termsNote: string | null;
  /** Practice task keys and playbook task types this site uses. */
  practice: string[];
  /** How Computer signs in, in plain words: every picker site has one, so it works right after saving the login. */
  signInSteps: string;
}

export interface LoginCatalogView {
  /** terms: extra search words for the category (data, so the UI has no per-site lists). */
  categories: Array<{ id: SiteCategory; label: string; terms: string[] }>;
  sites: LoginCatalogEntry[];
}

/**
 * The "Add a login" catalog: every ready site, each with its sign-in steps.
 * Terms verdicts (including the "flagged" ones) are not shown to customers;
 * they stay in the catalog for staff. Verisk sites are never listed. People
 * can still add any other site with "Custom website".
 */
export function loginCatalogView(): LoginCatalogView {
  const sites = pickerSites().map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    signInUrl: s.signInUrl,
    host: s.hosts[0],
    aliases: s.aliases,
    twoStep: s.twoStep,
    sso: s.sso,
    logo: s.logo,
    termsNote: null,
    practice: s.practice.map((p) => `${s.id}.${p}`),
    signInSteps: s.signIn ? signInStepsLine(s.signIn, 'person') : '',
  }));
  const used = new Set(sites.map((s) => s.category));
  const categories = (Object.keys(CATEGORY_LABELS) as SiteCategory[])
    .filter((c) => used.has(c))
    .map((id) => ({ id, label: CATEGORY_LABELS[id], terms: CATEGORY_SEARCH_TERMS[id] ?? [] }));
  return { categories, sites };
}
