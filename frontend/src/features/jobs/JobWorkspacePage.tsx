import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Bot,
  FileText,
  Mail,
  MapPin,
  MessageSquare,
  Paperclip,
  Phone,
} from 'lucide-react';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Skeleton,
  TabPanel,
  Tabs,
  cn,
} from '../../design';
import { PageBody, PageHeader } from '../../patterns';
import {
  jobHealthLabel,
  jobHealthTone,
  phaseLabel,
  taskStatusLabel,
  taskStatusTone,
} from '../../patterns/tone';
import {
  useJob,
  useJobCommunications,
  useJobDocuments,
  useJobTasks,
  useJobTimeline,
} from '../../data/hooks';
import { formatDate, formatDateTime, money, relativeTime } from '../../domain/format';
import { useAssistant } from '../../assistant/AssistantContext';
import type { TimelineKind } from '../../domain/types';

/**
 * The job workspace — everything about one loss in one place.
 *
 * Tabs cover timeline, tasks, documents, communications, and financials. AI
 * context is deliberately *not* a tab: it lives in the persistent assistant
 * panel so it stays on screen while the user moves between the money and the
 * moisture readings, which is exactly when they want to ask something.
 */
export function JobWorkspacePage() {
  const { jobId = '' } = useParams();
  const [tab, setTab] = useState('timeline');
  const { setContextLabel } = useAssistant();

  const { data: job, isLoading } = useJob(jobId);
  const { data: timeline = [] } = useJobTimeline(jobId);
  const { data: tasks = [] } = useJobTasks(jobId);
  const { data: documents = [] } = useJobDocuments(jobId);
  const { data: communications = [] } = useJobCommunications(jobId);

  useEffect(() => {
    if (job) setContextLabel(`Context: ${job.number} · ${job.customerName}`);
  }, [job, setContextLabel]);

  if (isLoading) {
    return (
      <PageBody className="space-y-4">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </PageBody>
    );
  }

  if (!job) {
    return (
      <PageBody>
        <EmptyState
          title="Job not found"
          description="It may have been closed or you may not have access."
          action={
            <Link to="/jobs" className="text-sm font-medium text-brand-400 hover:text-brand-300">
              Back to jobs
            </Link>
          }
        />
      </PageBody>
    );
  }

  const outstanding = job.invoicedTotal - job.paidTotal;
  const openTasks = tasks.filter((t) => t.status !== 'done').length;
  const needsReply = communications.filter((c) => c.needsReply).length;

  return (
    <>
      <PageHeader
        title={`${job.number} · ${job.customerName}`}
        description={job.address}
        actions={
          <Link
            to="/jobs"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs font-medium text-gray-300 transition hover:bg-white/5"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Jobs
          </Link>
        }
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={jobHealthTone[job.health]}>{jobHealthLabel[job.health]}</Badge>
          <Badge tone="idle">{phaseLabel[job.phase]}</Badge>
          <Badge tone="idle">Day {job.ageDays}</Badge>
          {job.carrier && <Badge tone="info">{job.carrier}</Badge>}
          {job.claimNumber && (
            <span className="font-mono text-2xs text-gray-600">{job.claimNumber}</span>
          )}
        </div>
        {job.flags.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {job.flags.map((flag) => (
              <li key={flag} className="text-xs text-state-warn">
                • {flag}
              </li>
            ))}
          </ul>
        )}
      </PageHeader>

      <PageBody className="space-y-4">
        {/* ── Money summary ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Estimate" value={money(job.estimateTotal)} />
          <Stat
            label="Carrier approved"
            value={money(job.approvedTotal)}
            tone={
              job.approvedTotal > 0 && job.approvedTotal < job.estimateTotal ? 'warn' : undefined
            }
            hint={
              job.approvedTotal > 0 && job.approvedTotal < job.estimateTotal
                ? `${money(job.estimateTotal - job.approvedTotal)} under scope`
                : undefined
            }
          />
          <Stat label="Invoiced" value={money(job.invoicedTotal)} />
          <Stat
            label="Outstanding"
            value={money(outstanding)}
            tone={outstanding > 0 ? 'warn' : undefined}
          />
        </div>

        <Tabs
          value={tab}
          onValueChange={setTab}
          items={[
            { value: 'timeline', label: 'Timeline' },
            { value: 'tasks', label: 'Tasks', count: openTasks },
            { value: 'documents', label: 'Documents', count: documents.length },
            { value: 'communications', label: 'Communications', count: needsReply || undefined },
            { value: 'financials', label: 'Financials' },
          ]}
        >
          {/* ── Timeline ───────────────────────────────────────────────────── */}
          <TabPanel value="timeline" className="pt-4">
            <Card>
              <CardBody className="p-0">
                {timeline.length === 0 ? (
                  <EmptyState title="No activity yet" />
                ) : (
                  <ol className="relative px-4 py-3">
                    {timeline.map((event, i) => (
                      <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                        {i < timeline.length - 1 && (
                          <span className="absolute left-[7px] top-5 h-full w-px bg-white/10" />
                        )}
                        <span
                          className={cn(
                            'relative mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-ink-800',
                            TIMELINE_DOT[event.kind],
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-200">{event.title}</p>
                          {event.detail && (
                            <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
                              {event.detail}
                            </p>
                          )}
                          <p className="mt-1 flex items-center gap-1.5 text-2xs text-gray-600">
                            {event.agentId && <Bot className="h-3 w-3 text-brand-400/70" />}
                            {event.actorName} · {relativeTime(event.at)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardBody>
            </Card>
          </TabPanel>

          {/* ── Tasks ──────────────────────────────────────────────────────── */}
          <TabPanel value="tasks" className="pt-4">
            <Card>
              <CardBody className="p-0">
                {tasks.length === 0 ? (
                  <EmptyState title="No tasks on this job" />
                ) : (
                  <ul className="divide-y divide-white/5">
                    {tasks.map((task) => (
                      <li
                        key={task.id}
                        className="flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm text-gray-200">{task.title}</p>
                          <p className="mt-0.5 text-2xs text-gray-600">
                            {task.dueDate ? `Due ${formatDateTime(task.dueDate)}` : 'No due date'}
                            {task.createdByAgentId && ' · created by Atmosphere'}
                          </p>
                        </div>
                        <Badge tone={taskStatusTone[task.status]}>
                          {taskStatusLabel[task.status]}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </TabPanel>

          {/* ── Documents ──────────────────────────────────────────────────── */}
          <TabPanel value="documents" className="pt-4">
            <Card>
              <CardBody className="p-0">
                {documents.length === 0 ? (
                  <EmptyState icon={<Paperclip className="h-7 w-7" />} title="No documents yet" />
                ) : (
                  <ul className="divide-y divide-white/5">
                    {documents.map((doc) => (
                      <li key={doc.id} className="flex items-center gap-3 px-4 py-3">
                        <FileText className="h-4 w-4 shrink-0 text-gray-600" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-gray-200">{doc.name}</p>
                          <p className="text-2xs text-gray-600">
                            {doc.uploadedBy} · {formatDate(doc.uploadedAt)} ·{' '}
                            {doc.sizeKb > 1024
                              ? `${(doc.sizeKb / 1024).toFixed(1)} MB`
                              : `${doc.sizeKb} KB`}
                          </p>
                        </div>
                        <Badge tone="idle">{doc.source}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </TabPanel>

          {/* ── Communications ─────────────────────────────────────────────── */}
          <TabPanel value="communications" className="pt-4">
            <Card>
              <CardBody className="p-0">
                {communications.length === 0 ? (
                  <EmptyState
                    icon={<MessageSquare className="h-7 w-7" />}
                    title="No messages yet"
                  />
                ) : (
                  <ul className="divide-y divide-white/5">
                    {communications.map((comm) => {
                      const Icon = comm.channel === 'call' ? Phone : Mail;
                      return (
                        <li key={comm.id} className="flex gap-3 px-4 py-3">
                          <Icon
                            className={cn(
                              'mt-0.5 h-4 w-4 shrink-0',
                              comm.direction === 'inbound' ? 'text-state-info' : 'text-gray-600',
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="truncate text-sm font-medium text-gray-200">
                                {comm.subject}
                              </p>
                              {comm.needsReply && <Badge tone="warn">Needs reply</Badge>}
                              {comm.byAgent && <Badge tone="brand">Sent by Atmosphere</Badge>}
                            </div>
                            <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">
                              {comm.preview}
                            </p>
                            <p className="mt-1 text-2xs text-gray-600">
                              {comm.participant} · {relativeTime(comm.at)}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardBody>
            </Card>
          </TabPanel>

          {/* ── Financials ─────────────────────────────────────────────────── */}
          <TabPanel value="financials" className="pt-4">
            <Card>
              <CardHeader title="Job financials" description="Scope, approval, and collection" />
              <CardBody className="space-y-3">
                <Row label="Estimate submitted" value={money(job.estimateTotal)} />
                <Row label="Carrier approved" value={money(job.approvedTotal)} />
                <Row
                  label="Variance"
                  value={money(job.approvedTotal - job.estimateTotal)}
                  tone={job.approvedTotal < job.estimateTotal ? 'danger' : undefined}
                />
                <Row label="Deductible" value={money(job.deductible)} />
                <div className="my-2 border-t border-white/10" />
                <Row label="Invoiced to date" value={money(job.invoicedTotal)} />
                <Row label="Collected" value={money(job.paidTotal)} />
                <Row
                  label="Outstanding"
                  value={money(outstanding)}
                  tone={outstanding > 0 ? 'warn' : undefined}
                />
                <div className="my-2 border-t border-white/10" />
                <Row label="Loss date" value={formatDate(job.lossDate)} />
                <Row label="Target completion" value={formatDate(job.targetCompletion)} />
              </CardBody>
            </Card>
          </TabPanel>
        </Tabs>

        <p className="flex items-center gap-1.5 text-2xs text-gray-600">
          <MapPin className="h-3 w-3" />
          {job.address}
        </p>
      </PageBody>
    </>
  );
}

const TIMELINE_DOT: Record<TimelineKind, string> = {
  status_change: 'bg-state-info',
  note: 'bg-gray-600',
  document: 'bg-gray-500',
  communication: 'bg-state-info',
  agent_action: 'bg-brand-400',
  financial: 'bg-state-ok',
  field_update: 'bg-state-warn',
};

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'warn' | 'danger';
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-ink-800/60 p-3">
      <p className="text-2xs uppercase tracking-wide text-gray-600">{label}</p>
      <p
        className={cn(
          'mt-1 text-lg font-semibold',
          tone === 'warn' && 'text-state-warn',
          tone === 'danger' && 'text-state-danger',
          !tone && 'text-white',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-2xs text-gray-600">{hint}</p>}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'danger' }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-gray-500">{label}</span>
      <span
        className={cn(
          'font-medium',
          tone === 'warn' && 'text-state-warn',
          tone === 'danger' && 'text-state-danger',
          !tone && 'text-gray-200',
        )}
      >
        {value}
      </span>
    </div>
  );
}
