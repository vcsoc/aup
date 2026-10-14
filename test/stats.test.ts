import { describe, expect, it } from 'vitest';
import { newAgent, type HistoryDay } from '../src/shared/types.js';
import { aggregateRows, calendarDate, costLabel, dateKey, emptyCost, historyFor, rangeError, rangeStats, shiftRange, sumCosts, unknownCost, weekRange } from '../src/shared/stats.js';
const day = (date: string, tokens: number, usd: number, cachedTokens?: number): HistoryDay => ({ date, tokens, cachedTokens, cost: { ...emptyCost(), usd, knownTokens: tokens, estimated: true } });

describe('local calendar ranges', () => {
  it('defaults to the complete Monday–Sunday week, including future days', () => {
    expect(weekRange(new Date(2026, 9, 14, 23))).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(weekRange(new Date(2026, 9, 18, 12))).toEqual({ from: '2026-10-12', to: '2026-10-18' });
  });
  it('cycles dates by calendar weeks across month/year and DST boundaries', () => {
    expect(shiftRange({ from: '2026-12-28', to: '2027-01-03' }, 7)).toEqual({ from: '2027-01-04', to: '2027-01-10' });
    expect(shiftRange({ from: '2026-03-02', to: '2026-03-08' }, 7)).toEqual({ from: '2026-03-09', to: '2026-03-15' });
    expect(shiftRange({ from: '2026-10-14', to: '2026-10-15' }, -7)).toEqual({ from: '2026-10-07', to: '2026-10-08' });
  });
  it('validates real inclusive dates and bounds pathological range expansion', () => {
    for (const value of ['2026-02-30', '2026-13-01', '2026-2-01', '', '<script>']) expect(calendarDate(value)).toBeUndefined();
    expect(dateKey(calendarDate('2028-02-29')!)).toBe('2028-02-29');
    expect(rangeError({ from: '2026-10-14', to: '2026-10-14' })).toBe('');
    expect(rangeError({ from: '2026-10-15', to: '2026-10-14' })).toContain('End date');
    expect(rangeError({ from: '2000-01-01', to: '2026-01-01' })).toContain('ten years');
  });
});
describe('provider and day statistics', () => {
  const fixture = () => {
    const codex = newAgent('codex', 'Codex'); const pi = newAgent('pi', 'Pi (harness)');
    codex.usage.history = [day('2026-09-01', 100, 1, 30), day('2026-10-12', 200, 2, 100), day('2026-10-14', 300, 3, 150)];
    pi.usage.history = [day('2026-10-14', 50, 0.5, 0)];
    return [codex, pi];
  };
  it('sums the selected inclusive dates per provider and per day without re-adding provider totals', () => {
    const stats = rangeStats(fixture(), { from: '2026-10-12', to: '2026-10-18' });
    expect(stats.total.tokens).toBe(550); expect(stats.total.cost.usd).toBe(5.5); expect(stats.total.cachedTokens).toBe(250);
    expect(stats.providers.map(row => row.tokens)).toEqual([500, 50]);
    expect(stats.days.filter(row => row.date === '2026-10-14').map(row => row.tokens)).toEqual([300, 50]);
    expect(stats.days.filter(row => row.date === '2026-10-18')[0].tokens).toBe(0);
  });
  it('supports dates outside the seven-day chart and provider filtering', () => {
    const older = rangeStats(fixture(), { from: '2026-09-01', to: '2026-09-01' });
    expect(older.total.tokens).toBe(100); expect(older.total.cost.usd).toBe(1);
    const filtered = rangeStats(fixture(), { from: '2026-10-12', to: '2026-10-18' }, 'codex');
    expect(filtered.providers).toHaveLength(1); expect(filtered.total.tokens).toBe(500); expect(filtered.days.every(row => row.id === 'codex' || row.id === 'empty')).toBe(true);
  });
  it('does not create thousands of zero rows for long custom ranges', () => {
    expect(rangeStats(fixture(), { from: '2026-01-01', to: '2026-12-31' }).days).toHaveLength(4);
    expect(rangeStats(fixture(), { from: 'bad', to: '2026-10-14' }).total.tokens).toBe(0);
  });
  it('keeps missing cached breakdowns and imported costs unknown', () => {
    const imported = newAgent('custom', 'Imported');
    imported.usage.days = [{ date: '2026-10-14', tokens: 42 }];
    const stats = rangeStats([imported], { from: '2026-10-14', to: '2026-10-14' });
    expect(stats.total.cachedTokens).toBeUndefined(); expect(stats.total.cost.unpricedTokens).toBe(42); expect(costLabel(stats.total.cost)).toBe('—');
    expect(historyFor({ ...imported.usage, todayTokens: 10, days: [] }, '2026-10-15')[0]).toMatchObject({ date: '2026-10-15', tokens: 10 });
  });
  it('adds known and unknown costs without presenting partial totals as complete', () => {
    const known = { ...emptyCost(), usd: 1.25, knownTokens: 100, recorded: true };
    const mixed = sumCosts([known, unknownCost(50)]);
    expect(costLabel(mixed)).toBe('$1.25+'); expect(mixed.recorded).toBe(true); expect(mixed.unpricedTokens).toBe(50);
    expect(costLabel(emptyCost())).toBe('$0.00');
    expect(costLabel({ ...known, usd: 0.001 })).toBe('<$0.01');
    expect(aggregateRows([{ id: 'a', name: 'A', tokens: 0, cost: emptyCost() }, { id: 'b', name: 'B', tokens: 100, cachedTokens: 50, cost: known }]).cachedTokens).toBe(50);
  });
});
