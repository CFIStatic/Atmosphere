/**
 * Pure geo helpers for storm ↔ contact matching.
 *
 * Distances are great-circle (haversine) in miles. Polygon containment uses a
 * ray-cast on GeoJSON rings. Both stay free of I/O so they are trivial to test.
 */

import type { GeoPolygon, LatLng, StormFootprint } from './types.js';

const EARTH_RADIUS_MILES = 3958.7613;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in miles between two WGS84 points. */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Ray-casting point-in-ring. Ring is GeoJSON [lng, lat] pairs. */
function pointInRing(point: LatLng, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;

    const intersects =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi + Number.EPSILON) + xi;

    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygonCoords(point: LatLng, rings: number[][][]): boolean {
  if (rings.length === 0) return false;
  // First ring is the exterior; subsequent rings are holes.
  if (!pointInRing(point, rings[0]!)) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(point, rings[i]!)) return false;
  }
  return true;
}

export function pointInGeometry(point: LatLng, geometry: GeoPolygon): boolean {
  if (geometry.type === 'Polygon') {
    return pointInPolygonCoords(point, geometry.coordinates as number[][][]);
  }
  for (const polygon of geometry.coordinates as number[][][][]) {
    if (pointInPolygonCoords(point, polygon)) return true;
  }
  return false;
}

/**
 * True when the point sits inside the storm footprint.
 *
 * Prefer the polygon when the weather feed supplied one; otherwise fall back
 * to the center + radius circle. Distance is always returned so the UI can
 * sort "closest first".
 */
export function matchPointToStorm(
  point: LatLng,
  storm: StormFootprint,
): { matched: boolean; distanceMiles: number } {
  const distanceMiles = haversineMiles(point, storm.center);

  if (storm.geometry) {
    return {
      matched: pointInGeometry(point, storm.geometry),
      distanceMiles: Math.round(distanceMiles * 100) / 100,
    };
  }

  return {
    matched: distanceMiles <= storm.radiusMiles,
    distanceMiles: Math.round(distanceMiles * 100) / 100,
  };
}

/** Bounding-box centroid of a GeoJSON polygon / multipolygon. */
export function geometryCentroid(geometry: GeoPolygon): LatLng {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  const visit = (lng: number, lat: number) => {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  };

  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates as number[][][]) {
      for (const [lng, lat] of ring) visit(lng!, lat!);
    }
  } else {
    for (const polygon of geometry.coordinates as number[][][][]) {
      for (const ring of polygon) {
        for (const [lng, lat] of ring) visit(lng!, lat!);
      }
    }
  }

  return {
    lat: (minLat + maxLat) / 2,
    lng: (minLng + maxLng) / 2,
  };
}

/**
 * Approximate radius covering the bounding box diagonal of a polygon.
 * Used when NWS gives geometry but the UI still wants a circle overlay.
 */
export function geometryApproxRadiusMiles(geometry: GeoPolygon): number {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  const visit = (lng: number, lat: number) => {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  };

  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates as number[][][]) {
      for (const [lng, lat] of ring) visit(lng!, lat!);
    }
  } else {
    for (const polygon of geometry.coordinates as number[][][][]) {
      for (const ring of polygon) {
        for (const [lng, lat] of ring) visit(lng!, lat!);
      }
    }
  }

  const corner: LatLng = { lat: maxLat, lng: maxLng };
  const center: LatLng = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
  const radius = haversineMiles(center, corner);
  return Math.max(5, Math.min(2000, Math.round(radius * 10) / 10));
}
