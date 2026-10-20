import { afterEach, describe, expect, it } from 'vitest';
import { appendFile, mkdtemp, open, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { jsonLines } from '../src/main/files.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function file(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aup-jsonl-')); roots.push(root); return path.join(root, 'session.jsonl');
}
const collect = async (name: string, warnings: string[] = []) => {
  const rows = []; for await (const row of jsonLines(name, warning => warnings.push(warning))) rows.push(row); return rows;
};

describe('bounded-memory JSONL streaming', () => {
  it('streams files beyond 128 MiB without rejecting their usage or inventing a warning', async () => {
    const name = await file(); const handle = await open(name, 'w');
    const block = Buffer.from((' '.repeat(65535) + '\n').repeat(16));
    try {
      await handle.write('{"id":"first"}\n');
      for (let i = 0; i < 129; i++) await handle.write(block);
      await handle.write('{"id":"last"}\n');
    } finally { await handle.close(); }
    expect((await stat(name)).size).toBeGreaterThan(128 * 1024 * 1024);
    const warnings: string[] = [];
    expect(await collect(name, warnings)).toEqual([{ id: 'first' }, { id: 'last' }]); expect(warnings).toEqual([]);
  }, 15000);
  it('discards only oversized rows across chunks and resumes after each newline', async () => {
    const name = await file(), warnings: string[] = [];
    const oversized = JSON.stringify({ body: 'PRIVATE-BODY'.repeat(200000) });
    await writeFile(name, `{"id":1}\n${oversized}\n{"id":2}\n${oversized}\n{"id":3}\n`);
    expect(await collect(name, warnings)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(warnings).toHaveLength(1); expect(warnings[0]).toContain('oversized session row');
    expect(warnings[0]).not.toContain('PRIVATE-BODY');
  });
  it('handles CRLF and UTF-8 characters split across stream chunks', async () => {
    const name = await file(), warnings: string[] = [];
    const value = 'a'.repeat(65525) + '🌱漢字'.repeat(20000);
    await writeFile(name, JSON.stringify({ value }) + '\r\n\r\n{"next":true}\r\n');
    expect(await collect(name, warnings)).toEqual([{ value }, { next: true }]); expect(warnings).toEqual([]);
  });
  it('enforces the row limit in bytes rather than JavaScript character count', async () => {
    const name = await file(), warnings: string[] = [];
    const row = JSON.stringify({ body: '🌱'.repeat(600000) });
    expect(row.length).toBeLessThan(2 * 1024 * 1024); expect(Buffer.byteLength(row)).toBeGreaterThan(2 * 1024 * 1024);
    await writeFile(name, row + '\n{"safe":true}\n');
    expect(await collect(name, warnings)).toEqual([{ safe: true }]); expect(warnings).toHaveLength(1);
  });
  it('reports malformed rows once and preserves valid rows on either side', async () => {
    const name = await file(), warnings: string[] = [];
    await writeFile(name, '{"first":1}\nbroken\n\n \r\n{"second":2}\nmore broken\n');
    expect(await collect(name, warnings)).toEqual([{ first: 1 }, { second: 2 }]);
    expect(warnings).toHaveLength(1); expect(warnings[0]).toContain('invalid session row');
  });
  it('waits for the newline on an unfinished row, including oversized rows', async () => {
    const name = await file(), warnings: string[] = [];
    await writeFile(name, '{"first":1}\n{"second":2}');
    expect(await collect(name)).toEqual([{ first: 1 }]);
    await appendFile(name, '\n' + 'x'.repeat(3 * 1024 * 1024));
    expect(await collect(name, warnings)).toEqual([{ first: 1 }, { second: 2 }]);
    await appendFile(name, '\n{"third":3}\n');
    expect(await collect(name)).toEqual([{ first: 1 }, { second: 2 }, { third: 3 }]); expect(warnings).toHaveLength(1);
  });
  it('takes a finite file snapshot and leaves concurrent appends for the next read', async () => {
    const name = await file(); await writeFile(name, '{"first":1}\n');
    const reader = jsonLines(name);
    expect((await reader.next()).value).toEqual({ first: 1 });
    await appendFile(name, '{"second":2}\n');
    expect((await reader.next()).done).toBe(true);
    expect(await collect(name)).toEqual([{ first: 1 }, { second: 2 }]);
  });
  it('handles empty files and refuses directories', async () => {
    const name = await file(); await writeFile(name, ''); expect(await collect(name)).toEqual([]);
    await expect(collect(path.dirname(name))).rejects.toThrow('regular file');
  });
});
