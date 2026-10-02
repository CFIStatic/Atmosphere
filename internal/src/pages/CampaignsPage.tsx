import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { count, shortDate } from '../lib/format';
import { audienceSummary } from '../lib/contacts';
import { ErrorLine, Footnotes, Loading, PageHeader, Section, Tag } from '../components/report';

export function CampaignsPage() {
  const { data, error, loading, reload } = useApi(() => api.campaigns(), []);
  if (loading && !data) return <Loading label="Loading campaigns" />;

  return (
    <div>
      <PageHeader
        eyebrow="Contacts & campaigns"
        title="Campaigns"
        subtitle="Email campaigns to customer contacts. Drafts are saved here; every email carries an unsubscribe link and unsubscribed addresses are always skipped."
        actions={
          <Link to="/campaigns/new" className="btn-primary">
            New campaign
          </Link>
        }
      />
      {error && <ErrorLine message={error} onRetry={() => void reload()} />}

      {data && (
        <>
          <p
            className={`mt-4 border-l-2 pl-3 text-[13px] ${data.sending.enabled ? 'border-success-600 text-ink-700' : 'border-caution-600 text-ink-700'}`}
            data-testid="sending-state"
          >
            {data.sending.enabled ? (
              'Sending is enabled on this server. Every send still requires confirming the recipient count.'
            ) : (
              <>
                <span className="font-semibold text-ink-900">Sending is off.</span> {data.sending.reason} Drafts can be
                written and previewed; nothing can be emailed until an administrator turns sending on.
              </>
            )}
          </p>

          <Section title="All campaigns" note={`${count(data.campaigns.length)} campaigns · ${count(data.suppressed)} addresses unsubscribed`}>
            <div className="overflow-x-auto">
              <table className="report-table min-w-[760px]">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Subject</th>
                    <th>Audience</th>
                    <th>Status</th>
                    <th className="num">Recipients</th>
                    <th className="num">Sent</th>
                    <th className="num">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {data.campaigns.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-ink-500">
                        No campaigns yet. <Link to="/campaigns/new" className="text-brand-600 underline">Write the first draft</Link>.
                      </td>
                    </tr>
                  ) : (
                    data.campaigns.map((c) => (
                      <tr key={c.id}>
                        <td className="font-medium text-ink-900">
                          <Link to={`/campaigns/${c.id}`} className="hover:text-brand-600 hover:underline">
                            {c.name}
                          </Link>
                        </td>
                        <td className="max-w-[18rem] truncate">{c.subject || <span className="text-ink-400">No subject</span>}</td>
                        <td className="text-ink-600">{audienceSummary(c.audience)}</td>
                        <td>
                          <Tag tone={c.status === 'sent' ? 'good' : c.status === 'failed' ? 'bad' : c.status === 'sending' ? 'accent' : 'neutral'}>
                            {c.status}
                          </Tag>
                        </td>
                        <td className="num">{count(c.recipientCount)}</td>
                        <td className="num">{count(c.sentCount)}</td>
                        <td className="num whitespace-nowrap">{shortDate(c.updatedAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}

      <Footnotes
        notes={[
          'Campaigns are stored in analytics_campaigns; each address actually emailed is recorded once in analytics_campaign_sends with its own unsubscribe token.',
          'Sending goes through the platform mail service (Resend) and is off unless CAMPAIGN_SENDING_ENABLED is true on the API server.',
        ]}
      />
    </div>
  );
}
