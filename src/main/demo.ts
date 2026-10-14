import { names, newAgent, type Snapshot } from '../shared/types.js';
import { recentDays } from './usage.js';
import { emptyCost, sumCosts } from '../shared/stats.js';
import { bundledPricing } from './pricing.js';
export function demoSnapshot(): Snapshot {
  const values = [0.42, 0.73, 0.18, 0.91, 0, 0];
  const agents = Object.entries(names).map(([id, name], i) => {
    const agent = newAgent(id, name); const days = recentDays(new Date());
    agent.plan = ['Max', 'Plus', 'SuperGrok', 'Allegretto', 'Prepaid', 'Local'][i];
    agent.source = 'Demo fixture'; agent.quotaAt = Date.now(); agent.quotaStatus = 'Demo data';
    agent.limits = i < 4 ? [
      { label: 'Session · 5 hours', percent: values[i], resetsAt: new Date(Date.now() + 6300000).toISOString() },
      { label: 'Weekly · 7 days', percent: values[i] * 0.7, resetsAt: new Date(Date.now() + 257400000).toISOString() },
    ] : [];
    if (id === 'fireworks') agent.balance = { remaining: 17.42, currency: 'USD', estimated: false };
    agent.usage = {
      todayTokens: [184200, 96300, 38400, 67500, 21200, 146000][i], totalTokens: 4200000 + i * 120000,
      todayCachedTokens: Math.round([184200, 96300, 38400, 67500, 21200, 146000][i] * 0.6),
      prompts: 14 + i * 3, sessions: 12 + i,
      days: days.map((date, day) => ({ date, tokens: [42, 68, 31, 84, 58, 92, 74][day] * (i + 1) * 1000 })),
      models: { [(['claude-opus', 'gpt-codex', 'grok-code', 'kimi', 'deepseek', 'gpt'][i])]: 4200000 },
    };
    agent.usage.history = agent.usage.days.map(day => ({ ...day, cachedTokens: Math.round(day.tokens * 0.6), cost: { ...emptyCost(), usd: day.tokens / 1e6 * (i + 1), knownTokens: day.tokens, estimated: true } }));
    const current = agent.usage.history[agent.usage.history.length - 1];
    current.tokens = agent.usage.todayTokens; current.cachedTokens = agent.usage.todayCachedTokens;
    current.cost = { ...emptyCost(), usd: current.tokens / 1e6 * (i + 1), knownTokens: current.tokens, estimated: true };
    agent.usage.days[agent.usage.days.length - 1].tokens = current.tokens;
    agent.usage.todayCost = current.cost; agent.usage.totalCost = sumCosts(agent.usage.history.map(day => day.cost));
    agent.resources = { cpu: [2.4, 1.1, 0, 0.6, 0, 0.9][i], memory: [182, 94, 0, 72, 0, 121][i] * 1024 * 1024, processes: [3, 2, 0, 1, 0, 2][i] };
    return agent;
  });
  return { agents, updatedAt: Date.now(), resourceAt: Date.now(), scanning: false, demo: true, errors: [], platform: process.platform, pricing: { fetchedAt: bundledPricing.fetchedAt, models: Object.keys(bundledPricing.models).length } };
}
