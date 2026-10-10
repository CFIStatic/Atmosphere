import type { ProofJobRoom } from '../../lib/api';

/** "living_room" / "living room" → "Living Room". No underscores ever reach the screen. */
export function displayRoomName(name: string | null | undefined): string {
  return String(name ?? '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/** Rooms that only differ by spelling ("living_room" vs "living room") are one room. */
export function mergeRoomsByName(rooms: ProofJobRoom[]): ProofJobRoom[] {
  const byName = new Map<string, ProofJobRoom>();
  for (const room of rooms) {
    const key = displayRoomName(room.roomName).toLowerCase();
    const prior = byName.get(key);
    if (!prior) {
      byName.set(key, { ...room, roomName: displayRoomName(room.roomName) });
      continue;
    }
    const first = [prior.firstSeen, room.firstSeen].filter(Boolean).sort()[0] ?? null;
    const last = [prior.lastSeen, room.lastSeen].filter(Boolean).sort().pop() ?? null;
    byName.set(key, {
      ...prior,
      firstSeen: first,
      lastSeen: last,
      datesWorked: [...new Set([...(prior.datesWorked ?? []), ...(room.datesWorked ?? [])])].sort(),
      traits: [...new Set([...(prior.traits ?? []), ...(room.traits ?? [])])],
      sightings: [...prior.sightings, ...room.sightings],
    });
  }
  return [...byName.values()];
}

/**
 * Plain words for what needs a look. Never "failed": a mismatch is a question
 * for the contractor, not a verdict on the crew.
 */
export function integrityNotice(counts: { contradicted?: number; dateMismatches?: number }): string | null {
  const total = counts.contradicted ?? 0;
  if (total <= 0) return null;
  const dates = Math.min(counts.dateMismatches ?? 0, total);
  if (dates === total) return `${dates} clip${dates === 1 ? ' has a' : 's have a'} date mismatch`;
  return `${total} clip${total === 1 ? '' : 's'} need${total === 1 ? 's' : ''} a look`;
}
