/**
 * SVG contact / storm map.
 *
 * Equirectangular projection over a continental-US viewport. No map tile
 * dependency — contacts are CRM pins, storms are radius circles. When the
 * book of business sits outside the default frame the view auto-fits.
 */

import { useMemo, useState } from 'react';
import type { EmMapContact, EmStorm, EmStormSeverity } from '../lib/api';

const WIDTH = 920;
const HEIGHT = 520;

/** Default continental US frame (lng west→east, lat south→north). */
const DEFAULT_BOUNDS = { west: -125, east: -66, south: 24, north: 50 };

const SEVERITY_STROKE: Record<EmStormSeverity, string> = {
  advisory: '#64748b',
  watch: '#d97706',
  warning: '#dc2626',
  emergency: '#7f1d1d',
};

function project(
  lat: number,
  lng: number,
  bounds: typeof DEFAULT_BOUNDS,
): { x: number; y: number } {
  const x = ((lng - bounds.west) / (bounds.east - bounds.west)) * WIDTH;
  const y = ((bounds.north - lat) / (bounds.north - bounds.south)) * HEIGHT;
  return { x, y };
}

/** Miles → SVG pixels at the given latitude (rough, good enough for overlay). */
function milesToPx(miles: number, lat: number, bounds: typeof DEFAULT_BOUNDS): number {
  const milesPerDegreeLat = 69.0;
  const degrees = miles / milesPerDegreeLat;
  const pxPerDegree = HEIGHT / (bounds.north - bounds.south);
  // Stretch longitude a bit at higher latitudes so circles look rounder.
  const lonStretch = Math.cos((lat * Math.PI) / 180);
  return degrees * pxPerDegree * (0.65 + 0.35 * lonStretch);
}

function fitBounds(contacts: EmMapContact[], storms: EmStorm[]) {
  const points = [
    ...contacts.map((c) => ({ lat: c.lat, lng: c.lng })),
    ...storms.map((s) => ({ lat: Number(s.centerLat), lng: Number(s.centerLng) })),
  ].filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  if (points.length === 0) return DEFAULT_BOUNDS;

  let west = Math.min(...points.map((p) => p.lng));
  let east = Math.max(...points.map((p) => p.lng));
  let south = Math.min(...points.map((p) => p.lat));
  let north = Math.max(...points.map((p) => p.lat));

  // Pad so pins are not glued to the edge; keep a sensible minimum span.
  const padLng = Math.max(2, (east - west) * 0.25);
  const padLat = Math.max(1.5, (north - south) * 0.25);
  west -= padLng;
  east += padLng;
  south -= padLat;
  north += padLat;

  // Never zoom in tighter than a metro area — the map should still read as a map.
  if (east - west < 6) {
    const mid = (east + west) / 2;
    west = mid - 3;
    east = mid + 3;
  }
  if (north - south < 4) {
    const mid = (north + south) / 2;
    south = mid - 2;
    north = mid + 2;
  }

  return { west, east, south, north };
}

export function ContactStormMap({
  contacts,
  storms,
  highlightedContactIds,
  onSelectContact,
  onSelectStorm,
  selectedStormId,
}: {
  contacts: EmMapContact[];
  storms: EmStorm[];
  highlightedContactIds?: Set<string>;
  onSelectContact?: (contact: EmMapContact) => void;
  onSelectStorm?: (storm: EmStorm) => void;
  selectedStormId?: string | null;
}) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const bounds = useMemo(() => fitBounds(contacts, storms), [contacts, storms]);

  const hoverContact = contacts.find((c) => c.contactId === hoverId) ?? null;

  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-gradient-to-b from-sky-50 to-paper-100">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Map of CRM contacts and active storms"
        className="h-auto w-full"
      >
        <defs>
          <pattern id="em-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="rgba(15, 23, 42, 0.06)"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width={WIDTH} height={HEIGHT} fill="url(#em-grid)" />

        {/* Soft land mass hint */}
        <ellipse
          cx={WIDTH * 0.52}
          cy={HEIGHT * 0.55}
          rx={WIDTH * 0.42}
          ry={HEIGHT * 0.38}
          fill="rgba(148, 163, 184, 0.12)"
        />

        {storms.map((storm) => {
          const lat = Number(storm.centerLat);
          const lng = Number(storm.centerLng);
          const { x, y } = project(lat, lng, bounds);
          const r = milesToPx(Number(storm.radiusMiles), lat, bounds);
          const selected = storm.id === selectedStormId;
          const stroke = SEVERITY_STROKE[storm.severity] ?? SEVERITY_STROKE.warning;
          return (
            <g key={storm.id}>
              <circle
                cx={x}
                cy={y}
                r={r}
                fill={stroke}
                fillOpacity={selected ? 0.18 : 0.1}
                stroke={stroke}
                strokeWidth={selected ? 2.5 : 1.5}
                strokeDasharray={storm.severity === 'watch' ? '6 4' : undefined}
                className="cursor-pointer transition"
                onClick={() => onSelectStorm?.(storm)}
              >
                <title>
                  {storm.name} · {storm.eventType} · {storm.radiusMiles} mi
                </title>
              </circle>
              <circle cx={x} cy={y} r={4} fill={stroke} />
            </g>
          );
        })}

        {contacts.map((contact) => {
          const { x, y } = project(contact.lat, contact.lng, bounds);
          const highlighted = highlightedContactIds?.has(contact.contactId);
          const hovered = hoverId === contact.contactId;
          return (
            <circle
              key={contact.contactId}
              cx={x}
              cy={y}
              r={highlighted || hovered ? 7 : 5}
              fill={
                contact.marketingOptOut
                  ? '#94a3b8'
                  : highlighted
                    ? '#dc2626'
                    : '#0f766e'
              }
              stroke="#fff"
              strokeWidth={1.5}
              className="cursor-pointer transition"
              onMouseEnter={() => setHoverId(contact.contactId)}
              onMouseLeave={() => setHoverId(null)}
              onClick={() => onSelectContact?.(contact)}
            >
              <title>
                {contact.name}
                {contact.city ? ` · ${contact.city}` : ''}
                {contact.email ? ` · ${contact.email}` : ''}
              </title>
            </circle>
          );
        })}
      </svg>

      {hoverContact && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-line bg-paper-0/95 px-3 py-2 text-sm shadow-sm">
          <p className="font-medium text-ink-900">{hoverContact.name}</p>
          <p className="text-xs text-ink-500">
            {[hoverContact.city, hoverContact.region].filter(Boolean).join(', ') || 'Location on file'}
            {hoverContact.marketingOptOut ? ' · opted out' : ''}
          </p>
        </div>
      )}

      <div className="absolute right-3 top-3 flex flex-col gap-1 rounded-lg border border-line bg-paper-0/90 px-2.5 py-2 text-[11px] text-ink-600">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-teal-700" /> Contact
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-600/80" /> In storm path
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-400" /> Opted out
        </span>
      </div>
    </div>
  );
}
