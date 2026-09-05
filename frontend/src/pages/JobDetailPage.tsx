import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api,
  ApiError,
  WORK_TYPE_LABELS,
  type Job,
  type JobParty,
  type ProofResponse,
  type SharedJobRecord,
} from '../lib/api';
import { PanelSpinner, ErrorNote } from '../components/AppShell';
import { JobFileAskChrome } from '../components/JobFileAskChrome';
import { ShareJobProgressPanel } from '../components/shared/ShareJobProgressPanel';
import { ShareIcon } from '../components/icons';
import { useFeatureTimer } from '../hooks/useFeatureTimer';
import {
  buildJobFileDossier,
  filePulse,
  filmedDateLabel,
  siteLine,
  type JobFileBeat,
} from '../lib/jobFileAsk';
import { touchJobFile } from '../lib/jobFileRecents';

/**
 * The job file.
 *
 * One page on desktop — film, do-not, who is behind, Ask pinned on the right.
 * On a phone (Field Capture or narrow viewport) File and Ask are tabs so chat
 * is first-class instead of buried under the dossier.
 */

export function JobDetailPage() {
  useFeatureTimer('job_detail');
  const { id = '' } = useParams();
  const [job, setJob] = useState<Job | null>(null);
  const [record, setRecord] = useState<SharedJobRecord | null>(null);
  const [proofs, setProofs] = useState<ProofResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [detail, nextRecord, nextProofs] = await Promise.all([
        api.getJob(id),
        api.sharedJob(id).catch(() => null),
        api.jobProofs(id).catch(() => null),
      ]);
      setJob(detail.job);
      setRecord(nextRecord);
      setProofs(nextProofs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load that job.');
    } finally {
      setLoaded(true);
    }
  }, [id]);

  useEffect(() => {
    setLoaded(false);
    void load();
  }, [load]);

  useEffect(() => {
    if (id) touchJobFile(id);
  }, [id]);

  const file = useMemo(() => ({ record, proofs }), [record, proofs]);
  const pulse = useMemo(() => filePulse(proofs), [proofs]);
  const beats = useMemo(
    () =>
      buildJobFileDossier({
        proofs,
        messages: record?.messages ?? [],
        facts: record?.brief?.facts ?? null,
      }),
    [proofs, record],
  );
  const exclusions = useMemo(
    () => (record?.scope ?? []).filter((item) => item.state === 'excluded'),
    [record],
  );
  const blockers = useMemo(
    () => (record?.risks ?? []).filter((risk) => risk.level === 'blocker').slice(0, 3),
    [record],
  );
  const address = siteLine(record);

  if (!loaded && !job) {
    return <PanelSpinner label="Loading job file" />;
  }

  if (error && !job) {
    return (
      <div className="mx-auto max-w-lg pt-10">
        <ErrorNote message={error} />
        <Link to="/jobs" className="mt-4 inline-block text-sm text-brand-600 hover:text-brand-700">
          ← Back to Job Files
        </Link>
      </div>
    );
  }

  if (!job) {
    return <PanelSpinner label="Loading job file" />;
  }

  const lastFilmed = filmedDateLabel(pulse.lastDate);

  const fileBody = (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-sm tracking-wider text-brand-600">Job #{job.jobNumber}</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">{job.title}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-600">
              {address && <span>{address}</span>}
              {address && <span aria-hidden="true">·</span>}
              <span>{WORK_TYPE_LABELS[job.workType]}</span>
              {job.claimNumber && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Claim {job.claimNumber}</span>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            aria-label="Share this job file"
            title="Share with a homeowner or anyone who needs this file"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line text-ink-700 transition hover:border-brand-400 hover:bg-paper-200 hover:text-brand-700"
          >
            <ShareIcon width={18} height={18} />
          </button>
        </header>

        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <PulseTile label="Clips on file" value={String(pulse.clips)} />
          <PulseTile label="Read" value={String(pulse.read)} />
          <PulseTile label="Heard on mic" value={String(pulse.heard)} />
          <PulseTile label="Last filmed" value={lastFilmed ?? '—'} />
        </dl>

        {error && (
          <div className="mt-4">
            <ErrorNote message={error} />
          </div>
        )}

        {blockers.length > 0 && (
          <section className="mt-5 rounded-xl border border-caution-200 bg-caution-50/50 px-5 py-4" aria-label="Needs a look">
            <h2 className="text-sm font-semibold text-ink-900">Needs a look</h2>
            <ul className="mt-2 space-y-2">
              {blockers.map((risk) => (
                <li key={risk.key}>
                  <p className="text-sm font-medium text-ink-800">{risk.title}</p>
                  <p className="mt-0.5 text-xs text-ink-600">{risk.action}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-6 rounded-xl glass-card p-5" data-testid="job-file-knows">
          <h2 className="text-base font-semibold text-ink-900">On this file</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            What the clips and the record already know — read this first, then ask.
          </p>

          {exclusions.length > 0 && (
            <div className="mt-4">
              <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-danger-600">
                Do not
              </h3>
              <ul className="mt-2 space-y-2">
                {exclusions.map((item) => (
                  <li key={item.id} className="rounded-lg border border-danger-200/70 bg-danger-50/40 px-3 py-2">
                    <p className="text-sm font-medium text-ink-900">{item.title}</p>
                    {item.reason && <p className="mt-0.5 text-xs text-ink-600">{item.reason}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {beats.length > 0 ? (
            <ol className="mt-4 space-y-3">
              {beats.map((beat) => (
                <BeatRow key={beat.id} beat={beat} />
              ))}
            </ol>
          ) : (
            <p className="mt-4 text-sm text-ink-600">
              Nothing filmed yet. The brief is still on this file — ask what you forgot, or wait
              for Field Capture.
            </p>
          )}
        </section>

        {(record?.parties.length ?? 0) > 0 && (
          <section className="mt-5 rounded-xl glass-card p-5" data-testid="job-file-people">
            <h2 className="text-base font-semibold text-ink-900">Invited</h2>
            <p className="mt-0.5 text-xs text-ink-500">
              Who has the job link, and whether they are on the current brief.
            </p>
            <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line">
              {record!.parties.map((party) => (
                <PartyRow key={party.id} party={party} />
              ))}
            </ul>
          </section>
        )}
    </>
  );

  return (
    <JobFileAskChrome
      jobId={job.id}
      file={file}
      extra={
        shareOpen ? (
          <ShareJobProgressPanel
            jobId={job.id}
            creating
            modal
            onClose={() => setShareOpen(false)}
            onCreatingChange={setShareOpen}
          />
        ) : null
      }
    >
      {fileBody}
    </JobFileAskChrome>
  );
}

function PulseTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl glass-card px-4 py-3">
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums text-ink-900">{value}</dd>
    </div>
  );
}

function BeatRow({ beat }: { beat: JobFileBeat }) {
  return (
    <li>
      <p className="text-[11px] font-medium text-ink-500">{beat.title}</p>
      <p className="mt-0.5 text-sm leading-relaxed text-ink-800">{beat.detail}</p>
    </li>
  );
}

function PartyRow({ party }: { party: JobParty }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink-900">{party.company}</p>
        <p className="mt-0.5 truncate text-xs text-ink-500">
          {[party.trade, party.contactName ?? party.contact_name].filter(Boolean).join(' · ')}
        </p>
      </div>
      <span className="shrink-0 text-xs font-medium text-ink-600">{partyLine(party)}</span>
    </li>
  );
}

function partyLine(party: JobParty): string {
  if (party.revoked_at) return 'Revoked';
  if (party.clear) return 'Accepted';
  if (party.acknowledgedRevision != null) return 'On an older brief';
  if (!party.last_seen_at) return 'Never opened';
  return 'Has not accepted';
}
