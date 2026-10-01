/**
 * Floor-plan rooms read off a document.
 *
 * This is the hook for per-room segmentation. Rows land in job_document_rooms
 * when a floor plan is attached. A later room model can read them. This module
 * does not write any other room table, so it does not depend on that work.
 */
import type { RoomFact } from './types.js';

export type DocumentRoomRow = {
  orgId: string;
  jobId: string;
  documentId: string;
  name: string;
  dimensions: string | null;
  notes: string | null;
  sourceLocation: string;
};

export function documentRoomRows(input: {
  orgId: string;
  jobId: string | null;
  documentId: string;
  rooms: RoomFact[];
}): DocumentRoomRow[] {
  if (!input.jobId || !input.rooms.length) return [];
  return input.rooms.slice(0, 40).map((room) => ({
    orgId: input.orgId,
    jobId: input.jobId!,
    documentId: input.documentId,
    name: room.name.slice(0, 80),
    dimensions: room.dimensions,
    notes: room.notes,
    sourceLocation: room.sourceLocation.slice(0, 80),
  }));
}

type RoomWriter = {
  from: (table: string) => {
    insert: (rows: unknown[]) => PromiseLike<{ error: { message: string } | null }>;
  };
};

/** Persist the hook rows. Missing table is ignored so Ask still works mid-migration. */
export async function persistDocumentRooms(db: RoomWriter, rows: DocumentRoomRow[]): Promise<void> {
  if (!rows.length) return;
  const payload = rows.map((row) => ({
    org_id: row.orgId,
    job_id: row.jobId,
    document_id: row.documentId,
    name: row.name,
    dimensions: row.dimensions,
    notes: row.notes,
    source_location: row.sourceLocation,
  }));
  const { error } = await db.from('job_document_rooms').insert(payload);
  if (error && !/job_document_rooms/i.test(error.message)) {
    throw new Error(error.message);
  }
}
