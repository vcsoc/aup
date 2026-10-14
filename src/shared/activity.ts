import type { Agent } from './types.js';
import { calendarDate, dateKey } from './stats.js';
const count = (value: number | undefined): number => value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;

/** Exact request time when available; imported day buckets only imply that day. */
export function lastActivity(agent: Agent, now = Date.now()): number {
  const recorded = count(agent.usage.lastUsedAt);
  let latest = recorded <= now ? recorded : 0;
  for (const day of agent.usage.history || agent.usage.days) {
    if (!count(day.tokens)) continue;
    const date = calendarDate(day.date); if (!date) continue;
    date.setHours(0, 0, 0, 0);
    const time = date.getTime(); if (time <= now) latest = Math.max(latest, time);
  }
  return latest;
}

/** Running first, then today's processed usage, recency, and recent volume.
 * CPU/RAM are deliberately not rank keys: samples must not make rows jitter.
 * Sorting a copy leaves collector order, IDs, and aggregate totals untouched.
 */
export function sortAgents(agents: readonly Agent[], now = Date.now()): Agent[] {
  const start = new Date(now); start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0);
  const from = dateKey(start), to = dateKey(new Date(now));
  return agents.map(agent => ({ agent, running: count(agent.resources.processes) ? 1 : 0,
    today: count(agent.usage.todayTokens), last: lastActivity(agent, now),
    recent: (agent.usage.history || agent.usage.days).reduce((sum, day) => sum + (day.date >= from && day.date <= to ? count(day.tokens) : 0), 0),
  })).sort((a, b) => b.running - a.running || b.today - a.today || b.last - a.last || b.recent - a.recent || a.agent.name.localeCompare(b.agent.name, 'en') || a.agent.id.localeCompare(b.agent.id, 'en')).map(row => row.agent);
}
