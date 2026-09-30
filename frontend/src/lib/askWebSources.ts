export type AskWebSource = { title: string; url: string; snippet: string };

/** http(s) only. The renderer never promotes a URL out of the answer text. */
export function safeAskWebSourceUrl(url: string): string {
  const value = String(url ?? '').trim();
  if (!/^https?:\/\/[^\s<>()[\]"'`\\]+$/i.test(value)) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return value;
  } catch {
    return '';
  }
}

export function displayAskWebSources(sources: readonly AskWebSource[] | null | undefined): AskWebSource[] {
  const out: AskWebSource[] = [];
  for (const source of sources ?? []) {
    const url = safeAskWebSourceUrl(source?.url ?? '');
    if (!url || out.some((row) => row.url === url)) continue;
    out.push({
      title: String(source.title ?? '').replace(/[<>]/g, '').trim() || 'Source',
      url,
      snippet: String(source.snippet ?? '').replace(/[<>]/g, '').trim(),
    });
    if (out.length >= 5) break;
  }
  return out;
}
