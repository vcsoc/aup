import { describe, expect, it } from 'vitest';
import { emptyUsage } from '../src/shared/types.js';
import { tokenTotals } from '../src/shared/usage.js';

describe('token display units', () => {
  it('separates uncached input/output from processed tokens without changing history', () => {
    const usage = { ...emptyUsage(), todayTokens: 100, todayCachedTokens: 70 };
    expect(tokenTotals([usage, { ...usage, todayTokens: 200, todayCachedTokens: 150 }])).toEqual({ processed: 300, cached: 220, uncached: 80 });
    expect(usage.todayTokens).toBe(100);
  });
  it('never invents a cache breakdown for imported or total-only usage', () => {
    expect(tokenTotals([{ ...emptyUsage(), todayTokens: 42 }, { ...emptyUsage(), todayTokens: 100, todayCachedTokens: 70 }])).toEqual({ processed: 142 });
  });
  it('does not let empty provider rows hide a known breakdown', () => {
    expect(tokenTotals([emptyUsage(), { ...emptyUsage(), todayTokens: 100, todayCachedTokens: 70 }])).toEqual({ processed: 100, cached: 70, uncached: 30 });
  });
  it('clamps invalid cache ranges and treats non-finite cache counts as unknown', () => {
    expect(tokenTotals([{ ...emptyUsage(), todayTokens: 10, todayCachedTokens: 20 }])).toEqual({ processed: 10, cached: 10, uncached: 0 });
    expect(tokenTotals([{ ...emptyUsage(), todayTokens: 10, todayCachedTokens: -20 }])).toEqual({ processed: 10, cached: 0, uncached: 10 });
    expect(tokenTotals([{ ...emptyUsage(), todayTokens: 10, todayCachedTokens: NaN }])).toEqual({ processed: 10 });
  });
});
