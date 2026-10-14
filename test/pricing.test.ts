import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PRICE_URL, bundledPricing, fetchPricing, loadPricing, normalizePricingData, quoteCost, savePricing, validateCatalog } from '../src/main/pricing.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const raw = { openai: { models: { model: { cost: { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5, tiers: [{ tier: { type: 'context', size: 200000 }, input: 4, output: 15, cache_read: 0.4, cache_write: 5 }] } } } } };
const event = { model: 'model', pricingProvider: 'openai-codex', tokens: 1000000, inputTokens: 300000, outputTokens: 100000, cacheReadTokens: 500000, cacheWriteTokens: 100000 };
describe('model price estimates', () => {
  it('normalizes only bounded known price fields, preserving explicit context thresholds', () => {
    const catalog = normalizePricingData(raw);
    expect(catalog.source).toBe(PRICE_URL); expect(catalog.models['openai/model'].input).toBe(2);
    expect(catalog.models['openai/model'].tiers?.[0].above).toBe(200000);
    expect(() => normalizePricingData({ openai: { models: { bad: { cost: { input: -1, output: '10' } } } } })).toThrow();
  });
  it('prices uncached input, output, cached reads, and cache creation once with context tiers', () => {
    const cost = quoteCost(event, normalizePricingData(raw));
    expect(cost.usd).toBeCloseTo(3.4); expect(cost.knownTokens).toBe(1000000); expect(cost.estimated).toBe(true);
  });
  it('uses base pricing at the exact context threshold, then the correct larger tier', () => {
    const catalog = normalizePricingData(raw);
    const at = { ...event, tokens: 300000, inputTokens: 100000, cacheReadTokens: 100000, cacheWriteTokens: 0 };
    expect(quoteCost(at, catalog).usd).toBeCloseTo(1.22);
    expect(quoteCost({ ...at, tokens: 300001, inputTokens: 100001 }, catalog).usd).toBeCloseTo(1.940004);
  });
  it('prefers recorded USD, including an explicit zero, without inventing a subscription charge', () => {
    const catalog = normalizePricingData(raw);
    expect(quoteCost({ ...event, recordedCost: 0.25 }, catalog)).toMatchObject({ usd: 0.25, recorded: true, estimated: false, knownTokens: 1000000 });
    expect(quoteCost({ ...event, recordedCost: 0 }, catalog).usd).toBe(0);
    expect(quoteCost({ ...event, recordedCost: -1 }, catalog).estimated).toBe(true);
  });
  it('leaves unknown models, missing components, mismatched totals, and missing cache prices unpriced', () => {
    const catalog = normalizePricingData(raw);
    for (const item of [{ ...event, model: 'unknown' }, { ...event, outputTokens: undefined }, { ...event, tokens: 1 }, { ...event, pricingProvider: 'custom' }]) {
      expect(quoteCost(item, catalog)).toMatchObject({ knownTokens: 0, unpricedTokens: item.tokens, usd: 0 });
    }
    const noCache = normalizePricingData({ openai: { models: { model: { cost: { input: 2, output: 10 } } } } });
    expect(quoteCost(event, noCache).unpricedTokens).toBe(1000000);
    expect(quoteCost(event, { ...catalog, models: { 'openai/model': { input: 1e308, output: 10, cacheRead: 0.2, cacheWrite: 2.5 } } }).unpricedTokens).toBe(event.tokens);
    expect(quoteCost({ ...event, tokens: 400000, cacheReadTokens: 0, cacheWriteTokens: 0 }, noCache).knownTokens).toBe(400000);
  });
  it('does not use another provider’s price for the same model name', () => {
    expect(quoteCost({ ...event, pricingProvider: 'openai' }, normalizePricingData(raw)).estimated).toBe(true);
    expect(quoteCost({ ...event, pricingProvider: 'openrouter' }, normalizePricingData(raw)).unpricedTokens).toBe(event.tokens);
  });
  it('ships a nonempty dated offline price baseline', () => {
    expect(Object.keys(bundledPricing.models).length).toBeGreaterThan(100);
    expect(bundledPricing.models['openai/gpt-6.1-sol'].input).toBeGreaterThan(0);
    expect(bundledPricing.fetchedAt).toBeGreaterThan(0);
  });
});
describe('price refresh and offline cache', () => {
  it('fetches only the fixed public host, denies redirects, sends no credentials or usage, and bounds the request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(raw)));
    expect(Object.keys((await fetchPricing(fetcher)).models)).toEqual(['openai/model']);
    expect(fetcher).toHaveBeenCalledWith(PRICE_URL, expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal), headers: { Accept: 'application/json' } }));
    const options = fetcher.mock.calls[0][1]!; expect(options).not.toHaveProperty('body'); expect(options.headers).not.toHaveProperty('Authorization');
  });
  it('rejects HTTP errors, malformed JSON, empty catalogs, and oversized response bodies', async () => {
    for (const response of [new Response('', { status: 500 }), new Response('not json'), new Response('{}'), new Response(new Uint8Array(16 * 1024 * 1024 + 1))]) {
      await expect(fetchPricing(vi.fn<typeof fetch>().mockResolvedValue(response))).rejects.toThrow();
    }
  });
  it('atomically persists normalized public prices and falls back offline if cache is missing or corrupt', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'aup-prices-')); roots.push(home); const file = path.join(home, 'cache', 'prices.json');
    const catalog = normalizePricingData(raw); await savePricing(file, catalog);
    expect((await loadPricing(file)).models).toEqual(catalog.models);
    expect(JSON.parse(await readFile(file, 'utf8')).source).toBe(PRICE_URL);
    await writeFile(file, '{'); expect(await loadPricing(file)).toBe(bundledPricing);
    expect(await loadPricing(path.join(home, 'missing'))).toBe(bundledPricing);
  });
  it('does not accept an alternate pricing source or invalid cached rates', () => {
    const catalog = normalizePricingData(raw);
    expect(() => validateCatalog({ ...catalog, source: 'https://evil.example' })).toThrow();
    expect(() => validateCatalog({ ...catalog, models: { 'openai/model': { input: -1, output: 10 } } })).toThrow();
  });
});
