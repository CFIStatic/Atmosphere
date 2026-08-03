import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarDays, MapPin } from 'lucide-react';
import { Badge, Card, CardBody, EmptyState, cn } from '../../design';
import { PageBody, PageHeader } from '../../patterns';
import { useSchedule } from '../../data/hooks';
import { formatTime, relativeTime } from '../../domain/format';
import { usePeople } from '../../data/hooks';
import type { ScheduleEvent } from '../../domain/types';

const KIND_TONE = {
  inspection: 'border-l-state-info',
  mitigation: 'border-l-state-warn',
  monitoring: 'border-l-brand-400',
  reconstruction: 'border-l-state-ok',
  meeting: 'border-l-fg-4',
} as const;

/**
 * The schedule, grouped by day.
 *
 * Conflicts are surfaced inline rather than in a separate warnings panel — a
 * double-booked technician is a property of that appointment, and splitting it
 * out is how conflicts get missed.
 */
export function SchedulePage() {
  const { data: events = [] } = useSchedule();
  const { data: people = [] } = usePeople();

  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? 'Unassigned';
  const conflicts = events.filter((e) => e.conflict).length;

  const byDay = events.reduce<Record<string, ScheduleEvent[]>>((acc, event) => {
    const key = new Date(event.start).toDateString();
    (acc[key] ??= []).push(event);
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Schedule"
        description={
          conflicts > 0
            ? `${events.length} scheduled · ${conflicts} conflict${conflicts === 1 ? '' : 's'} need resolving`
            : `${events.length} scheduled · no conflicts`
        }
      />

      <PageBody className="space-y-5">
        {Object.keys(byDay).length === 0 ? (
          <EmptyState icon={<CalendarDays className="h-7 w-7" />} title="Nothing scheduled" />
        ) : (
          Object.entries(byDay).map(([day, dayEvents]) => (
            <section key={day}>
              <h2 className="mb-2 flex items-baseline gap-2 text-xs font-semibold text-fg-2">
                {new Date(day).toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'short',
                  day: 'numeric',
                })}
                <span className="text-2xs font-normal text-fg-4">
                  {dayEvents.length} appointment{dayEvents.length === 1 ? '' : 's'}
                </span>
              </h2>

              <div className="space-y-2">
                {dayEvents.map((event) => (
                  <Card
                    key={event.id}
                    className={cn(
                      'border-l-2',
                      KIND_TONE[event.kind],
                      event.conflict && 'border-state-danger/40',
                    )}
                  >
                    <CardBody className="flex flex-wrap items-start justify-between gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-fg-3">
                            {formatTime(event.start)}–{formatTime(event.end)}
                          </span>
                          <span className="truncate text-sm font-medium text-fg">
                            {event.title}
                          </span>
                          <Badge tone="idle">{event.kind}</Badge>
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-fg-4">
                          {event.jobId && event.jobNumber && (
                            <Link
                              to={`/jobs/${event.jobId}`}
                              className="font-mono font-medium text-brand-400 hover:text-brand-300"
                            >
                              {event.jobNumber}
                            </Link>
                          )}
                          {event.address && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {event.address}
                            </span>
                          )}
                          <span>
                            {event.assigneeIds.length > 0
                              ? event.assigneeIds.map(nameOf).join(', ')
                              : 'Unassigned'}
                          </span>
                          <span>· {relativeTime(event.start)}</span>
                        </div>

                        {event.conflict && (
                          <p className="mt-1.5 flex items-center gap-1.5 text-2xs font-medium text-state-danger">
                            <AlertTriangle className="h-3 w-3" />
                            {event.conflict}
                          </p>
                        )}
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </section>
          ))
        )}
      </PageBody>
    </>
  );
}
