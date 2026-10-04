/** Registrable-ish site of a host: "login.example.co.uk" → "example.co.uk", "a.b.example.com" → "example.com". */
export function siteOf(host: string): string {
  const parts = host.toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const sld = parts[parts.length - 2];
  return parts.slice(sld.length <= 3 && parts[parts.length - 1].length === 2 ? -3 : -2).join('.');
}

export function hostOfUrl(url: string | null | undefined): string | null {
  try {
    return url ? new URL(url).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}
