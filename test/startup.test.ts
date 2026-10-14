import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configureStartup, desktopEntry, type StartupOptions } from '../src/main/startup.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const options = (extra: Partial<StartupOptions> = {}): StartupOptions => ({ platform: 'darwin', enabled: true, packaged: true, isolated: false, executable: '/Applications/Agent Usage Panel.app/Contents/MacOS/Agent Usage Panel', home: '/unused', ...extra });
const native = (enabled = true) => ({ set: vi.fn(), get: vi.fn(() => ({ openAtLogin: enabled })) });

describe('OS login startup', () => {
  it('registers macOS native login items and verifies the OS result', async () => {
    const loginItems = native();
    expect(await configureStartup(options({ loginItems }))).toEqual({ supported: true });
    expect(loginItems.set).toHaveBeenCalledWith({ openAtLogin: true });
    expect(loginItems.get).toHaveBeenCalledWith({});
  });
  it('does not interpret Windows-only executable status as a macOS failure', async () => {
    const loginItems = { set: vi.fn(), get: () => ({ openAtLogin: true, executableWillLaunchAtLogin: false }) };
    expect(await configureStartup(options({ loginItems }))).toEqual({ supported: true });
  });
  it('registers the Windows installed executable and background flag with a stable name', async () => {
    const loginItems = native(); const executable = 'C:\\Program Files\\Agent Usage Panel\\Agent Usage Panel.exe';
    expect(await configureStartup(options({ platform: 'win32', executable, loginItems }))).toEqual({ supported: true });
    expect(loginItems.set).toHaveBeenCalledWith({ openAtLogin: true, enabled: true, path: executable, args: ['--startup'], name: 'Agent Usage Panel' });
    expect(loginItems.get).toHaveBeenCalledWith({ path: executable, args: ['--startup'] });
  });
  it('removes native login items when disabled', async () => {
    const loginItems = native(false);
    expect(await configureStartup(options({ enabled: false, loginItems }))).toEqual({ supported: true });
    expect(loginItems.set).toHaveBeenCalledWith({ openAtLogin: false });
  });
  it('never changes OS settings in demo/smoke or unpackaged development sessions', async () => {
    const loginItems = native();
    for (const extra of [{ isolated: true }, { packaged: false }, { platform: 'unsupported' }]) expect(await configureStartup(options({ ...extra, loginItems }))).toEqual({ supported: false });
    expect(loginItems.set).not.toHaveBeenCalled(); expect(loginItems.get).not.toHaveBeenCalled();
  });
  it('reports OS refusal and sanitized errors instead of silently claiming success', async () => {
    const refused = await configureStartup(options({ loginItems: native(false) }));
    expect(refused.warning).toContain('could not be enabled');
    const blocked = await configureStartup(options({ platform: 'win32', loginItems: { set: vi.fn(), get: () => ({ openAtLogin: true, executableWillLaunchAtLogin: false }) } }));
    expect(blocked.warning).toContain('could not be enabled');
    const failed = await configureStartup(options({ loginItems: { set: () => { throw Error('PRIVATE-OS-ERROR'); }, get: native().get } }));
    expect(failed.warning).not.toContain('PRIVATE'); expect(failed.warning).toContain('permissions');
  });
  it('quotes desktop Exec arguments and escapes field codes without shell commands', () => {
    const entry = desktopEntry('/opt/My App/Panel');
    expect(entry).toContain('Exec="/opt/My App/Panel" --startup\n');
    const special = desktopEntry('/opt/$HOME/`touch`/50%U/"panel"');
    expect(special).toContain('50%%U');
    expect(special).toContain('\\\\$HOME'); expect(special).toContain('\\\\`touch\\\\`'); expect(special).toContain('\\\\"panel\\\\"');
    expect(entry).not.toContain('sh -c'); expect(entry).toContain('Terminal=false');
    for (const invalid of ['relative', '/opt/new\nExec=evil', '/opt/\0evil']) expect(() => desktopEntry(invalid)).toThrow('Invalid');
  });
  it.skipIf(process.platform === 'win32')('writes one idempotent Linux autostart entry, uses a persistent AppImage path, and removes it on opt-out', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'aup-startup-')); roots.push(home);
    const configHome = path.join(home, 'custom-config'); const file = path.join(configHome, 'autostart', 'io.agentusage.panel.desktop');
    const input = options({ platform: 'linux', home, configHome, executable: '/tmp/.mount_ABC/agent-usage-panel', appImage: '/home/me/Apps/Agent Usage Panel.AppImage' });
    for (let i = 0; i < 2; i++) expect(await configureStartup(input)).toEqual({ supported: true });
    expect(await readFile(file, 'utf8')).toContain('Exec="/home/me/Apps/Agent Usage Panel.AppImage" --startup');
    expect(await readdir(path.dirname(file))).toEqual(['io.agentusage.panel.desktop']);
    expect(await configureStartup({ ...input, enabled: false })).toEqual({ supported: true });
    expect(await readdir(path.dirname(file))).toEqual([]);
  });
  it.skipIf(process.platform === 'win32')('uses ~/.config when XDG_CONFIG_HOME is relative, and surfaces write failures', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'aup-startup-')); roots.push(home);
    const input = options({ platform: 'linux', home, configHome: 'relative', executable: '/opt/panel' });
    expect(await configureStartup(input)).toEqual({ supported: true });
    expect(await readFile(path.join(home, '.config', 'autostart', 'io.agentusage.panel.desktop'), 'utf8')).toContain('/opt/panel');
    const blocked = path.join(home, 'not-a-directory'); await writeFile(blocked, 'blocked');
    expect((await configureStartup({ ...input, configHome: blocked })).warning).toContain('could not be enabled');
  });
});
