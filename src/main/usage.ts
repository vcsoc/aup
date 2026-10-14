import path from 'node:path';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { emptyUsage, type ProviderId, type Settings, type Usage } from '../shared/types.js';
import { jsonLines, jsonFile, number, object, text, timestamp, walk, type Json } from './files.js';

export interface Event {
  id: string; time: string; model: string; tokens: number; session: string; prompt?: boolean;
  cacheReadTokens?: number; billingProvider?: ProviderId; source?: string;
}
// Compare stable request identities, never similar token counts or model names.
const requestKey = (provider: string, id: string) => `response:${provider}:${createHash('sha256').update(id).digest('hex')}`;
// IDs are hashed worker-side, not displayed: display-text truncation could
// merge distinct responses with a common prefix. JSONL input is already bounded.
const responseIdentity = (value: unknown): string => typeof value === 'string' ? value : '';
export function localDay(time: string | Date): string {
  const d = typeof time === 'string' ? new Date(time) : time;
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function recentDays(now: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(now); d.setDate(d.getDate() - 6 + i); return localDay(d); });
}
export function summarize(events: Event[], now = new Date()): Usage {
  const usage = emptyUsage(); usage.models = Object.create(null); usage.sources = Object.create(null);
  let todayCachedTokens: number | undefined = 0;
  const days = new Map(recentDays(now).map(date => [date, 0]));
  const sessions = new Set<string>();
  // IDs are globally stable where the CLI supplies them, so copied Claude
  // transcript messages cannot multiply the same request's usage.
  const unique = new Map<string, Event>();
  for (const event of events) {
    const previous = unique.get(event.id);
    if (!previous || event.tokens >= previous.tokens) unique.set(event.id, event);
  }
  for (const event of unique.values()) {
    const day = localDay(event.time);
    if (!day) continue;
    sessions.add(event.session);
    if (event.prompt) { if (day === localDay(now)) usage.prompts++; continue; }
    usage.totalTokens += event.tokens;
    if (day === localDay(now)) {
      usage.todayTokens += event.tokens;
      todayCachedTokens = todayCachedTokens !== undefined && event.cacheReadTokens !== undefined
        ? todayCachedTokens + Math.min(event.tokens, event.cacheReadTokens) : undefined;
      if (event.source) usage.sources![event.source] = (usage.sources![event.source] || 0) + event.tokens;
    }
    if (days.has(day)) days.set(day, days.get(day)! + event.tokens);
    usage.models[event.model] = (usage.models[event.model] || 0) + event.tokens;
  }
  usage.todayCachedTokens = todayCachedTokens;
  usage.sessions = sessions.size;
  usage.days = [...days].map(([date, tokens]) => ({ date, tokens }));
  return usage;
}

export async function parseSession(file: string, provider: ProviderId): Promise<Event[]> {
  const events = new Map<string, Event>();
  let model = 'unknown'; let nativeProvider = 'openai'; let cumulative = '';
  let session = file; let index = 0;
  let pendingPiPrompts: Event[] = [];
  for await (const row of jsonLines(file)) {
    index++;
    const message = object(row.message); const payload = object(row.payload);
    const time = timestamp(row.timestamp || message.timestamp);
    if (provider === 'codex') {
      if (row.type === 'session_meta') {
        nativeProvider = text(payload.model_provider) || 'openai';
        session = text(payload.id) || file;
      }
      if (row.type === 'turn_context') model = text(payload.model) || model;
      if (row.type === 'event_msg' && payload.type === 'user_message') {
        events.set(`prompt:${file}:${index}`, { id: `prompt:${file}:${index}`, session, time, model, tokens: 0, prompt: true });
      }
      if (row.type !== 'event_msg' || payload.type !== 'token_count') continue;
      const info = object(payload.info); const usage = object(info.last_token_usage);
      const total = JSON.stringify(info.total_token_usage || null);
      if (total !== 'null' && total === cumulative) continue;
      cumulative = total;
      // Input includes cached input; output includes reasoning. Never add
      // those subcategories again.
      const tokens = number(usage.input_tokens) + number(usage.output_tokens);
      if (tokens) {
        const responseId = responseIdentity(payload.response_id) || responseIdentity(info.response_id);
        const id = responseId ? requestKey('codex', responseId) : `codex:${session}:${total !== 'null' ? total : index}`;
        events.set(id, { id, session, time, model, tokens, source: 'Codex CLI',
          cacheReadTokens: typeof usage.cached_input_tokens === 'number' ? number(usage.cached_input_tokens) : undefined });
      }
    } else if (provider === 'claude') {
      if (row.type === 'user' && !message.isMeta && !row.isMeta) {
        const content = message.content;
        // Tool results aren't human prompts.
        if (typeof content === 'string' || (Array.isArray(content) && content.some(part => object(part).type === 'text'))) {
          const id = `prompt:${text(row.uuid) || `${file}:${index}`}`;
          events.set(id, { id, session: text(row.sessionId) || file, time, model, tokens: 0, prompt: true });
        }
      }
      if (row.type !== 'assistant') continue;
      const usage = object(message.usage);
      const tokens = number(usage.input_tokens) + number(usage.output_tokens) + number(usage.cache_read_input_tokens) + number(usage.cache_creation_input_tokens);
      if (!tokens) continue;
      const id = `claude:${text(row.requestId)}:${text(message.id) || text(row.uuid) || `${file}:${index}`}`;
      const event = { id, time, session: text(row.sessionId) || file, model: text(message.model) || 'unknown', tokens,
        cacheReadTokens: number(usage.cache_read_input_tokens), source: 'Claude Code' };
      // Streaming transcript rows replace earlier partial usage for a request.
      if (!events.has(id) || tokens >= events.get(id)!.tokens) events.set(id, event);
    } else if (provider === 'pi') {
      if (row.type !== 'message') continue;
      if (message.role === 'user') {
        const id = `pi-prompt:${text(row.id) ? `${text(row.id)}:${time}` : `${file}:${index}`}`;
        const prompt = { id, time, session: file, model, tokens: 0, prompt: true };
        events.set(id, prompt); pendingPiPrompts.push(prompt);
      }
      if (message.role !== 'assistant') continue;
      // The OAuth provider identifies the subscription. A GPT model name (or
      // the generic OpenAI API provider) does not establish Codex ownership.
      const billingProvider = message.provider === 'openai-codex' ? 'codex' : 'pi';
      const source = billingProvider === 'codex' ? 'Pi (OpenAI Codex)' : 'Pi (other providers)';
      for (const prompt of pendingPiPrompts) Object.assign(prompt, { billingProvider, source });
      pendingPiPrompts = [];
      const usage = object(message.usage);
      const components = number(usage.input) + number(usage.output) + number(usage.cacheRead) + number(usage.cacheWrite);
      const tokens = components || number(usage.totalTokens);
      if (!tokens) continue;
      const identity = responseIdentity(message.responseId) || (text(row.id) ? `${text(row.id)}:${time}` : `${file}:${index}`);
      const id = requestKey(billingProvider === 'codex' ? 'codex' : `pi:${text(message.provider)}`, identity);
      const event: Event = { id, time, session: file, model: text(message.model) || 'unknown', tokens, billingProvider, source,
        cacheReadTokens: components > 0 || typeof usage.cacheRead === 'number' ? number(usage.cacheRead) : undefined };
      if (!events.has(id) || tokens >= events.get(id)!.tokens) events.set(id, event);
    }
  }
  return provider === 'codex' && nativeProvider !== 'openai' ? [] : [...events.values()];
}

