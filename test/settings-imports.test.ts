import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, symlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { defaultSettings, loadSettings, saveSettings, settingsSchema } from '../src/main/settings.js';
import { normalizeLimits, normalizeRecord, importRecords } from '../src/main/imports.js';
import { walk, jsonFile } from '../src/main/files.js';
const roots: string[] = [];
async function temp(): Promise<string> { const root = await mkdtemp(path.join(os.tmpdir(), 'aup-import-')); roots.push(root); return root; }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
describe('settings', () => {
  it('defaults to local-only collection and respects environment overrides', () => {
    const settings = defaultSettings({ CODEX_HOME: '/codex', CLAUDE_CONFIG_DIR: '/claude', PI_CODING_AGENT_DIR: '/pi' }, '/home/test');
    expect(settings.networkEnabled).toBe(false); expect(settings.paths.codex).toBe('/codex'); expect(settings.paths.claude).toBe('/claude'); expect(settings.paths.pi).toBe('/pi');
  });
  it('migrates existing settings to login startup without discarding saved paths or theme', async () => {
    const { startAtLogin: _, ...old } = { ...defaultSettings(), theme: 'light', threshold: 95 };
    const file = path.join(await temp(), 'settings.json'); await writeFile(file, JSON.stringify(old));
    const loaded = await loadSettings(file);
    expect(loaded.warning).toBeUndefined(); expect(loaded.settings).toEqual({ ...old, startAtLogin: true });
    expect(settingsSchema.parse({ ...old, startAtLogin: false }).startAtLogin).toBe(false);
  });
  it('validates numeric ranges, unknown fields, control characters and absolute paths', () => {
    const settings = defaultSettings();
    for (const input of [{ ...settings, threshold: 101 }, { ...settings, refreshSeconds: 1 }, { ...settings, networkEnabled: 'true' }, { ...settings, command: 'evil' }, { ...settings, importDir: '\x00' }, { ...settings, paths: { ...settings.paths, codex: '' } }]) expect(settingsSchema.safeParse(input).success).toBe(false);
    expect(settingsSchema.safeParse({ ...settings, importDir: '', codexBinary: 'C:\\Users\\Me\\codex.exe' }).success).toBe(true);
  });
  it('atomically persists and reloads settings, and distinguishes a corrupt file', async () => {
    const file = path.join(await temp(), 'nested', 'settings.json'); expect((await loadSettings(file)).warning).toBeUndefined();
    const settings = defaultSettings(); await saveSettings(file, settings); expect((await loadSettings(file)).settings).toEqual(settings); expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(settings);
    await writeFile(file, 'bad'); expect((await loadSettings(file)).warning).toContain('defaults');
  });
});
describe('Omarchy compatibility', () => {
  it('normalizes only display-safe fields and rejects unsafe IDs', () => {
    const record = normalizeRecord({ id: 'claude', name: 'Claude', accessToken: 'SECRET', todayTotalTokens: 42, modelUsage: { opus: { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 30, cacheCreationInputTokens: 40 } }, limits: [{ label: 'Weekly', percent: 0.42 }] }, Date.now())!;
    expect(record.usage.totalTokens).toBe(100); expect(record.usage.todayTokens).toBe(42); expect(record.limits[0].percent).toBe(0.42); expect(JSON.stringify(record)).not.toContain('SECRET');
    expect(normalizeRecord({ id: '../evil' }, Date.now())).toBeUndefined();
  });
  it('flags stale imports without hiding the last known quota', () => {
    const record = normalizeRecord({ id: 'codex', limitsFetchedAt: 100, limits: [{ label: 'Session', percent: 0.5 }] }, 100, 2000000)!;
    expect(record.stale).toBe(true); expect(record.limits).toHaveLength(1);
  });
  it('accepts estimated prepaid balances and clamps unsafe percentages', () => {
    expect(normalizeRecord({ id: 'fireworks', balance: { remaining: 12.3, estimated: true, currency: 'USD' } }, Date.now())?.balance).toEqual({ remaining: 12.3, estimated: true, currency: 'USD' });
    expect(normalizeLimits([{ percent: 5 }, { percent: -1 }, { percent: 'bad' }, { percent: NaN }]).map(row => row.percent)).toEqual([1]);
  });
  it('imports unknown providers and multiple accounts without duplicate top-level limits/tokens', async () => {
    const dir = await temp(); await writeFile(path.join(dir, 'custom.json'), JSON.stringify({ id: 'custom', name: 'Custom', todayTotalTokens: 100, limits: [{ percent: 0.8 }], accounts: [{ id: 'main', active: true, label: 'Main', limits: [{ percent: 0.8 }] }, { id: 'work', label: 'Work', limits: [{ percent: 0.2 }] }] }));
    await writeFile(path.join(dir, 'bad.json'), '{');
    const result = await importRecords(dir); expect(result.agents).toHaveLength(3); expect(result.agents[0].limits).toEqual([]); expect(result.agents[1].limits[0].percent).toBe(0.8); expect(result.agents[1].usage.todayTokens).toBe(0); expect(result.warnings).toHaveLength(1);
  });
  it('treats absent/disabled import directories as normal', async () => { expect((await importRecords('')).agents).toEqual([]); expect((await importRecords(path.join(await temp(), 'missing'))).warnings).toEqual([]); });
});
describe('bounded filesystem access', () => {
  it.skipIf(process.platform === 'win32')('does not follow symlinked trees or files', async () => {
    const dir = await temp(); const outside = await temp(); await writeFile(path.join(outside, 'secret.jsonl'), '{}\n');
    await symlink(outside, path.join(dir, 'linked')); await symlink(path.join(outside, 'secret.jsonl'), path.join(dir, 'secret.jsonl'));
    expect((await walk(dir, name => name.endsWith('.jsonl'))).files).toEqual([]);
  });
  it('reports traversal caps rather than presenting partial totals as complete', async () => {
    const dir = await temp(); await writeFile(path.join(dir, 'a.jsonl'), '{}\n'); await writeFile(path.join(dir, 'b.jsonl'), '{}\n');
    const listing = await walk(dir, () => true, 1); expect(listing.files).toHaveLength(1); expect(listing.warnings[0]).toContain('partial');
  });
  it('rejects oversized JSON files', async () => { const file = path.join(await temp(), 'big.json'); await writeFile(file, '{"big":1234}'); await expect(jsonFile(file, 4)).rejects.toThrow('bounded'); });
});
