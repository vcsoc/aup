import { describe, expect, it } from 'vitest';
import { newAgent, type Agent } from '../src/shared/types.js';
import { lastActivity, sortAgents } from '../src/shared/activity.js';
const now = new Date(2026, 9, 14, 15).getTime();
const agent = (id: string, today = 0, running = false): Agent => {
  const value = newAgent(id, id); value.usage.todayTokens = today; value.resources.processes = running ? 1 : 0; return value;
};
const ids = (agents: Agent[]) => sortAgents(agents, now).map(value => value.id);
describe('default activity order', () => {
  it('keeps currently running agents above idle providers, even when the harness has no attributed tokens', () => {
    expect(ids([agent('idle', 1000000), agent('pi', 0, true)])).toEqual(['pi', 'idle']);
  });
  it('orders today’s processed usage descending within running and idle groups, not lifetime usage', () => {
    const old = agent('old'); old.usage.totalTokens = 1e9;
    expect(ids([old, agent('small', 10, true), agent('idle', 1000), agent('large', 100, true)])).toEqual(['large', 'small', 'idle', 'old']);
  });
  it('uses the latest real request time to break usage ties', () => {
    const earlier = agent('earlier', 100), latest = agent('latest', 100);
    earlier.usage.lastUsedAt = now - 3600000; latest.usage.lastUsedAt = now - 1000;
    expect(ids([earlier, latest])).toEqual(['latest', 'earlier']);
  });
  it('falls back to real nonzero imported dates without treating the file’s refresh as agent activity', () => {
    const old = agent('old'), recent = agent('recent');
    old.usage.days = [{ date: '2026-10-01', tokens: 1000 }, { date: '2026-10-14', tokens: 0 }];
    recent.usage.days = [{ date: '2026-10-13', tokens: 1 }];
    expect(ids([old, recent])).toEqual(['recent', 'old']);
    expect(lastActivity(recent, now)).toBe(new Date(2026, 9, 13).getTime());
  });
  it('ignores future/invalid dates and timestamps when deciding recency', () => {
    const value = agent('bad'); value.usage.lastUsedAt = now + 1000;
    value.usage.days = [{ date: '2026-10-15', tokens: 10 }, { date: '2026-02-30', tokens: 10 }];
    expect(lastActivity(value, now)).toBe(0);
    value.usage.lastUsedAt = NaN; expect(lastActivity(value, now)).toBe(0);
  });
  it('uses recent volume after recency, not old lifetime volume', () => {
    const small = agent('small'), large = agent('large');
    small.usage.days = [{ date: '2026-10-13', tokens: 1 }]; large.usage.days = [{ date: '2026-10-13', tokens: 100 }];
    expect(ids([small, large])).toEqual(['large', 'small']);
  });
  it('has deterministic name/id ties, leaves the source array untouched, and ignores CPU/RAM jitter', () => {
    const a = agent('a'), b = agent('b'); a.name = b.name = 'Same'; b.resources.cpu = 99; b.resources.memory = 1e9;
    const input = [b, a]; expect(ids(input)).toEqual(['a', 'b']); expect(input).toEqual([b, a]);
    a.resources.cpu = 100; b.resources.cpu = 0; expect(ids(input)).toEqual(['a', 'b']);
  });
  it('reorders on new usage or a process starting/stopping without a saved preference', () => {
    const a = agent('a', 10), b = agent('b', 20); expect(ids([a, b])).toEqual(['b', 'a']);
    a.usage.todayTokens = 30; expect(ids([a, b])).toEqual(['a', 'b']);
    b.resources.processes = 1; expect(ids([a, b])).toEqual(['b', 'a']);
    b.resources.processes = 0; expect(ids([a, b])).toEqual(['a', 'b']);
  });
});
