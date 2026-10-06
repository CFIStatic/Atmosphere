/**
 * The standard practice tasks Computer runs every day against the practice
 * org (the App Review demo org). Each one is read-only or stops before the
 * submit-type click, so a practice run never sends, orders or submits.
 *
 * Tasks are generated from the site catalog (catalog/sites.ts): every site
 * whose terms allow it gets the practice templates listed on its entry. A
 * task that needs a saved Login is skipped with "needs login" until an admin
 * saves one for that site on the practice org's Logins page. Public test
 * sites (built for automation practice) cover sign-in, forms, uploads and
 * downloads without any Login.
 *
 * Not here: Xactimate / XactAnalysis / ClaimXperience / Restoration Manager,
 * which are excluded because Verisk's EULA prohibits AI and automation tools
 * (pending Verisk's permission). Sites whose terms flag automation are
 * practiced like any other, by the customer's choice; the flag is staff data.
 */
import { SITE_CATALOG, type CatalogSite, type PracticeTemplate } from '../../catalog/sites.js';
import type { PracticeMode } from '../store.js';

export interface PracticeTask {
  key: string;
  site: string;
  /** Catalog entry this task belongs to. */
  catalogId: string;
  /** Host a saved Login must match (null = public site, no Login needed). */
  loginHost: string | null;
  label: string;
  taskType: string;
  mode: PracticeMode;
  startUrl: string;
  instructions: string;
  params?: Record<string, string>;
  success?: { urlIncludes?: string; textIncludes?: string; downloaded?: boolean };
  maxSteps: number;
}

/** The practice org's own address: the only recipient a practice draft ever names. */
export const PRACTICE_MAILBOX = 'appreview@atmosphereteam.com';

/** Publicly documented test account on the-internet test site (not a secret). */
export const PRACTICE_SIGNIN_HOST = 'the-internet.herokuapp.com';

const READ_ONLY = 'This is a read-only practice run: do not change, submit, send, post or buy anything.';

interface TemplateSpec {
  label: (s: CatalogSite) => string;
  mode: PracticeMode;
  instructions: (s: CatalogSite) => string;
  params?: Record<string, string>;
  success?: PracticeTask['success'];
  startUrl?: string;
  maxSteps: number;
}

const signIn = (s: CatalogSite) => `Sign in to ${s.name} with the saved Login.`;