async function grokSession(file: string): Promise<Event[]> {
  const data = await jsonFile(file); const events: Event[] = [];
  for (const [index, turn] of (Array.isArray(data.turns) ? data.turns : []).entries()) {
    const row = object(turn); const time = timestamp(row.endedAt);
    events.push({ id: `${file}:prompt:${index}`, time, session: file, model: 'unknown', tokens: 0, prompt: true });
    for (const [model, raw] of Object.entries(object(row.modelUsage))) {
      const usage = object(raw);
      events.push({ id: `${file}:${index}:${model}`, time, session: file, model: text(model), tokens: number(usage.inputTokens) + number(usage.outputTokens) + number(usage.cacheCreationTokens), cacheReadTokens: number(usage.cachedReadTokens), source: 'Grok' });
    }
  }
  return events;
}

interface CachedFile { size: number; mtime: number; events: Event[] }
export class UsageScanner {
  private cache = new Map<string, CachedFile>();
  async scan(settings: Settings, now = new Date()): Promise<{ usage: Partial<Record<ProviderId, Usage>>; warnings: Partial<Record<ProviderId, string[]>>; piUsesCodex: boolean }> {
    const usage: Partial<Record<ProviderId, Usage>> = {}; const warnings: Partial<Record<ProviderId, string[]>> = {};
    const grouped: Partial<Record<ProviderId, Event[]>> = {};
    let piUsesCodex = false;
    const seen = new Set<string>();
    if (!settings.localEnabled) { this.cache.clear(); return { usage, warnings, piUsesCodex }; }
    for (const provider of ['claude', 'codex', 'pi', 'grok'] as const) {
      const root = path.join(settings.paths[provider], provider === 'claude' ? 'projects' : 'sessions');
      const listing = await walk(root, name => provider === 'grok' ? name === 'usage.json' : name.endsWith('.jsonl'));
      const events: Event[] = []; const problems = [...listing.warnings];
      for (const file of listing.files) {
        const key = `${provider}:${file}`; seen.add(key);
        try {
          const info = await stat(file); const cached = this.cache.get(key);
          if (cached && cached.size === info.size && cached.mtime === info.mtimeMs) events.push(...cached.events);
          else {
            const parsed = provider === 'grok' ? await grokSession(file) : await parseSession(file, provider);
            this.cache.set(key, { size: info.size, mtime: info.mtimeMs, events: parsed }); events.push(...parsed);
          }
        } catch { problems.push('A session was unreadable or exceeded scan limits; totals are partial.'); }
      }
      grouped[provider] ||= [];
      for (const event of events) {
        const target = event.billingProvider || provider;
        (grouped[target] ||= []).push(event);
        if (provider === 'pi' && target === 'codex' && !event.prompt) piUsesCodex = true;
      }
      warnings[provider] = [...new Set(problems)];
    }
    if (piUsesCodex) warnings.codex = [...new Set([...(warnings.codex || []), ...(warnings.pi || [])])];
    for (const provider of Object.keys(grouped) as ProviderId[]) usage[provider] = summarize(grouped[provider]!, now);
    for (const key of this.cache.keys()) if (!seen.has(key)) this.cache.delete(key);
    return { usage, warnings, piUsesCodex };
  }
}
