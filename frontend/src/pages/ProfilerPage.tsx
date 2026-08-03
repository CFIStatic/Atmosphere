import { useState, type FormEvent } from 'react';
import { AppShell, EmptyState, PageHeader } from '../components/AppShell';
import { api, type ProspectProfile } from '../lib/api';
import { SpinnerIcon } from '../components/icons';

/**
 * Profiler — what to know before you pick up the phone.
 *
 * A salesperson who knows the company opened a third clinic in March, and that
 * the person they are calling has run facilities there since 2021, has a
 * conversation. One who knows a name and a number has a cold call.
 *
 * Two things about how this page presents what it finds, both deliberate:
 *
 *   Every fact links to the page it came from. An uncited claim on a profile
 *   is a rumour with good typography, and the salesperson who repeats it to a
 *   prospect is the one who finds out. If we cannot say where it came from, it
 *   does not appear.
 *
 *   Talking points sit under their own heading, visibly separated from the
 *   cited facts, because they are inferred rather than found. Blending a guess
 *   into a list of sourced facts is how somebody ends up confidently telling a
 *   prospect something nobody ever said.
 *
 * The footer states what this never looks for. That boundary is the feature —
 * professional context is sales intelligence, and a picture of somebody's
 * private life is a dossier — so it belongs on the screen, not just in a
 * comment nobody reads.
 */
export function ProfilerPage() {
  const [fullName, setFullName] = useState('');
  const [domain, setDomain] = useState('');
  const [profile, setProfile] = useState<ProspectProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setProfile(null);
    try {
      setProfile(await api.buildProfile(fullName, domain));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build that profile.');
    } finally {
      setBusy(false);
    }
  }

  const pagesRead = profile?.sourcesChecked.filter((s) => s.ok).length ?? 0;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Sales Platform"
        title="Profiler"
        description="What a company publishes about someone, gathered before you call them — their role, how long they have been in it, and what the business has announced. Everything cites where it came from."
      />

      <form onSubmit={run} className="mt-2 rounded-xl glass-card p-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="block">
            <span className="text-sm font-medium text-ink-700">Who</span>
            <input
              className="mt-1 w-full rounded-lg glass-field px-3.5 py-2.5 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Tomas Bergeron"
              required
              minLength={2}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink-700">Company domain</span>
            <input
              className="mt-1 w-full rounded-lg glass-field px-3.5 py-2.5 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="northgatemed.com"
              required
              minLength={3}
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-ink-900 shadow-card transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy && <SpinnerIcon className="animate-spin" width={16} height={16} />}
            Build profile
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" className="mt-4 text-sm text-danger-600">
          {error}
        </p>
      )}

      {busy && (
        <p className="mt-6 text-sm text-ink-600">
          Reading their company's public pages…
        </p>
      )}

      {profile && !busy && (
        <div className="mt-6 space-y-5">
          <div className="rounded-xl glass-card p-5">
            <h2 className="text-lg font-semibold text-ink-900">{profile.fullName}</h2>
            <p className="mt-0.5 text-sm text-ink-600">{profile.companyDomain}</p>
            {profile.companySummary && (
              <p className="mt-3 text-sm leading-relaxed text-ink-700">
                {profile.companySummary}{' '}
                {profile.companySummarySource && (
                  <SourceLink url={profile.companySummarySource} />
                )}
              </p>
            )}
            <p className="mt-3 text-xs text-ink-500">
              {pagesRead === 0
                ? 'No pages could be read — the site may be down, or its robots.txt may ask us not to.'
                : `Read ${pagesRead} ${pagesRead === 1 ? 'page' : 'pages'} on their site.`}
            </p>
          </div>

          {profile.facts.length > 0 && (
            <section className="rounded-xl glass-card p-5">
              <h3 className="text-sm font-semibold text-ink-900">What they publish about them</h3>
              <ul className="mt-3 space-y-3">
                {profile.facts.map((fact, i) => (
                  <li key={`${fact.label}-${i}`}>
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                      {fact.label}
                    </p>
                    <p className="mt-0.5 text-sm leading-relaxed text-ink-800">
                      {fact.value}{' '}
                      {fact.sourceKind === 'crm' ? (
                        <span className="text-[11px] text-brand-600">your CRM</span>
                      ) : (
                        <SourceLink url={fact.sourceUrl} />
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {profile.signals.length > 0 && (
            <section className="rounded-xl glass-card p-5">
              <h3 className="text-sm font-semibold text-ink-900">Company news</h3>
              <p className="mt-0.5 text-xs text-ink-500">
                Openers that show you looked them up before calling.
              </p>
              <ul className="mt-3 space-y-2">
                {profile.signals.map((signal, i) => (
                  <li key={i} className="text-sm leading-relaxed text-ink-800">
                    {signal.headline} <SourceLink url={signal.sourceUrl} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {profile.talkingPoints.length > 0 && (
            <section className="rounded-xl border border-brand-200 bg-brand-50/40 p-5">
              <h3 className="text-sm font-semibold text-ink-900">Suggested approach</h3>
              <p className="mt-0.5 text-xs text-ink-500">
                Inferred from what was found above — not something anyone published. Judgement
                still yours.
              </p>
              <ul className="mt-3 space-y-2">
                {profile.talkingPoints.map((point, i) => (
                  <li key={i} className="text-sm leading-relaxed text-ink-800">
                    {point}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {profile.facts.length === 0 && profile.signals.length === 0 && (
            <EmptyState
              title="Nothing published about them was found"
              hint="Their company may not list staff, or the pages may be behind a login. Treat the call as genuinely cold — ask rather than assume."
            />
          )}

          <section className="rounded-xl border border-line p-5">
            <h3 className="text-sm font-semibold text-ink-900">What this does not look for</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-600">
              This reads a company's own business pages — material published so that people who
              want to do business with them can find it. It does not assemble a picture of
              anyone's private life, and it never searches for:
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {profile.excluded.map((category) => (
                <span
                  key={category}
                  className="rounded-full bg-paper-200/60 px-2 py-0.5 text-[11px] text-ink-600"
                >
                  {category}
                </span>
              ))}
            </div>
            {profile.withheld.length > 0 && (
              <p className="mt-3 text-xs text-caution-600">
                Some text on their site touched {profile.withheld.join(', ')} and was left out.
              </p>
            )}
          </section>
        </div>
      )}

      {!profile && !busy && !error && (
        <div className="mt-6">
          <EmptyState
            title="Look someone up before you call them"
            hint="Enter a name and their company's domain. You get their role, how long they have held it, what the company does, and what it has announced lately — each with a link to where it was published."
          />
        </div>
      )}
    </AppShell>
  );
}

/** Every claim is clickable back to its source, or it does not belong here. */
function SourceLink({ url }: { url: string }) {
  let label = url;
  try {
    const parsed = new URL(url);
    label = parsed.pathname === '/' ? parsed.hostname : parsed.pathname;
  } catch {
    /* a relative CRM link renders as-is */
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="text-[11px] text-brand-600 underline decoration-dotted underline-offset-2 hover:text-brand-700"
    >
      {label}
    </a>
  );
}
