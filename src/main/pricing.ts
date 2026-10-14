import { readFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { jsonFile, object } from './files.js';
import { emptyCost, unknownCost } from '../shared/stats.js';
import type { CostSummary } from '../shared/types.js';

export const PRICE_URL = 'https://models.dev/api.json';
export interface Rates { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
export interface ModelPrice extends Rates { tiers?: (Rates & { above: number })[] }
export interface PriceCatalog { fetchedAt: number; source: typeof PRICE_URL; models: Record<string, ModelPrice> }
export interface Priceable {
  tokens: number; model: string; pricingProvider?: string; recordedCost?: number;
  inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number;
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const rates = (raw: unknown): Rates => {
  const value = object(raw);
  return { input: finite(value.input) ? value.input : undefined, output: finite(value.output) ? value.output : undefined,
    cacheRead: finite(value.cache_read) ? value.cache_read : undefined, cacheWrite: finite(value.cache_write) ? value.cache_write : undefined };
};
export function normalizePricingData(raw: unknown, fetchedAt = Date.now()): PriceCatalog {
  const models: Record<string, ModelPrice> = Object.create(null);
  for (const [provider, value] of Object.entries(object(raw)).slice(0, 500)) {
    if (!/^[a-z0-9-]{1,100}$/.test(provider)) continue;
    for (const [model, entry] of Object.entries(object(object(value).models)).slice(0, 5000)) {
      if (!model || model.length > 300) continue;
      const cost = object(object(entry).cost), base = rates(cost);
      if (base.input === undefined || base.output === undefined) continue;
      const tiers = (Array.isArray(cost.tiers) ? cost.tiers : []).slice(0, 10).flatMap((rawTier: unknown) => {
        const tier = object(rawTier), context = object(tier.tier);
        return context.type === 'context' && finite(context.size) ? [{ ...rates(tier), above: context.size }] : [];
      });
      if (!tiers.length && Object.keys(object(cost.context_over_200k)).length) tiers.push({ ...rates(cost.context_over_200k), above: 200000 });
      models[`${provider}/${model}`] = { ...base, ...(tiers.length ? { tiers: tiers.sort((a, b) => a.above - b.above) } : {}) };
    }
  }
  if (!Object.keys(models).length) throw new Error('No usable model prices');
  return { fetchedAt, source: PRICE_URL, models };
}
export function validateCatalog(raw: unknown): PriceCatalog {
  const catalog = object(raw);
  if (!finite(catalog.fetchedAt) || catalog.fetchedAt > Date.now() + 300000 || catalog.source !== PRICE_URL) throw new Error('Invalid price catalog');
  const models: Record<string, ModelPrice> = Object.create(null);
  for (const [key, value] of Object.entries(object(catalog.models)).slice(0, 30000)) {
    const rate = object(value);
    if (!key.includes('/') || key.length > 401 || !finite(rate.input) || !finite(rate.output)) continue;
    const valid = (r: Record<string, unknown>): Rates => ({ input: finite(r.input) ? r.input : undefined, output: finite(r.output) ? r.output : undefined,
      cacheRead: finite(r.cacheRead) ? r.cacheRead : undefined, cacheWrite: finite(r.cacheWrite) ? r.cacheWrite : undefined });
    const tiers = (Array.isArray(rate.tiers) ? rate.tiers : []).slice(0, 10).flatMap(item => {
      const r = object(item); return finite(r.above) ? [{ ...valid(r), above: r.above }] : [];
    }).sort((a, b) => a.above - b.above);
    models[key] = { ...valid(rate), ...(tiers.length ? { tiers } : {}) };
  }
  if (!Object.keys(models).length) throw new Error('Empty price catalog');
  return { fetchedAt: catalog.fetchedAt, source: PRICE_URL, models };
}
export const bundledPricing: PriceCatalog = (() => {
  try { return validateCatalog(JSON.parse(readFileSync(new URL('../../assets/model-prices.json', import.meta.url), 'utf8'))); }
  catch { return { fetchedAt: 0, source: PRICE_URL, models: Object.create(null) }; }
})();
export async function loadPricing(file?: string): Promise<PriceCatalog> {
  if (file) { try { return validateCatalog(await jsonFile(file, 8 * 1024 * 1024)); } catch { /* Keep the bundled offline baseline. */ } }
  return bundledPricing;
}
export async function fetchPricing(fetcher: typeof fetch = fetch): Promise<PriceCatalog> {
  const response = await fetcher(PRICE_URL, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
  if (!response.ok || !response.body) throw new Error('Model prices unavailable');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 16 * 1024 * 1024) throw new Error('Model price response too large');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return normalizePricingData(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
export async function savePricing(file: string, catalog: PriceCatalog): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 }); const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(catalog) + '\n', { mode: 0o600 }); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
}
export function quoteCost(event: Priceable, catalog = bundledPricing): CostSummary {
  if (finite(event.recordedCost)) return { ...emptyCost(), usd: event.recordedCost, knownTokens: event.tokens, recorded: true };
  const aliases: Record<string, string> = { 'openai-codex': 'openai', grok: 'xai', kimi: 'moonshotai', fireworks: 'fireworks-ai', 'google-gemini-cli': 'google', 'google-antigravity': 'google' };
  const provider = aliases[event.pricingProvider || ''] || event.pricingProvider;
  let model = catalog.models[`${provider}/${event.model}`];
  if (!model) return unknownCost(event.tokens);
  const components = [event.inputTokens, event.outputTokens, event.cacheReadTokens, event.cacheWriteTokens];
  if (components.some(value => !finite(value))) return unknownCost(event.tokens);
  const [input, output, read, write] = components as number[];
  if (input + output + read + write !== event.tokens) return unknownCost(event.tokens);
  const context = input + read + write;
  for (const tier of model.tiers || []) if (context > tier.above) model = { ...tier };
  const prices = [model.input, model.output, model.cacheRead, model.cacheWrite];
  if (components.some((value, i) => value! > 0 && prices[i] === undefined)) return unknownCost(event.tokens);
  const usd = components.reduce((sum: number, value, i) => sum + value! * (prices[i] || 0) / 1e6, 0);
  if (!Number.isFinite(usd)) return unknownCost(event.tokens);
  return { ...emptyCost(), usd, knownTokens: event.tokens, estimated: true };
}
