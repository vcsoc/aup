import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, appendFile, rm, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { localDay, recentDays, summarize, parseSession, UsageScanner, type Event } from '../src/main/usage.js';
import { defaultSettings } from '../src/main/settings.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function temp(): Promise<string> { const root = await mkdtemp(path.join(os.tmpdir(), 'aup-test-')); roots.push(root); return root; }
async function fixture(rows: unknown[]): Promise<string> { const file = path.join(await temp(), 'session.jsonl'); await writeFile(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n'); return file; }
const time = '2026-10-14T12:00:00Z';
const claude = (usage: object, extra: object = {}) => ({ type: 'assistant', timestamp: time, requestId: 'req1', sessionId: 's1', message: { id: 'msg1', model: 'opus', usage }, ...extra });
const codex = (total = 100, input = 80, output = 20) => ({ type: 'event_msg', timestamp: time, payload: { type: 'token_count', info: { last_token_usage: { input_tokens: input, output_tokens: output, cached_input_tokens: 50, reasoning_output_tokens: 10 }, total_token_usage: { total_tokens: total } } } });
describe('session parsers', () => {
  it('replaces partial Claude streaming rows instead of double counting caches', async () => {
    const file = await fixture([claude({ input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 20 }), claude({ input_tokens: 10, output_tokens: 40, cache_read_input_tokens: 20, cache_creation_input_tokens: 30 })]);
    const events = await parseSession(file, 'claude'); expect(events).toHaveLength(1); expect(events[0].tokens).toBe(100);
    expect(JSON.stringify(events)).not.toContain('message');
  });
  it('counts human prompts but not tool result messages', async () => {
    const file = await fixture([
      { type: 'user', timestamp: time, uuid: 'u1', message: { content: [{ type: 'text', text: 'secret prompt' }] } },
      { type: 'user', timestamp: time, uuid: 'u2', message: { content: [{ type: 'tool_result', content: 'private result' }] } },
    ]);
    const events = await parseSession(file, 'claude'); expect(events).toHaveLength(1); expect(events[0].prompt).toBe(true); expect(JSON.stringify(events)).not.toContain('secret');
  });
  it('does not add Codex cached/reasoning tokens twice or repeat a cumulative counter', async () => {
    const file = await fixture([{ type: 'session_meta', payload: { id: 's1', model_provider: 'openai' } }, { type: 'turn_context', payload: { model: 'gpt' } }, codex(), codex(), codex(200)]);
    const events = await parseSession(file, 'codex'); expect(events).toHaveLength(2); expect(events.reduce((n, e) => n + e.tokens, 0)).toBe(200); expect(events[0].model).toBe('gpt');
  });
  it('does not attribute custom Codex backends to OpenAI', async () => {
    const file = await fixture([{ type: 'session_meta', payload: { model_provider: 'ollama' } }, codex()]);
    expect(await parseSession(file, 'codex')).toEqual([]);
  });
  it('accepts old Codex sessions without provider metadata', async () => { expect(await parseSession(await fixture([codex()]), 'codex')).toHaveLength(1); });
  it('uses Pi usage components once, with totalTokens as fallback', async () => {
    const file = await fixture([
      { type: 'message', id: '1', timestamp: time, message: { role: 'assistant', model: 'gpt', usage: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40, totalTokens: 100 } } },
      { type: 'message', id: '2', timestamp: time, message: { role: 'assistant', model: 'gpt', usage: { totalTokens: 25 } } },
    ]);
    expect((await parseSession(file, 'pi')).map(e => e.tokens)).toEqual([100, 25]);
  });
  it('ignores malformed rows and waits for a newline on a torn final write', async () => {
    const file = await fixture([claude({ input_tokens: 5 })]);
    await appendFile(file, 'not json\n' + JSON.stringify(claude({ input_tokens: 20 }, { requestId: 'req2' })));
    expect(await parseSession(file, 'claude')).toHaveLength(1);
    await appendFile(file, '\n'); expect(await parseSession(file, 'claude')).toHaveLength(2);
  });
});
describe('aggregation', () => {
  const event: Event = { id: '1', time, session: 's1', model: 'model', tokens: 100 };
  it('deduplicates copied messages using their fullest usage', () => {
    const usage = summarize([event, { ...event, tokens: 20 }], new Date(time)); expect(usage.totalTokens).toBe(100); expect(usage.sessions).toBe(1);
  });
  it('handles prototype-like model names without inheriting properties', () => {
    const usage = summarize([{ ...event, model: '__proto__' }, { ...event, id: '2', model: 'constructor' }]);
    expect(usage.models.__proto__).toBe(100); expect(usage.models.constructor).toBe(100);
  });
  it('counts only today in daily totals and uses calendar day buckets', () => {
    const yesterday = new Date(time); yesterday.setDate(yesterday.getDate() - 1);
    const usage = summarize([event, { ...event, id: '2', time: yesterday.toISOString() }, { ...event, id: 'p', tokens: 0, prompt: true }], new Date(time));
    expect(usage.todayTokens).toBe(100); expect(usage.totalTokens).toBe(200); expect(usage.prompts).toBe(1); expect(usage.days).toHaveLength(7);
  });
  it('ignores invalid timestamps', () => { expect(summarize([{ ...event, time: 'bad' }]).totalTokens).toBe(0); });
  it('has seven local date keys across month boundaries', () => {
    expect(recentDays(new Date(2026, 10, 2, 12))).toEqual(['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(localDay('invalid')).toBe('');
  });
});
describe('scanner cache', () => {
  it('reuses, invalidates, and evicts session data after append and deletion', async () => {
    const home = await temp(); const settings = defaultSettings({}, home); settings.importDir = '';
    const dir = path.join(settings.paths.claude, 'projects', 'project'); await mkdir(dir, { recursive: true }); const file = path.join(dir, 'session.jsonl');
    await writeFile(file, JSON.stringify(claude({ input_tokens: 10 })) + '\n');
    const scanner = new UsageScanner();
    expect((await scanner.scan(settings)).usage.claude?.totalTokens).toBe(10);
    expect((await scanner.scan(settings)).usage.claude?.totalTokens).toBe(10);
    await appendFile(file, JSON.stringify(claude({ input_tokens: 20 }, { requestId: 'req2' })) + '\n');
    expect((await scanner.scan(settings)).usage.claude?.totalTokens).toBe(30);
    await unlink(file); expect((await scanner.scan(settings)).usage.claude?.totalTokens).toBe(0);
    settings.localEnabled = false; expect((await scanner.scan(settings)).usage).toEqual({});
  });
  it('parses Grok finished-turn ledgers without doubling cached input', async () => {
    const home = await temp(); const settings = defaultSettings({}, home);
    const dir = path.join(settings.paths.grok, 'sessions', 'project', 'session'); await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'usage.json'), JSON.stringify({ turns: [{ endedAt: time, modelUsage: { grok: { inputTokens: 100, cachedReadTokens: 50, outputTokens: 10, cacheCreationTokens: 5 } } }] }));
    const result = await new UsageScanner().scan(settings, new Date(time)); expect(result.usage.grok?.todayTokens).toBe(115); expect(result.usage.grok?.prompts).toBe(1);
  });
});
