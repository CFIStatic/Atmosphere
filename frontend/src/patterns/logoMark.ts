import type { Connection } from '../domain/types';

/**
 * Initials for the tile. Prefers an explicit override, then the internal
 * capitals of a CamelCase product name (XactAnalysis → XA), then the first
 * letters of the first two words.
 */
export function monogramFor(connection: Pick<Connection, 'name' | 'mark'>): string {
  if (connection.mark) return connection.mark;

  const name = connection.name.trim();
  const capitals = name.replace(/[^A-Z]/g, '');
  if (capitals.length >= 2) return capitals.slice(0, 2);

  const words = name.split(/[\s/]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/**
 * Black or white text over the brand colour, whichever is legible. Some vendor
 * colours are bright (Sage green, magicplan orange) and white on them is
 * unreadable, so this is picked per colour rather than assumed.
 */
export function readableOn(hex: string): string {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast against white vs against near-black; take the better one.
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? '#ffffff' : '#111111';
}
