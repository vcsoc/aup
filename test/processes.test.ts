import { describe, expect, it } from 'vitest';
import { aggregateProcesses, identifyProcess, type ProcessRow } from '../src/main/processes.js';
const row = (pid: number, name: string, parentPid = 0, extra: Partial<ProcessRow> = {}): ProcessRow => ({ pid, name, parentPid, cpu: 2, memRss: 100, ...extra });
describe('cross-platform process attribution', () => {
  it.each(['claude', 'codex', 'grok', 'kimi', 'pi'])('recognizes %s and its Windows .exe form', name => { expect(identifyProcess(row(1, name))).toBe(name); expect(identifyProcess(row(1, `${name}.exe`))).toBe(name); });
  it('recognizes known npm CLI script paths on Unix and Windows', () => {
    expect(identifyProcess(row(1, 'node', 0, { params: '/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js' }))).toBe('claude');
    expect(identifyProcess(row(1, 'node.exe', 0, { params: '"C:\\Users\\Me\\node_modules\\@openai\\codex\\bin\\codex.js"' }))).toBe('codex');
    expect(identifyProcess(row(1, 'node', 0, { params: '/usr/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js' }))).toBe('pi');
  });
  it('does not mistake a shell, editor, or generic filename for an agent', () => {
    expect(identifyProcess(row(1, 'bash', 0, { params: 'echo claude codex' }))).toBeUndefined();
    expect(identifyProcess(row(2, 'node', 0, { params: '/tmp/codex.js' }))).toBeUndefined();
    expect(identifyProcess(row(3, 'code', 0, { params: 'claude-code' }))).toBeUndefined();
  });
  it('counts descendants once and assigns a nested agent to its nearest root', () => {
    const result = aggregateProcesses([row(4, 'python', 2), row(2, 'bash', 1), row(1, 'claude'), row(3, 'codex', 1), row(5, 'python', 3)]);
    expect(result.claude).toEqual({ cpu: 6, memory: 300 * 1024, processes: 3 });
    expect(result.codex?.processes).toBe(2);
  });
  it('excludes the monitoring probe and all descendants even if they look like agents', () => {
    const result = aggregateProcesses([row(1, 'electron'), row(2, 'codex', 1), row(3, 'python', 2), row(4, 'claude')], new Set([1]));
    expect(result.codex).toBeUndefined(); expect(result.claude?.processes).toBe(1);
  });
  it('does not loop on cyclic/vanished parents and clamps invalid samples', () => {
    const result = aggregateProcesses([row(1, 'bash', 2), row(2, 'python', 1), row(3, 'codex', 500, { cpu: NaN, memRss: -10 })]);
    expect(result.codex).toEqual({ cpu: 0, memory: 0, processes: 1 });
  });
});
