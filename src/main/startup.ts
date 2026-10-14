import path from 'node:path';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

interface NativeOptions { openAtLogin: boolean; path?: string; args?: string[]; enabled?: boolean; name?: string }
export interface StartupOptions {
  platform: string; enabled: boolean; packaged: boolean; isolated: boolean;
  executable: string; home: string; configHome?: string; appImage?: string;
  loginItems?: {
    set(options: NativeOptions): void;
    get(options?: { path?: string; args?: string[] }): { openAtLogin: boolean; executableWillLaunchAtLogin?: boolean };
  };
}
export interface StartupResult { supported: boolean; warning?: string }

export function desktopEntry(executable: string): string {
  if (!path.posix.isAbsolute(executable) || /[\x00-\x1f\x7f]/.test(executable)) throw new Error('Invalid startup executable');
  // Exec quoting and desktop-entry string unescaping are separate passes.
  // Percent signs must not become desktop field codes (e.g. %U).
  const quoted = `"${executable.replace(/[\\"`$]/g, '\\$&').replace(/%/g, '%%')}" --startup`;
  return `[Desktop Entry]\nType=Application\nName=Agent Usage Panel\nComment=Monitor AI agent usage in the system tray\nExec=${quoted.replace(/\\/g, '\\\\')}\nTerminal=false\nStartupNotify=false\nX-GNOME-Autostart-enabled=true\n`;
}

/** Never register Electron development paths or let isolated tests change OS settings. */
export async function configureStartup(options: StartupOptions): Promise<StartupResult> {
  const supported = options.packaged && !options.isolated && ['darwin', 'win32', 'linux'].includes(options.platform);
  if (!supported) return { supported: false };
  try {
    if (options.platform === 'linux') {
      const config = options.configHome && path.posix.isAbsolute(options.configHome) ? options.configHome : path.join(options.home, '.config');
      const dir = path.join(config, 'autostart'); const file = path.join(dir, 'io.agentusage.panel.desktop');
      if (!options.enabled) { await rm(file, { force: true }); return { supported }; }
      // AppImage's mounted executable disappears on exit; register the image.
      const entry = desktopEntry(options.appImage || options.executable);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const temp = `${file}.${randomUUID()}.tmp`;
      try { await writeFile(temp, entry, { mode: 0o600 }); await rename(temp, file); }
      finally { await rm(temp, { force: true }); }
    } else {
      if (!options.loginItems) throw new Error('Login item service unavailable');
      const target = options.platform === 'win32' ? { path: options.executable, args: ['--startup'] } : {};
      options.loginItems.set({ openAtLogin: options.enabled, ...target,
        ...(options.platform === 'win32' ? { enabled: options.enabled, name: 'Agent Usage Panel' } : {}) });
      const actual = options.loginItems.get(target);
      if (actual.openAtLogin !== options.enabled || (options.platform === 'win32' && options.enabled && actual.executableWillLaunchAtLogin === false)) throw new Error('OS did not enable login item');
    }
    return { supported };
  } catch {
    return { supported, warning: `Launch at login could not be ${options.enabled ? 'enabled' : 'disabled'}. Check your OS login/startup-app settings and permissions.` };
  }
}
