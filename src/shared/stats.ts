import type { Agent, CostSummary, HistoryDay, Usage } from './types.js';

export const emptyCost = (): CostSummary => ({ usd: 0, knownTokens: 0, unpricedTokens: 0, estimated: false, recorded: false });
export const unknownCost = (tokens: number): CostSummary => ({ ...emptyCost(), unpricedTokens: tokens });
export function sumCosts(costs: CostSummary[]): CostSummary {
  return costs.reduce((sum, cost) => ({ usd: sum.usd + cost.usd, knownTokens: sum.knownTokens + cost.knownTokens,
    unpricedTokens: sum.unpricedTokens + cost.unpricedTokens, estimated: sum.estimated || cost.estimated, recorded: sum.recorded || cost.recorded }), emptyCost());
}
export function costLabel(cost: CostSummary): string {
  if (!cost.knownTokens && cost.unpricedTokens) return '—';
  const amount = cost.usd > 0 && cost.usd < 0.005 ? '<$0.01' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cost.usd);
  return `${amount}${cost.unpricedTokens ? '+' : ''}`;
}
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function calendarDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && dateKey(date) === value ? date : undefined;
}
export interface DateRange { from: string; to: string }
export function shiftRange(range: DateRange, days: number): DateRange {
  const from = calendarDate(range.from), to = calendarDate(range.to);
  if (!from || !to) return range;
  from.setDate(from.getDate() + days); to.setDate(to.getDate() + days);
  return { from: dateKey(from), to: dateKey(to) };
}
export function weekRange(now = new Date()): DateRange {
  const monday = new Date(now); monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
  return { from: dateKey(monday), to: dateKey(sunday) };
}
export function rangeError(range: DateRange): string {
  const from = calendarDate(range.from), to = calendarDate(range.to);
  if (!from || !to) return 'Choose valid start and end dates.';
  if (range.from > range.to) return 'End date must be on or after start date.';
  if ((to.getTime() - from.getTime()) / 86400000 > 3660) return 'Choose a range of ten years or less.';
  return '';
}
export interface StatsRow { id: string; name: string; date?: string; tokens: number; cachedTokens?: number; cost: CostSummary }
export function historyFor(usage: Usage, today = dateKey(new Date())): HistoryDay[] {
  if (usage.history) return usage.history;
  // Imported aggregates only expose recent days; do not distribute lifetime
  // model totals or today's cost over unobserved dates.
  const days = usage.days.map(day => ({ ...day, cost: unknownCost(day.tokens) }));
  if (usage.todayTokens && !days.some(day => day.date === today)) days.push({ date: today, tokens: usage.todayTokens, cost: usage.todayCost || unknownCost(usage.todayTokens) });
  return days;
}
export function aggregateRows(rows: StatsRow[]): StatsRow {
  const tokens = rows.reduce((sum, row) => sum + row.tokens, 0);
  const cachedTokens = rows.some(row => row.tokens && row.cachedTokens === undefined) ? undefined : rows.reduce((sum, row) => sum + (row.cachedTokens || 0), 0);
  return { id: 'total', name: 'Total', tokens, cachedTokens, cost: sumCosts(rows.map(row => row.cost)) };
}
export function rangeStats(agents: Agent[], range: DateRange, provider = 'all'): { providers: StatsRow[]; days: StatsRow[]; total: StatsRow } {
  if (rangeError(range)) return { providers: [], days: [], total: aggregateRows([]) };
  const days: StatsRow[] = [];
  const providers = agents.filter(agent => provider === 'all' || agent.id === provider).map(agent => {
    const rows = historyFor(agent.usage).filter(day => day.date >= range.from && day.date <= range.to).map(day => ({ ...day, id: agent.id, name: agent.name }));
    days.push(...rows.filter(row => row.tokens > 0));
    return { ...aggregateRows(rows), id: agent.id, name: agent.name };
  });
  // Include zero-activity dates for ordinary ranges without expanding years of
  // missing history into an unbounded table.
  const from = calendarDate(range.from)!, to = calendarDate(range.to)!;
  if ((to.getTime() - from.getTime()) / 86400000 <= 93) {
    for (const date = new Date(from); date <= to; date.setDate(date.getDate() + 1)) {
      const key = dateKey(date);
      if (!days.some(day => day.date === key)) days.push({ id: 'empty', name: 'No recorded usage', date: key, tokens: 0, cachedTokens: 0, cost: emptyCost() });
    }
  }
  days.sort((a, b) => a.date!.localeCompare(b.date!) || a.name.localeCompare(b.name));
  return { providers, days, total: aggregateRows(providers) };
}
