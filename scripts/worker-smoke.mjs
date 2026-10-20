import { Worker } from 'node:worker_threads';
import { mkdtemp, mkdir, writeFile, rm, open } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { defaultSettings } from '../dist/main/settings.js';
const home = await mkdtemp(path.join(os.tmpdir(), 'aup-worker-'));
let worker;
try {
  const settings = defaultSettings({}, home); settings.processEnabled = false; settings.importDir = path.join(home, 'imports');
  await mkdir(path.join(settings.paths.claude, 'projects', 'test'), { recursive: true });
  await writeFile(path.join(settings.paths.claude, 'projects', 'test', 's.jsonl'), JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), requestId: 'request', sessionId: 'session', message: { id: 'message', model: 'fixture-model', usage: { input_tokens: 10, output_tokens: 20 } } }) + '\n');
  for (const provider of ['codex', 'pi']) await mkdir(path.join(settings.paths[provider], 'sessions'), { recursive: true });
  const timestamp = new Date().toISOString();
  const pi = { type: 'message', id: 'entry', timestamp, message: { role: 'assistant', provider: 'openai-codex', responseId: 'private-response-id', usage: { input: 10, output: 20, cacheRead: 70, cost: { total: 0.25 } } } };
  const session = await open(path.join(settings.paths.pi, 'sessions', 'session.jsonl'), 'w');
  try {
    await session.write(JSON.stringify(pi) + '\n');
    const extra = { ...pi, id: 'latest-entry', message: { ...pi.message, responseId: 'latest-response-id' } };
    const tail = Buffer.from('\n' + JSON.stringify(extra) + '\n');
    // Simulate a long-running transcript with a large tool/image row and a
    // distinct usage record at its tail. The copy below must still deduplicate.
    await session.write(tail, 0, tail.length, 129 * 1024 * 1024);
  } finally { await session.close(); }
  await writeFile(path.join(settings.paths.pi, 'sessions', 'copied-session.jsonl'), JSON.stringify(pi) + '\n');
  await writeFile(path.join(settings.paths.codex, 'sessions', 'native.jsonl'), JSON.stringify({ type: 'event_msg', timestamp, payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 180, output_tokens: 20, cached_input_tokens: 150 }, total_token_usage: { total_tokens: 200 } } } }) + '\n');
  await mkdir(settings.importDir);
  await writeFile(path.join(settings.importDir, 'custom.json'), JSON.stringify({ id: 'custom', name: 'Fixture provider', todayTotalTokens: 42, limits: [{ label: 'Session', percent: 0.4 }] }));
  worker = new Worker(new URL('../dist/main/worker.js', import.meta.url), { workerData: { settings } });
  const next = async predicate => {
    const timeout = AbortSignal.timeout(20000);
    while (true) { const [state] = await once(worker, 'message', { signal: timeout }); if (predicate(state)) return state; }
  };
  const state = await next(state => state.updatedAt && !state.scanning);
  assert.equal(state.agents.find(agent => agent.id === 'claude').usage.todayTokens, 30);
  assert.equal(state.agents.find(agent => agent.id === 'custom').usage.todayTokens, 42);
  assert.equal(state.agents.find(agent => agent.id === 'codex').quotaStatus, 'Network quotas off');
  assert.equal(state.agents.find(agent => agent.id === 'codex').usage.todayTokens, 400);
  assert.equal(state.agents.find(agent => agent.id === 'codex').usage.todayCachedTokens, 290);
  assert.deepEqual(state.agents.find(agent => agent.id === 'codex').usage.sources, { 'Codex CLI': 200, 'Pi (OpenAI Codex)': 200 });
  assert.equal(state.agents.find(agent => agent.id === 'codex').usage.todayCost.usd, 0.5);
  assert.equal(state.agents.find(agent => agent.id === 'codex').usage.todayCost.knownTokens, 200);
  assert.equal(state.agents.find(agent => agent.id === 'codex').usage.history.length, 1);
  assert.match(state.agents.find(agent => agent.id === 'codex').warnings.join(' '), /oversized session row/);
  assert.ok(state.pricing.models > 100);
  assert.equal(state.agents.find(agent => agent.id === 'pi').usage.todayTokens, 0);
  assert.match(state.agents.find(agent => agent.id === 'pi').usageNote, /included in Codex/);
  assert.equal(JSON.stringify(state).includes('private-response-id'), false);
  assert.equal(JSON.stringify(state).includes('latest-response-id'), false);
  assert.equal(state.errors.length, 0);
  assert.equal(JSON.stringify(state).includes('requestId'), false);
  const changed = next(state => state.updatedAt && !state.scanning && state.agents.length === 6 && state.agents.every(agent => agent.usage.todayTokens === 0));
  worker.postMessage({ type: 'settings', settings: { ...settings, localEnabled: false, importDir: '' } });
  await changed;
  console.log('PASS: isolated Claude/Codex/Pi/import worker, >128 MiB active-session tail usage/costs, oversized-row recovery, subscription attribution, copied-request deduplication, cache breakdown, projected metadata, local-only quotas, and live settings reset.');
} finally { await worker?.terminate(); await rm(home, { recursive: true, force: true }); }
