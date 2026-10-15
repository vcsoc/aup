import { describe, expect, it } from 'vitest';
import { newAgent, type HistoryDay } from '../src/shared/types.js';
import { emptyCost, costLabel, unknownCost } from '../src/shared/stats.js';
import { groupedHistory, historyRangeError, type HistoryGrouping } from '../src/shared/item-history.js';

const day = (date: string, tokens: number, usd: number, cachedTokens?: number): HistoryDay => ({ date, tokens, cachedTokens, cost: { ...emptyCost(), usd, knownTokens: tokens, recorded: true } });
const all = { from: '', to: '' };
const fixture = () => ({ ...newAgent('codex', 'Codex').usage, todayTokens: 999999, totalTokens: 9999999, history: [
  day('2025-12-28', 10, 1, 1), day('2025-12-29', 20, 2, 2), day('2026-01-01', 30, 3, 3),
  day('2026-01-04', 40, 4, 4), day('2026-02-01', 50, 5, 5), day('2026-02-02', 60, 6, 6),
] });

describe('item-specific retained history', () => {
  it('accepts blank, one-sided, and inclusive optional dates but rejects invalid/reversed dates', () => {
    for (const range of [all, { from: '2026-01-01', to: '' }, { from: '', to: '2026-01-01' }, { from: '2026-01-01', to: '2026-01-01' }, { from: '2000-01-01', to: '2099-12-31' }]) expect(historyRangeError(range)).toBe('');
    for (const from of ['bad', '2026-02-29', '2026-02-30']) expect(historyRangeError({ from, to: '' })).toContain('valid');
    expect(historyRangeError({ from: '', to: 'bad' })).toContain('valid');
    expect(groupedHistory(fixture(), { from: '2026-02-01', to: '2026-01-01' })).toMatchObject({ error: expect.stringContaining('End date'), groups: [], total: { tokens: 0 } });
  });
  it('shows only retained daily metrics, newest first, without adding today/lifetime totals', () => {
    const stats = groupedHistory(fixture(), all, 'day');
    expect(stats.groups.map(group => group.key)).toEqual(['2026-02-02', '2026-02-01', '2026-01-04', '2026-01-01', '2025-12-29', '2025-12-28']);
    expect(stats.total).toMatchObject({ tokens: 210, cachedTokens: 21, cost: { usd: 21 } });
  });
  it('uses Monday–Sunday weeks across months and years, counting each day exactly once', () => {
    const stats = groupedHistory(fixture(), all, 'week');
    expect(stats.groups.map(group => group.key)).toEqual(['2026-02-02', '2026-01-26', '2025-12-29', '2025-12-22']);
    expect(stats.groups[2]).toMatchObject({ label: 'Week of 2025-12-29', total: { tokens: 90, cost: { usd: 9 } } });
    expect(stats.groups[2].days.map(day => day.date)).toEqual(['2026-01-04', '2026-01-01', '2025-12-29']);
    expect(stats.groups.reduce((sum, group) => sum + group.total.tokens, 0)).toBe(stats.total.tokens);
  });
  it('keeps local days in their Monday-based weeks over DST changes and leap day', () => {
    const usage = { ...fixture(), history: [day('2026-03-08', 10, 1), day('2026-03-09', 20, 2), day('2028-02-29', 30, 3), day('2028-03-01', 40, 4)] };
    const stats = groupedHistory(usage, all, 'week');
    expect(stats.groups.map(group => [group.key, group.total.tokens])).toEqual([['2028-02-28', 70], ['2026-03-09', 20], ['2026-03-02', 10]]);
    expect(stats.total.tokens).toBe(100);
  });
  it('groups by calendar month or year and keeps daily rows descending within every group', () => {
    const months = groupedHistory(fixture(), all, 'month');
    expect(months.groups.map(group => [group.key, group.total.tokens, group.total.cost.usd])).toEqual([['2026-02', 110, 11], ['2026-01', 70, 7], ['2025-12', 30, 3]]);
    const years = groupedHistory(fixture(), all, 'year');
    expect(years.groups.map(group => [group.key, group.total.tokens])).toEqual([['2026', 180], ['2025', 30]]);
    expect(years.groups[0].days.map(day => day.date)).toEqual(['2026-02-02', '2026-02-01', '2026-01-04', '2026-01-01']);
  });
  it('applies both endpoints before aggregation, so partial periods contain only filtered days', () => {
    for (const grouping of ['day', 'week', 'month', 'year'] as HistoryGrouping[]) {
      const stats = groupedHistory(fixture(), { from: '2026-01-01', to: '2026-01-04' }, grouping);
      expect(stats.total).toMatchObject({ tokens: 70, cachedTokens: 7, cost: { usd: 7 } });
      expect(stats.groups.flatMap(group => group.days).map(day => day.date)).toEqual(['2026-01-04', '2026-01-01']);
      expect(stats.groups.reduce((sum, group) => sum + group.total.tokens, 0)).toBe(70);
    }
  });
  it('supports independent start-only/end-only filters, equal endpoints, and empty results', () => {
    expect(groupedHistory(fixture(), { from: '2026-02-01', to: '' }).total.tokens).toBe(110);
    expect(groupedHistory(fixture(), { from: '', to: '2026-01-01' }).total.tokens).toBe(60);
    expect(groupedHistory(fixture(), { from: '2026-01-01', to: '2026-01-01' }).total.tokens).toBe(30);
    expect(groupedHistory(fixture(), { from: '2027-01-01', to: '' }).groups).toEqual([]);
  });
  it('can reverse group and daily order without mutating history', () => {
    const usage = fixture(), before = structuredClone(usage);
    const stats = groupedHistory(usage, all, 'week', false);
    expect(stats.groups.map(group => group.key)).toEqual(['2025-12-22', '2025-12-29', '2026-01-26', '2026-02-02']);
    expect(stats.groups[1].days.map(day => day.date)).toEqual(['2025-12-29', '2026-01-01', '2026-01-04']);
    expect(usage).toEqual(before);
  });
  it('merges repeated daily aggregates and ignores malformed dates', () => {
    const usage = { ...fixture(), history: [day('2026-01-01', 10, 1, 2), day('2026-01-01', 20, 2, 3), day('bad', 999, 99)] };
    const stats = groupedHistory(usage, all, 'day');
    expect(stats.groups).toHaveLength(1); expect(stats.total).toMatchObject({ tokens: 30, cachedTokens: 5, cost: { usd: 3 } });
  });
  it('preserves partial/unknown costs and unknown cached breakdowns in every group', () => {
    const usage = { ...fixture(), history: [day('2026-01-01', 10, 1, 2), { date: '2026-01-02', tokens: 20, cost: unknownCost(20) }] };
    const stats = groupedHistory(usage, all, 'year');
    expect(stats.total.cachedTokens).toBeUndefined(); expect(costLabel(stats.total.cost)).toBe('$1.00+');
    expect(costLabel(stats.groups[0].total.cost)).toBe('$1.00+');
    expect(stats.groups[0].days[0].cost.unpricedTokens).toBe(20);
  });
  it('honors limited imported days without inventing missing years or prices', () => {
    const usage = { ...newAgent('imported', 'Imported').usage, days: [{ date: '2020-01-01', tokens: 10 }, { date: '2026-01-01', tokens: 20 }] };
    const stats = groupedHistory(usage, all, 'year');
    expect(stats.groups.map(group => group.key)).toEqual(['2026', '2020']);
    expect(stats.total.tokens).toBe(30); expect(costLabel(stats.total.cost)).toBe('—');
  });
  it('retains genuine zero-activity days without adding missing days', () => {
    const stats = groupedHistory({ ...fixture(), history: [day('2026-01-01', 0, 0)] }, all);
    expect(stats.groups[0].days).toHaveLength(1); expect(stats.total.tokens).toBe(0); expect(costLabel(stats.total.cost)).toBe('$0.00');
  });
});
