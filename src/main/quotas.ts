import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Balance, Limit, ProviderId, Settings } from '../shared/types.js';
import { jsonFile, number, object, optionalJson, ratio, text, timestamp, type Json } from './files.js';
import { codexLimits } from './rpc.js';
import { normalizeLimits } from './imports.js';

const exec = promisify(execFile);
const endpoints = {
  claude: 'https://api.anthropic.com/api/oauth/usage',
  grok: 'https://cli-chat-proxy.grok.com/v1/billing?format=credits',
  kimi: 'https://api.kimi.com/coding/v1/usages',
  fireworks: 'https://api.fireworks.ai',
} as const;
export interface Quota { limits: Limit[]; plan: string; status: string; at: number; stale: boolean; balance?: Balance }
interface Credential { token: string; plan: string; identity: string; expired?: boolean; account?: string }
const fingerprint = (value: string): string => createHash('sha256').update(value).digest('hex');
export async function requestJson(url: string, token: string, headers: Record<string, string> = {}, fetcher = fetch): Promise<Json> {
  const allowed = Object.values(endpoints).some(endpoint => new URL(endpoint).origin === new URL(url).origin);
  if (!allowed || new URL(url).protocol !== 'https:') throw new Error('Untrusted quota endpoint blocked');
  const response = await fetcher(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...headers },
    redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403) throw new Error('Sign-in or billing permission required. Renew the provider CLI login.');
    if (response.status === 429) throw new Error('Provider rate limit reached; next scheduled check will retry.');
    throw new Error(`Quota endpoint returned HTTP ${response.status}`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty quota response');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 1024 * 1024) throw new Error('Quota response exceeded safety limit');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

async function credential(id: ProviderId, settings: Settings): Promise<Credential> {
  const home = settings.paths[id]; let token = ''; let plan = ''; let expired = false; let account = '';
  if (id === 'claude') {
    let raw = await optionalJson(path.join(home, '.credentials.json'));
    // Claude Code uses macOS Keychain rather than the Linux/Windows file.
    // Query one fixed service only, only after network access was enabled.
    if (!raw.claudeAiOauth && process.platform === 'darwin' && !process.env.CLAUDE_CONFIG_DIR && home === path.join((await import('node:os')).homedir(), '.claude')) {
      try {
        const { stdout } = await exec('/usr/bin/security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 5000, maxBuffer: 1024 * 1024 });
        raw = object(JSON.parse(stdout));
      } catch { /* locked/missing Keychain entries stay unavailable */ }
    }
    const oauth = object(raw.claudeAiOauth);
    token = text(oauth.accessToken, 16000); plan = text(oauth.subscriptionType);
    expired = number(oauth.expiresAt) > 0 && number(oauth.expiresAt) <= Date.now();
  } else if (id === 'codex') {
    // The CLI itself handles file/keychain auth. The fingerprint is internal
    // only; auth contents are never saved by this application.
    const auth = await optionalJson(path.join(home, 'auth.json'));
    const config = await optionalText(path.join(home, 'config.toml'));
    token = fingerprint(JSON.stringify(auth) + config + (process.env.CODEX_ACCESS_TOKEN || ''));
  } else if (id === 'grok') {
    const raw = await optionalJson(path.join(home, 'auth.json'));
    const oauth = object(Object.values(raw).find(value => value && typeof value === 'object'));
    token = text(oauth.key, 16000);
    const expiry = timestamp(oauth.expires_at); expired = !!expiry && Date.parse(expiry) <= Date.now();
    const cache = await optionalJson(path.join(home, 'settings_cache.json'));
    try { plan = text(object(object(JSON.parse(cache.payload)).settings).subscription_tier_display); } catch { /* optional */ }
  } else if (id === 'kimi') {
    token = (process.env.KIMI_API_KEY || '').trim();
    if (!token) {
      let raw = await optionalJson(path.join(home, 'credentials', 'kimi-code.json'));
      if (!Object.keys(raw).length && !process.env.KIMI_CODE_HOME && home === path.join((await import('node:os')).homedir(), '.kimi-code')) {
        raw = await optionalJson(path.join(path.dirname(home), '.kimi', 'credentials', 'kimi-code.json'));
      }
      token = text(raw.access_token, 16000);
      const expiry = timestamp(raw.expires_at); expired = !!expiry && Date.parse(expiry) <= Date.now();
    }
  } else if (id === 'fireworks') {
    token = (process.env.FIREWORKS_API_KEY || '').trim(); account = (process.env.FIREWORKS_ACCOUNT_ID || '').trim();
    const ini = await optionalText(path.join(home, 'auth.ini'));
    token ||= ini.match(/^\s*api[_-]key\s*=\s*["']?([^\r\n"']+)/mi)?.[1]?.trim() || '';
    account ||= ini.match(/^\s*account[_-]id\s*=\s*["']?([^\r\n"']+)/mi)?.[1]?.trim() || '';
  }
  return { token, plan, identity: fingerprint(`${home}\0${token}\0${account}\0${settings.codexBinary}`), expired, account };
}
async function optionalText(file: string): Promise<string> {
  try { if ((await stat(file)).size > 1024 * 1024) return ''; return await readFile(file, 'utf8'); } catch { return ''; }
}
export function parseClaude(data: Json): Limit[] {
  return Object.entries(data).flatMap(([key, raw]) => {
    const row = object(raw);
    if (!Number.isFinite(row.utilization)) return [];
    return [{ label: ({ five_hour: 'Session · 5 hours', seven_day: 'Weekly · 7 days' } as Record<string, string>)[key] || text(key.replaceAll('_', ' ')), percent: ratio(row.utilization / 100), resetsAt: timestamp(row.resets_at) }];
  });
}
export function parseCodex(data: Json): Limit[] {
  const limits = object(data.rateLimits);
  return ['primary', 'secondary'].flatMap(key => {
    const row = object(limits[key]);
    if (!Number.isFinite(row.usedPercent)) return [];
    const mins = number(row.windowDurationMins);
    return [{ label: mins === 10080 ? 'Weekly · 7 days' : mins ? `${mins / 60} hour window` : 'Limit', percent: ratio(row.usedPercent / 100), resetsAt: timestamp(row.resetsAt) }];
  });
}
export function parseKimi(data: Json): Limit[] {
  const rows: Limit[] = [];
  if (data.usages && typeof data.usages === 'object' && !Array.isArray(data.usages)) {
    for (const [key, raw] of Object.entries(object(data.usages))) {
      const row = object(raw); const value = Number(row.used_ratio);
      if (row.used_ratio === undefined || !Number.isFinite(value)) continue;
      rows.push({ label: text(key.replaceAll('_', ' ')), percent: ratio(value), resetsAt: timestamp(row.reset_at || row.resetAt) });
    }
    return rows;
  }
  for (const [index, raw] of [data.usage, ...(Array.isArray(data.limits) ? data.limits : [])].entries()) {
    const item = object(raw); const detail = object(item.detail || item); const limit = Number(detail.limit);
    const used = detail.used === undefined ? limit - Number(detail.remaining) : Number(detail.used);
    if (!(limit > 0) || !Number.isFinite(used)) continue;
    const window = object(item.window);
    rows.push({ label: text(item.name || detail.name) || (window.duration ? `${window.duration} ${text(window.timeUnit).toLowerCase()}` : index === 0 ? 'Weekly' : `Limit ${index}`), percent: ratio(used / limit), resetsAt: timestamp(detail.reset_at || detail.resetAt || detail.reset_time || detail.resetTime) });
  }
  return rows;
}
export class QuotaCollector {
  private cache = new Map<ProviderId, { identity: string; quota: Quota; checkedAt: number }>();
  clear(): void { this.cache.clear(); }
  async collect(id: ProviderId, settings: Settings, force = false): Promise<Quota> {
    const blank: Quota = { limits: [], plan: '', status: 'Network quotas off', at: 0, stale: false };
    if (!settings.networkEnabled || id === 'pi') return { ...blank, status: id === 'pi' ? 'Local token usage' : blank.status };
    const auth = await credential(id, settings);
    let cached = this.cache.get(id);
    if (cached && cached.identity !== auth.identity) { this.cache.delete(id); cached = undefined; }
    // A manual refresh cannot hammer endpoints; respect at least one minute.
    const interval = (force ? 60 : settings.refreshSeconds) * 1000;
    if (cached && Date.now() - cached.checkedAt < interval) return cached.quota;
    try {
      if (!auth.token) throw new Error('Sign in with the provider CLI to see limits.');
      if (auth.expired) throw new Error('Saved sign-in expired. Start the provider CLI to renew it.');
      let limits: Limit[] = []; let balance: Balance | undefined; let plan = auth.plan;
      if (id === 'claude') limits = parseClaude(await requestJson(endpoints.claude, auth.token, { 'anthropic-beta': 'oauth-2025-04-20' }));
      else if (id === 'codex') {
        const data = await codexLimits(settings.paths.codex, settings.codexBinary);
        limits = parseCodex(data); plan = text(object(data.rateLimits).planType);
      } else if (id === 'kimi') limits = parseKimi(await requestJson(endpoints.kimi, auth.token));
      else if (id === 'grok') {
        const config = object((await requestJson(endpoints.grok, auth.token)).config); const period = object(config.currentPeriod);
        if (!period.end) throw new Error('Grok returned an unsupported usage response.');
        limits = [{ label: String(period.type).includes('WEEK') ? 'Weekly' : 'Monthly', percent: ratio(number(config.creditUsagePercent) / 100), resetsAt: timestamp(period.end) }];
      } else if (id === 'fireworks') {
        const account = (auth.account || '').replace(/^accounts\//, '');
        if (!account) throw new Error('Set FIREWORKS_ACCOUNT_ID as well as FIREWORKS_API_KEY.');
        const data = await requestJson(`${endpoints.fireworks}/v1/accounts/${encodeURIComponent(account)}:getBalance`, auth.token);
        const money = [data, data.balance, data.creditBalance, data.prepaidBalance, data.amount].map(object).find(item => item.units !== undefined || item.nanos !== undefined);
        if (!money) throw new Error('Fireworks returned no readable balance. Import its Omarchy record for estimated billing.');
        const amount = Number(money.units || 0) + Number(money.nanos || 0) / 1e9;
        if (!Number.isFinite(amount) || amount < 0) throw new Error('Fireworks balance is invalid.');
        balance = { remaining: amount, currency: text(money.currencyCode, 3) || 'USD', estimated: false };
      }
      if (!limits.length && !balance) throw new Error('Provider returned no supported quota windows.');
      const quota: Quota = { limits: normalizeLimits(limits), balance, plan, status: 'Live quota', at: Date.now(), stale: false };
      this.cache.set(id, { identity: auth.identity, quota, checkedAt: Date.now() }); return quota;
    } catch (error) {
      const safeMessage = error instanceof Error && /^(Sign |Saved |Set |Codex |Provider |Fireworks |Grok |Quota endpoint|Provider rate)/.test(error.message) ? error.message : 'Quota check failed (network, timeout, or unsupported response).';
      const quota = { ...blank, ...cached?.quota, plan: cached?.quota.plan || auth.plan, stale: !!cached?.quota.at, status: safeMessage };
      this.cache.set(id, { identity: auth.identity, quota, checkedAt: Date.now() }); return quota;
    }
  }
}
