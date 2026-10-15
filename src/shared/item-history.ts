import type { Usage } from './types.js';
import { aggregateRows, calendarDate, historyFor, weekRange, type DateRange, type StatsRow } from './stats.js';

export type HistoryGrouping = 'day' | 'week' | 'month' | 'year';
export interface HistoryGroup { key: string; label: string; days: StatsRow[]; total: StatsRow }

/** Empty endpoints are unbounded. No date expansion, so long histories are safe. */
export function historyRangeError(range: DateRange): string {
  if ((range.from && !calendarDate(range.from)) || (range.to && !calendarDate(range.to))) return 'Choose valid start and end dates, or leave them blank.';
  return range.from && range.to && range.from > range.to ? 'End date must be on or after start date.' : '';
}

/** Group only retained daily usage, never today's/lifetime totals a second time. */
export function groupedHistory(usage: Usage, range: DateRange, grouping: HistoryGrouping = 'week', descending = true): { error: string; groups: HistoryGroup[]; total: StatsRow } {
  const error = historyRangeError(range);
  if (error) return { error, groups: [], total: aggregateRows([]) };
  const byDate = new Map<string, StatsRow[]>();
  for (const day of historyFor(usage)) {
    if (!calendarDate(day.date) || (range.from && day.date < range.from) || (range.to && day.date > range.to)) continue;
    const rows = byDate.get(day.date) || [];
    rows.push({ ...day, id: day.date, name: day.date }); byDate.set(day.date, rows);
  }
  const daily = [...byDate].map(([date, rows]) => ({ ...aggregateRows(rows), id: date, name: date, date }));
  daily.sort((a, b) => (descending ? -1 : 1) * a.date.localeCompare(b.date));
  const groups = new Map<string, HistoryGroup>();
  for (const day of daily) {
    const key = grouping === 'year' ? day.date.slice(0, 4) : grouping === 'month' ? day.date.slice(0, 7) : grouping === 'week' ? weekRange(calendarDate(day.date)!).from : day.date;
    let group = groups.get(key);
    if (!group) {
      const label = grouping === 'week' ? `Week of ${key}` : key;
      group = { key, label, days: [], total: aggregateRows([]) }; groups.set(key, group);
    }
    group.days.push(day);
  }
  const result = [...groups.values()].sort((a, b) => (descending ? -1 : 1) * a.key.localeCompare(b.key));
  for (const group of result) group.total = aggregateRows(group.days);
  return { error: '', groups: result, total: aggregateRows(daily) };
}
