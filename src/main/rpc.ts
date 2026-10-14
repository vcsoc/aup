import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { object, type Json } from './files.js';

export const probePids = new Set<number>();
async function exists(file: string): Promise<boolean> { try { await access(file); return true; } catch { return false; } }
export async function codexCommand(explicit: string, env = process.env): Promise<{ file: string; prefix: string[] }> {
  const candidates = explicit ? [explicit] : (env.PATH || '').split(path.delimiter).flatMap(dir => [path.join(dir, process.platform === 'win32' ? 'codex.exe' : 'codex'), ...(process.platform === 'win32' ? [path.join(dir, 'codex.cmd')] : [])]);
  for (const file of candidates) {
    if (!(await exists(file))) continue;
    if (/\.cmd$/i.test(file)) {
      // Execute npm's JS entrypoint directly, never invoke a shell with a
      // user-controlled path. Electron's own executable supplies Node.
      const script = path.join(path.dirname(file), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if (await exists(script)) return { file: process.execPath, prefix: [script] };
      continue;
    }
    return { file, prefix: [] };
  }
  throw new Error('Codex CLI not found. Set its executable path in Settings.');
}
function stop(child: ChildProcessWithoutNullStreams): void {
  if (!child.pid) return;
  const pid = child.pid;
  if (process.platform === 'win32') {
    execFile('taskkill.exe', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => { probePids.delete(pid); });
  } else {
    try { process.kill(-pid, 'SIGTERM'); } catch { child.kill(); }
    const timer = setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch { /* already stopped */ } probePids.delete(pid); }, 500);
    timer.unref();
  }
}
export async function codexLimits(home: string, explicit: string): Promise<Json> {
  const command = await codexCommand(explicit);
  const child = spawn(command.file, [...command.prefix, '-s', 'read-only', '-a', 'on-request', 'app-server'], {
    env: { ...process.env, CODEX_HOME: home, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32',
  });
  if (child.pid) probePids.add(child.pid);
  return new Promise<Json>((resolve, reject) => {
    let pending = ''; let finished = false;
    const end = (error?: Error, result?: Json) => {
      if (finished) return; finished = true; clearTimeout(timer); stop(child);
      error ? reject(error) : resolve(result || {});
    };
    const send = (value: Json) => child.stdin.write(JSON.stringify(value) + '\n');
    const timer = setTimeout(() => end(new Error('Codex app-server timed out')), 20000);
    child.on('error', () => end(new Error('Codex CLI could not start')));
    child.on('exit', () => end(new Error('Codex app-server exited before reporting limits')));
    child.stdin.on('error', () => end(new Error('Codex RPC connection closed')));
    child.stderr.resume(); // Never retain provider logs (which may include secrets).
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      pending += chunk;
      if (pending.length > 1024 * 1024) return end(new Error('Codex RPC response exceeded safety limit'));
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        let message: Json;
        try { message = object(JSON.parse(line)); } catch { continue; }
        if (message.id === 1) {
          if (message.error) return end(new Error('Codex initialization failed'));
          send({ method: 'initialized', params: {} });
          send({ id: 2, method: 'account/rateLimits/read', params: {} });
        } else if (message.id === 2) {
          if (message.error) return end(new Error('Codex limits unavailable. Run codex login or start Codex to renew its sign-in.'));
          return end(undefined, object(message.result));
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'agent-usage-panel', version: '0.1.0' } } });
  });
}
