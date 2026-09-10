/**
 * Supabase was the primary store for property_twins / geometry_capture_sessions.
 * Those tables are dropped (non-sold-path). Stubs keep imports compiling.
 */
import type { GeometryCaptureSession, PropertyDigitalTwin } from './types.js';

export async function persistTwin(_twin: PropertyDigitalTwin): Promise<void> {
  return;
}

export async function fetchTwin(_id: string): Promise<PropertyDigitalTwin | null> {
  return null;
}

export async function fetchTwinsForOrg(_orgId: string): Promise<PropertyDigitalTwin[]> {
  return [];
}

export async function persistGeometrySession(_session: GeometryCaptureSession): Promise<void> {
  return;
}

export async function fetchGeometrySession(
  _id: string,
): Promise<GeometryCaptureSession | null> {
  return null;
}
