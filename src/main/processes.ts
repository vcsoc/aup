import si from 'systeminformation';
import { cpus } from 'node:os';
import type { ProviderId, Resources } from '../shared/types.js';
import { emptyResources } from '../shared/types.js';

export interface ProcessRow { pid: number; parentPid: number; name: string; command?: string; params?: string; cpu: number; memRss: number }
export function identifyProcess(row: ProcessRow): ProviderId | undefined {
  const name = row.name.toLowerCase().replace(/\.exe$/, '');
  if (['claude', 'codex', 'grok', 'kimi', 'pi'].includes(name)) return name as ProviderId;
  // Only known script basenames under a runtime; never match arbitrary words
  // in shell commands, prompts, editors, or this monitor's own command line.
  if (!/^(node|bun|python[\d.]*|uv)$/.test(name)) return undefined;
  const command = `${row.command || ''} ${row.params || ''}`.replace(/\\/g, '/');
  if (/\/@anthropic-ai\/claude-code\/(?:cli|index)\.[cm]?js(?:\s|$|["'])/.test(command)) return 'claude';
  if (/\/@openai\/codex\/bin\/codex\.js(?:\s|$|["'])/.test(command)) return 'codex';
  if (/\/(?:@earendil-works|@mariozechner)\/pi-coding-agent\/dist\/cli\.js(?:\s|$|["'])/.test(command)) return 'pi';
  if (/\/kimi(?:\/|_cli\/).*\.py(?:\s|$|["'])/.test(command)) return 'kimi';
  return undefined;
}
export function aggregateProcesses(rows: ProcessRow[], excluded = new Set<number>()): Partial<Record<ProviderId, Resources>> {
  const byPid = new Map(rows.map(row => [row.pid, row]));
  const owners = new Map<number, ProviderId | null>();
  const children = new Map<number, number[]>();
  for (const row of rows) children.set(row.parentPid, [...(children.get(row.parentPid) || []), row.pid]);
  const blocked = new Set(excluded); const queue = [...excluded];
  while (queue.length) for (const child of children.get(queue.pop()!) || []) {
    if (!blocked.has(child)) { blocked.add(child); queue.push(child); }
  }
  const owner = (pid: number): ProviderId | undefined => {
    if (owners.has(pid)) return owners.get(pid) || undefined;
    const trail: ProcessRow[] = []; const visited = new Set<number>();
    let row = byPid.get(pid); let found: ProviderId | undefined;
    while (row && !visited.has(row.pid)) {
      if (blocked.has(row.pid)) break;
      visited.add(row.pid); trail.push(row);
      if (owners.has(row.pid)) { found = owners.get(row.pid) || undefined; break; }
      found = identifyProcess(row); if (found) break;
      row = byPid.get(row.parentPid);
    }
    for (const item of trail) owners.set(item.pid, found || null);
    return found;
  };
  const result: Partial<Record<ProviderId, Resources>> = {};
  for (const row of rows) {
    const id = owner(row.pid); if (!id) continue;
    const bucket = result[id] ||= emptyResources();
    bucket.cpu += Math.max(0, Number.isFinite(row.cpu) ? row.cpu : 0);
    bucket.memory += Math.max(0, Number.isFinite(row.memRss) ? row.memRss * 1024 : 0);
    bucket.processes++;
  }
  return result;
}
export async function collectProcesses(excluded: Set<number>): Promise<Partial<Record<ProviderId, Resources>>> {
  const data = await si.processes();
  if (!data.list.length) throw new Error('Process metrics unavailable');
  // Linux/Windows SI percentages are machine-normalized. macOS ps reports
  // a per-core lifetime average; normalize its scale (not its sampling age).
  const rows = process.platform === 'darwin' ? data.list.map(row => ({ ...row, cpu: row.cpu / Math.max(1, cpus().length) })) : data.list;
  return aggregateProcesses(rows, excluded);
}
