import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { emptyUsage, newAgent, type Agent, type Limit } from '../shared/types.js';
import { jsonFile, number, object, ratio, text, timestamp, type Json } from './files.js';

export function normalizeLimits(raw: unknown): Limit[] {
  return (Array.isArray(raw) ? raw : []).slice(0, 30).flatMap(item => {
    const row = object(item);
    if (typeof row.percent !== 'number' || !Number.isFinite(row.percent) || row.percent < 0) return [];
    return [{ label: text(row.label) || 'Limit', percent: ratio(row.percent), resetsAt: timestamp(row.resetsAt) }];
  });
}
export function normalizeRecord(raw: Json, modified: number, now = Date.now()): Agent | undefined {
  const id = text(raw.id, 80);
  if (!/^[a-z][a-z0-9_-]{0,79}$/.test(id)) return undefined;
  const agent = newAgent(id, text(raw.name) || id);
  agent.source = 'Omarchy record'; agent.plan = text(raw.tierLabel);
  agent.limits = normalizeLimits(raw.limits);
  agent.quotaAt = number(raw.limitsFetchedAt) || modified;
  agent.stale = raw.limitsStale === true || now - agent.quotaAt > 30 * 60 * 1000;
  agent.quotaStatus = text(raw.usageStatusText) || (agent.stale ? 'Imported record is stale' : 'Imported limits');
  const balance = object(raw.balance);
  if (typeof balance.remaining === 'number' && Number.isFinite(balance.remaining) && balance.remaining >= 0) {
    agent.balance = { remaining: balance.remaining, currency: text(balance.currency, 3) || 'USD', estimated: balance.estimated === true };
  }
  agent.usage = {
    todayTokens: number(raw.todayTotalTokens), totalTokens: 0, prompts: number(raw.todayPrompts), sessions: number(raw.totalSessions),
    days: (Array.isArray(raw.recentDays) ? raw.recentDays : []).slice(-7).map(item => ({ date: text(object(item).date, 10), tokens: number(object(item).messageCount) })),
    models: Object.create(null),
  };
  for (const [model, value] of Object.entries(object(raw.modelUsage)).slice(0, 200)) {
    const bucket = object(value);
    const tokens = number(bucket.inputTokens) + number(bucket.outputTokens) + number(bucket.cacheReadInputTokens) + number(bucket.cacheCreationInputTokens);
    agent.usage.models[text(model)] = tokens; agent.usage.totalTokens += tokens;
  }
  return agent;
}
export async function importRecords(dir: string): Promise<{ agents: Agent[]; warnings: string[] }> {
  const agents: Agent[] = []; const warnings: string[] = [];
  if (!dir) return { agents, warnings };
  let files;
  try { files = await readdir(dir, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push('Cannot read the Omarchy import directory.');
    return { agents, warnings };
  }
  const seen = new Set<string>();
  for (const entry of files.filter(f => f.isFile() && f.name.endsWith('.json')).slice(0, 100)) {
    try {
      const file = path.join(dir, entry.name); const raw = await jsonFile(file);
      const agent = normalizeRecord(raw, (await stat(file)).mtimeMs);
      if (!agent || seen.has(agent.id)) continue;
      seen.add(agent.id); agents.push(agent);
      for (const item of (Array.isArray(raw.accounts) ? raw.accounts : []).slice(0, 20)) {
        const account = object(item); const accountId = text(account.id, 60);
        if (!/^[a-zA-Z0-9_-]+$/.test(accountId)) continue;
        const child = newAgent(`${agent.id}/${accountId}`, `${agent.name} · ${text(account.label) || accountId}${account.active === true ? ' (active)' : ''}`);
        child.source = 'Omarchy account'; child.plan = text(account.plan);
        child.limits = normalizeLimits(account.limits); child.quotaAt = agent.quotaAt;
        child.stale = account.stale === true || agent.stale; child.usage = emptyUsage();
        child.quotaStatus = text(account.usageStatusText) || 'Imported account';
        agents.push(child);
      }
      // Multi-account records repeat the active account at top level. Show
      // limits only in the individual rows, and keep usage on the provider.
      if (Array.isArray(raw.accounts) && raw.accounts.length > 1) agent.limits = [];
    } catch { warnings.push('An Omarchy record was invalid or unreadable and was skipped.'); }
  }
  return { agents, warnings: [...new Set(warnings)] };
}
