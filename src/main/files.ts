import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

// JSON is untrusted even when it lives on disk. These boundary helpers never
// return objects to the renderer; collectors project only display-safe fields.
export type Json = Record<string, any>;
export const object = (value: unknown): Json => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
export const text = (value: unknown, max = 160): string => typeof value === 'string' ? value.replace(/[\x00-\x1f]/g, '').slice(0, max) : '';
export const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
export const ratio = (value: unknown): number => Math.min(1, number(value));
export const timestamp = (value: unknown): string => {
  const date = new Date(typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : String(value || ''));
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
};
export async function jsonFile(file: string, maxBytes = 4 * 1024 * 1024): Promise<Json> {
  const info = await stat(file);
  if (!info.isFile() || info.size > maxBytes) throw new Error('File is not a bounded JSON document');
  return object(JSON.parse(await readFile(file, 'utf8')));
}
export async function optionalJson(file: string): Promise<Json> {
  try { return await jsonFile(file); } catch { return {}; }
}
export interface FileListing { files: string[]; warnings: string[] }
export async function walk(root: string, accept: (name: string) => boolean, maxFiles = 20000): Promise<FileListing> {
  const result: FileListing = { files: [], warnings: [] };
  const dirs: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  let entriesSeen = 0;
  while (dirs.length) {
    const { dir, depth } = dirs.pop()!;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.warnings.push('A usage directory could not be read (permissions or I/O).');
      continue;
    }
    for (const entry of entries) {
      if (++entriesSeen > 100000 || result.files.length >= maxFiles) {
        result.warnings.push('Scan safety limit reached; totals are partial.'); return result;
      }
      // Do not follow symlinked directories or files, which can escape roots.
      if (entry.isDirectory() && depth < 12) dirs.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
      else if (entry.isFile() && accept(entry.name)) result.files.push(path.join(dir, entry.name));
    }
  }
  return result;
}
export async function* jsonLines(file: string): AsyncGenerator<Json> {
  const info = await stat(file);
  if (info.size > 128 * 1024 * 1024) throw new Error('Session exceeds 128 MiB scan limit');
  const stream = createReadStream(file, { encoding: 'utf8', highWaterMark: 64 * 1024 });
  let pending = '';
  try {
    for await (const chunk of stream) {
      pending += chunk;
      let end: number;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        if (line.length > 2 * 1024 * 1024) throw new Error('Session line exceeds 2 MiB scan limit');
        try { yield object(JSON.parse(line)); } catch { /* torn/invalid rows are isolated */ }
      }
      if (pending.length > 2 * 1024 * 1024) throw new Error('Session line exceeds 2 MiB scan limit');
    }
    // A final incomplete line may still be in the process of being written.
    // Revisit it once the next poll observes a newline/size change.
  } finally { stream.destroy(); }
}