const TEMPLATES: Record<PracticeTemplate, TemplateSpec> = {
  read_inbox: {
    label: (s) => `${s.name}: read the inbox`,
    mode: 'read_only',
    instructions: (s) => `${signIn(s)} Report the sender and subject of the newest three messages in the inbox. ${READ_ONLY} Do not open attachments, reply, move or delete anything.`,
    maxSteps: 20,
  },
  draft_email: {
    label: (s) => `${s.name}: draft an email, stop before Send`,
    mode: 'stop_before_submit',
    params: { recipient: PRACTICE_MAILBOX, title: 'Atmosphere practice draft', message: 'This is an automated practice draft. Please ignore it.' },
    instructions: (s) =>
      `${signIn(s)} Start a new email to ${PRACTICE_MAILBOX} with the subject "Atmosphere practice draft" and the body "This is an automated practice draft. Please ignore it." Then ask for approval to click Send. This practice run stops at the approval step; nothing is sent.`,
    maxSteps: 25,
  },
  read_calendar: {
    label: (s) => `${s.name}: read today's events`,
    mode: 'read_only',
    instructions: (s) => `${signIn(s)} Report the title and time of the next three events on the calendar. ${READ_ONLY}`,
    maxSteps: 18,
  },
  read_channels: {
    label: (s) => `${s.name}: read recent conversations`,
    mode: 'read_only',
    instructions: (s) => `${signIn(s)} Report the names of the three most recently active channels or chats. ${READ_ONLY} Do not post or react.`,
    maxSteps: 20,
  },
  read_meetings: {
    label: (s) => `${s.name}: read upcoming meetings`,
    mode: 'read_only',
    instructions: (s) => `${signIn(s)} Open the meetings list and report the topic and time of the next upcoming meeting, or say there are none. ${READ_ONLY}`,
    maxSteps: 18,
  },
  crm_status: {
    label: (s) => `${s.name}: read a job status`,
    mode: 'read_only',
    instructions: (s) => `${signIn(s)} Open the jobs (or projects) list and report the name and status of the most recently updated one. ${READ_ONLY}`,
    maxSteps: 22,
  },
  supplier_search: {
    label: (s) => `${s.name}: search and read prices`,
    mode: 'read_only',
    params: { query: 'safety glasses' },
    instructions: (s) => `${signIn(s)} Search for "safety glasses" with the search box and its Search button (not Enter). Report the name and price of the first three results. ${READ_ONLY} Do not add anything to the cart.`,
    maxSteps: 22,
  },
  measurement_orders: {
    label: (s) => `${s.name}: read recent reports`,
    mode: 'read_only',
    instructions: (s) => `${signIn(s)} Report the address and status of the most recent measurement report or order, or say there are none. ${READ_ONLY} Do not order anything.`,
    maxSteps: 20,
  },
  permit_search: {
    label: (s) => `${s.name}: open the public permit search`,
    mode: 'read_only',
    instructions: () =>
      `On this permit portal, open the public search for building permits or records (no sign-in needed) and report the names of the search options shown. ${READ_ONLY} Do not apply for anything.`,
    maxSteps: 16,
    // Accela runs one portal per agency; the City of Atlanta's public portal is the practice stand-in.
    startUrl: 'https://aca-prod.accela.com/ATLANTA_GA/Default.aspx',
  },
  work_orders_open: {
    label: (s) => `${s.name}: read open work orders`,
    mode: 'read_only',
    instructions: (s) => `${signIn(s)} Report how many work orders are open and the property, status and due date of the three newest, or say there are none. ${READ_ONLY} Do not accept, schedule, check in, complete or invoice anything.`,
    maxSteps: 22,
  },
  claim_assignments: {
    label: (s) => `${s.name}: read new assignments`,
    mode: 'read_only',
    instructions: (s) => `${signIn(s)} Report how many claims or assignments are open and the claim number and status of the three newest, or say there are none. ${READ_ONLY} Do not accept or decline an assignment, upload anything or submit an estimate.`,
    maxSteps: 22,
  },
  restoration_jobs: {
    label: (s) => `${s.name}: read active jobs`,
    mode: 'read_only',
    instructions: (s) => `${signIn(s)} Report how many jobs are active and the job name and status of the three most recently updated, or say there are none. ${READ_ONLY} Do not change a status, upload anything or send a report.`,
    maxSteps: 22,
  },
  financing_status: {
    label: (s) => `${s.name}: read application status`,
    mode: 'read_only',
    instructions: (s) => `${signIn(s)} Report the status of the most recent financing application, or say there are none. ${READ_ONLY} Do not start or submit an application.`,
    maxSteps: 20,
  },
  accounting_recent: {
    label: (s) => `${s.name}: read recent invoices or payments`,
    mode: 'read_only',
    instructions: (s) => `${signIn(s)} Report the date, customer and amount of the three most recent invoices or payments. ${READ_ONLY} Do not send, record or refund anything.`,
    maxSteps: 22,
  },
  payroll_next: {
    label: (s) => `${s.name}: read the next payroll date`,
    mode: 'read_only',
    instructions: (s) => `${signIn(s)} Report the next payroll date and anything the dashboard says is due. ${READ_ONLY} Do not run payroll.`,
    maxSteps: 18,
  },
  recent_files: {
    label: (s) => `${s.name}: list recent files`,
    mode: 'read_only',
    instructions: (s) => `${signIn(s)} Report the names of the three most recently modified files. ${READ_ONLY} Do not share, move or delete anything.`,
    maxSteps: 18,
  },
  recent_envelopes: {
    label: (s) => `${s.name}: read envelope status`,
    mode: 'read_only',
    instructions: (s) => `${signIn(s)} Report the subject and status of the three most recent envelopes. ${READ_ONLY} Do not send, sign or void anything.`,
    maxSteps: 20,
  },
  sign_in_check: {
    label: (s) => `${s.name}: sign in with the saved Login`,
    mode: 'read_only',
    instructions: (s) =>
      s.publicTestSite
        ? `Sign in to this test site with the saved Login, then report the message shown after signing in. ${READ_ONLY}`
        : `${signIn(s)} Report the page title you land on after signing in. ${READ_ONLY}`,
    success: undefined,
    maxSteps: 12,
  },
  fill_form: {
    label: () => 'General web: fill a form, stop before Submit',
    mode: 'stop_before_submit',
    params: { text: 'Atmosphere practice', notes: 'Automated practice entry.' },
    instructions: () =>
      'On this public test form, type "Atmosphere practice" in the Text input and "Automated practice entry." in the Textarea, choose "Two" in the dropdown, then ask for approval to click Submit. This practice run stops at the approval step; nothing is submitted. Leave the password field empty.',
    maxSteps: 16,
  },
  upload_file: {
    label: () => 'General web: attach a file, stop before Upload',
    mode: 'stop_before_submit',
    startUrl: 'https://www.selenium.dev/selenium/web/upload.html',
    instructions: () =>
      'On this public test page, upload the file from <task_files> with the file field. Ask for approval for the file field first. This practice run stops at the approval step; nothing is uploaded.',
    maxSteps: 12,
  },
  download_file: {
    label: () => 'General web: download a file',
    mode: 'read_only',
    startUrl: 'https://the-internet.herokuapp.com/download',
    instructions: () =>
      'On this public test page, click the first file link in the list to download it, then call check_downloads and report the downloaded file name. Do not click anything else.',
    success: { downloaded: true },
    maxSteps: 12,
  },
};

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};
const siteOfHost = (h: string) => h.split('.').slice(-2).join('.');

/** Practice tasks for one catalog entry (the templates listed on it). */
export function practiceTasksFor(s: CatalogSite): PracticeTask[] {
  return s.practice.map((tpl) => {
    const spec = TEMPLATES[tpl];
    const startUrl = spec.startUrl ?? s.signInUrl;
    const needsLogin = !(s.publicTestSite && tpl !== 'sign_in_check') && tpl !== 'permit_search';
    return {
      key: `${s.id}.${tpl}`,
      site: siteOfHost(hostOf(startUrl)),
      catalogId: s.id,
      loginHost: needsLogin ? s.hosts[0] : null,
      label: spec.label(s),
      taskType: tpl,
      mode: spec.mode,
      startUrl,
      instructions: spec.instructions(s),
      ...(spec.params ? { params: spec.params } : {}),
      ...(spec.success ? { success: spec.success } : {}),
      maxSteps: spec.maxSteps,
    };
  });
}

export const PRACTICE_TASKS: PracticeTask[] = SITE_CATALOG.flatMap(practiceTasksFor);

export function practiceTask(key: string): PracticeTask | null {
  return PRACTICE_TASKS.find((t) => t.key === key) ?? null;
}
