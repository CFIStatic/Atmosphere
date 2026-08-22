/**
 * User-action monitor.
 *
 * Recording must never break the work it records. A failed insert here is a
 * gap in the trail; a thrown error would hide that gap behind an outage.
 */
import type { Request } from 'express';
import { createActivityEvent, listActivityFromMemory, loadActivity, persistActivity } from './store.js';
import type { RecordActivityInput, UserActivityEvent } from './types.js';

export async function recordUserAction(input: RecordActivityInput): Promise<UserActivityEvent | null> {
  try {
    const event = createActivityEvent(input);
    await persistActivity(event);
    return event;
  } catch (err) {
    console.warn('[legal] activity record failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function listUserActivity(filter: {
  actorUserId?: string;
  orgId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  q?: string;
  limit?: number;
}): Promise<UserActivityEvent[]> {
  const rows = await loadActivity();
  const needle = filter.q?.trim().toLowerCase();
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000);
  return rows
    .filter((row) => {
      if (filter.actorUserId && row.actorUserId !== filter.actorUserId) return false;
      if (filter.orgId && row.orgId !== filter.orgId) return false;
      if (filter.action && row.action !== filter.action) return false;
      if (filter.resourceType && row.resourceType !== filter.resourceType) return false;
      if (filter.resourceId && row.resourceId !== filter.resourceId) return false;
      if (needle) {
        const hay = [
          row.actorEmail,
          row.actorLabel,
          row.action,
          row.path,
          row.resourceType,
          row.resourceId,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    })
    .slice(0, limit);
}

export function activityForSubjects(
  events: UserActivityEvent[],
  subjects: Array<{ subjectType: string; subjectId: string }>,
): UserActivityEvent[] {
  return events.filter((event) =>
    subjects.some((subject) => {
      if (subject.subjectType === 'org') return event.orgId === subject.subjectId;
      if (subject.subjectType === 'user') return event.actorUserId === subject.subjectId;
      if (subject.subjectType === 'job') {
        return (
          event.resourceType === 'job' && event.resourceId === subject.subjectId
        ) || event.path?.includes(subject.subjectId);
      }
      if (subject.subjectType === 'proof' || subject.subjectType === 'media') {
        return event.resourceId === subject.subjectId;
      }
      return false;
    }),
  );
}

export function actorFromRequest(req: Request): {
  actorUserId: string | null;
  actorEmail: string | null;
  actorLabel: string | null;
} {
  const user = req.user;
  if (!user) {
    return { actorUserId: null, actorEmail: null, actorLabel: null };
  }
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const name = typeof meta?.full_name === 'string' ? meta.full_name : null;
  return {
    actorUserId: user.id,
    actorEmail: user.email ?? null,
    actorLabel: name || user.email || user.id,
  };
}

export function listActivityMemory(): UserActivityEvent[] {
  return listActivityFromMemory();
}
