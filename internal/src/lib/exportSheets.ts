import type { ColumnType, ExportSheet } from './excel';
import type { KpiItem } from '../components/report';
import type { UserActivityEvent } from './types';

/** Shared sheet shapes used by more than one page. */
export function activitySheet(name: string, events: UserActivityEvent[]): ExportSheet {
  return {
    name,
    columns: [
      { header: 'When', type: 'datetime' },
      { header: 'Who' },
      { header: 'Actor user id' },
      { header: 'Org id' },
      { header: 'Action' },
      { header: 'Resource type' },
      { header: 'Resource id' },
      { header: 'Path' },
      { header: 'HTTP status', type: 'integer' },
    ],
    rows: events.map((row) => [
      row.occurredAt,
      row.actorEmail ?? row.actorLabel,
      row.actorUserId,
      row.orgId,
      row.action,
      row.resourceType,
      row.resourceId,
      row.path,
      row.status,
    ]),
  };
}

const RAW_UNIT: Partial<Record<ColumnType, string>> = { usd: 'USD', percent: '%', integer: 'count' };

/** The figures in a KPI strip as one sheet: metric, unit, value, and the value as shown. */
export function kpiSheet(name: string, items: KpiItem[]): ExportSheet {
  return {
    name,
    columns: [
      { header: 'Metric' },
      { header: 'Unit and period' },
      { header: 'Value', type: 'number' },
      { header: 'Value unit' },
      { header: 'As shown' },
      { header: 'Comparison' },
    ],
    rows: items.map((item) => [
      item.label,
      item.unit,
      { value: item.raw ?? null, type: item.rawType ?? 'number' },
      item.raw === null || item.raw === undefined ? null : (item.rawUnit ?? RAW_UNIT[item.rawType ?? 'number'] ?? null),
      item.value,
      item.comparison ?? item.note ?? null,
    ]),
  };
}
