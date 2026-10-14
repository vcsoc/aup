import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseClaude, parseCodex, parseKimi, QuotaCollector, requestJson } from '../src/main/quotas.js';
import { defaultSettings } from '../src/main/settings.js';
const roots: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
describe('provider response contracts', () => {
  it('converts Anthropic percentages, including zero and model scopes', () => {
    expect(parseClaude({ five_hour: { utilization: 42, resets_at: '2026-11-01T00:00:00Z' }, seven_day: { utilization: 0 }, seven_day_sonnet: { utilization: 120 }, extra_usage: { enabled: true } }).map(row => row.percent)).toEqual([0.42, 0, 1]);
  });
  it('converts Codex primary and weekly windows without treating missing windows as zero', () => {
    const limits = parseCodex({ rateLimits: { primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1800000000 }, secondary: { usedPercent: 0, windowDurationMins: 10080 } } });
    expect(limits[0].percent).toBe(0.12); expect(limits[1].label).toContain('Weekly'); expect(limits[0].resetsAt).toBe('2027-01-15T08:00:00.000Z'); expect(parseCodex({})).toEqual([]);
  });
  it('parses Kimi ratios and legacy limit/remaining shapes', () => {
    expect(parseKimi({ usages: { limit_5h: { used_ratio: 0.3 }, limit_7d: { used_ratio: '0.5' } } }).map(row => row.percent)).toEqual([0.3, 0.5]);
    expect(parseKimi({ usage: { limit: 100, remaining: 75 }, limits: [{ detail: { limit: 10, used: 9, resetAt: 1800000000 }, window: { duration: 5, timeUnit: 'HOUR' } }] }).map(row => row.percent)).toEqual([0.25, 0.9]);
  });
});
describe('quota transport security', () => {
  it('refuses non-provider and insecure destinations before sending credentials', async () => {
    const fetcher = vi.fn();
    await expect(requestJson('https://evil.test/usage', 'secret', {}, fetcher)).rejects.toThrow('Untrusted');
    await expect(requestJson('http://api.anthropic.com/usage', 'secret', {}, fetcher)).rejects.toThrow('Untrusted'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('requires redirect rejection and does not expose a token in output', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => response({ five_hour: { utilization: 20 } }));
    const result = await requestJson('https://api.anthropic.com/api/oauth/usage', 'secret', {}, fetcher);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', headers: { Authorization: 'Bearer secret' } }); expect(JSON.stringify(result)).not.toContain('secret');
  });
  it.each([401, 403, 429, 500])('returns a display-safe HTTP %s error without upstream body', async status => {
    await expect(requestJson('https://api.kimi.com/coding/v1/usages', 'secret', {}, async () => response({ error: 'private upstream message' }, status))).rejects.not.toThrow('private');
  });
  it('bounds response size', async () => {
    await expect(requestJson('https://api.kimi.com/coding/v1/usages', 'secret', {}, async () => new Response('x'.repeat(1024 * 1024 + 1)))).rejects.toThrow('safety limit');
  });
});
describe('quota cache & privacy', () => {
  it('does not fetch anything while network checks are disabled', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const result = await new QuotaCollector().collect('claude', defaultSettings()); expect(result.status).toBe('Network quotas off'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('rate limits forced refresh, retains stale data on failure, and isolates credential rotations', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'aup-quota-')); roots.push(home);
    const settings = defaultSettings({}, home); settings.networkEnabled = true;
    await mkdir(settings.paths.claude, { recursive: true });
    const file = path.join(settings.paths.claude, '.credentials.json');
    const auth = (token: string) => JSON.stringify({ claudeAiOauth: { accessToken: token, subscriptionType: 'max' } });
    await writeFile(file, auth('token-one'));
    const fetcher = vi.fn(async () => response({ five_hour: { utilization: 42 } })); vi.stubGlobal('fetch', fetcher);
    const collector = new QuotaCollector();
    const live = await collector.collect('claude', settings); expect(live.limits[0].percent).toBe(0.42);
    await collector.collect('claude', settings, true); expect(fetcher).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 61000); fetcher.mockRejectedValue(new Error('secret-token-one'));
    const stale = await collector.collect('claude', settings, true); expect(stale.stale).toBe(true); expect(stale.limits).toEqual(live.limits); expect(stale.status).not.toContain('secret');
    await writeFile(file, auth('token-two'));
    const rotated = await collector.collect('claude', settings, true); expect(rotated.limits).toEqual([]); expect(rotated.stale).toBe(false);
    settings.networkEnabled = false; expect((await collector.collect('claude', settings)).limits).toEqual([]);
  });
  it('uses Kimi environment credentials only for Kimi and does not return them', async () => {
    vi.stubEnv('KIMI_API_KEY', 'private-kimi-key'); const fetcher = vi.fn(async () => response({ usages: { limit_5h: { used_ratio: 0.2 } } })); vi.stubGlobal('fetch', fetcher);
    const settings = defaultSettings(); settings.networkEnabled = true;
    const result = await new QuotaCollector().collect('kimi', settings); expect(result.limits[0].percent).toBe(0.2); expect(JSON.stringify(result)).not.toContain('private');
  });
});
