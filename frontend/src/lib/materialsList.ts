/** Materials card data: rows, source chips, and the MATERIALS_JSON summary parser. */

export type MaterialsSourceChip = {
  id: string;
  label: string;
  section?: string;
  jobId?: string;
  proofId?: string;
  atSeconds?: number;
  workDate?: string;
};

export type MaterialsListRow = {
  id: string;
  item: string;
  spec: string | null;
  quantity: number | null;
  unit: string | null;
  sources: MaterialsSourceChip[];
};

/** One chip per clip (or per other source); keeps a chip that can seek. */
export function uniqueSources(sources: MaterialsSourceChip[]): MaterialsSourceChip[] {
  const out: MaterialsSourceChip[] = [];
  const at = new Map<string, number>();
  for (const s of sources) {
    const key = s.proofId || (s.workDate ? `date:${s.workDate}` : `id:${s.id}`);
    const i = at.get(key);
    if (i == null) {
      at.set(key, out.length);
      out.push(s);
    } else if (out[i].atSeconds == null && s.atSeconds != null) {
      out[i] = s;
    }
  }
  return out;
}

/** Parse MATERIALS_JSON payload embedded in a Computer action summary. */
export function parseMaterialsSummary(summary: string | null | undefined): MaterialsListRow[] | null {
  const raw = String(summary ?? '');
  const marker = 'MATERIALS_JSON:';
  const idx = raw.indexOf(marker);
  if (idx < 0) return null;
  const json = raw.slice(idx + marker.length).trim();
  try {
    const parsed = JSON.parse(json) as { rows?: MaterialsListRow[] };
    return Array.isArray(parsed.rows) ? parsed.rows : null;
  } catch {
    return null;
  }
}
