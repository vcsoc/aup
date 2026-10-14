import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { codexCommand, codexLimits, probePids } from '../src/main/rpc.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function executable(source: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aup-rpc-')); roots.push(dir);
  const file = path.join(dir, 'fake codex.mjs'); await writeFile(file, '#!/usr/bin/env node\n' + source); await chmod(file, 0o700); return file;
}
describe('Codex subprocess boundary', () => {
  it('reports a missing explicitly selected executable', async () => { await expect(codexCommand(path.join(os.tmpdir(), 'nonexistent-aup-codex-bin'))).rejects.toThrow('not found'); });
  it.skipIf(process.platform === 'win32')('handles fragmented/coalesced RPC frames, spaces in executable paths, and probe cleanup', async () => {
    const file = await executable(`
import readline from 'node:readline';
if (process.argv.slice(2).join(' ') !== '-s read-only -a on-request app-server') process.exit(2);
readline.createInterface({ input: process.stdin }).on('line', line => {
  const row = JSON.parse(line);
  if (row.id === 1) process.stdout.write('invalid\\n' + JSON.stringify({ method: 'notice' }) + '\\n' + JSON.stringify({ id: 1, result: {} }) + '\\n');
  if (row.id === 2) {
    const result = JSON.stringify({ id: 2, result: { rateLimits: { planType: 'plus', primary: { usedPercent: 42 } } } }) + '\\n';
    process.stdout.write(result.slice(0, 20)); setTimeout(() => process.stdout.write(result.slice(20)), 5);
  }
});
setInterval(() => {}, 1000);
`);
    const result = await codexLimits(os.tmpdir(), file); expect(result.rateLimits.primary.usedPercent).toBe(42);
    await expect.poll(() => probePids.size).toBe(0);
  });
  it.skipIf(process.platform === 'win32')('does not expose subprocess stderr when a provider exits', async () => {
    const file = await executable("process.stderr.write('secret-credential'); process.exit(1);");
    await expect(codexLimits(os.tmpdir(), file)).rejects.toThrow('exited before');
    await expect.poll(() => probePids.size).toBe(0);
  });
});
