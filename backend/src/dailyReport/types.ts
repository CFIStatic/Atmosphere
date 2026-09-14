export type DailyReportChannel = 'email' | 'sms' | 'email_and_sms';

export type DailyReportStatus = 'pending' | 'sent' | 'skipped' | 'failed';

export type OrgDailyReportSettings = {
  orgId: string;
  enabled: boolean;
  timezone: string;
  channel: DailyReportChannel;
  sendHour: number;
  extraEmails: string[];
};

export type GlanceClipSummary = {
  proofId: string;
  clipId: string | null;
  workDate: string;
  phase: string | null;
  title: string | null;
  receivedAt: string | null;
  headline: string | null;
  points: string[];
  people: string[];
  privacyProtected: boolean;
};

export type DailyJobGlanceReport = {
  orgId: string;
  jobId: string;
  jobTitle: string | null;
  orgName: string | null;
  localDay: string;
  timezone: string;
  clips: GlanceClipSummary[];
  overview: string;
};

export type DailyReportRecipients = {
  emails: string[];
  phones: string[];
};
