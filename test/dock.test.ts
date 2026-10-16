import { describe, expect, it, vi } from 'vitest';
import { configureDock } from '../src/main/dock.js';

describe('menu-bar-only macOS application', () => {
  it('hides the Dock icon when the tray is available', async () => {
    const dock = { hide: vi.fn(), show: vi.fn(async () => {}) };
    await configureDock(dock, true, 'darwin');
    expect(dock.hide).toHaveBeenCalledOnce(); expect(dock.show).not.toHaveBeenCalled();
  });
  it('awaits Dock restoration when tray creation fails', async () => {
    let finish!: () => void;
    const dock = { hide: vi.fn(), show: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) };
    let complete = false;
    const pending = configureDock(dock, false, 'darwin').then(() => { complete = true; });
    await Promise.resolve();
    expect(dock.show).toHaveBeenCalledOnce(); expect(dock.hide).not.toHaveBeenCalled(); expect(complete).toBe(false);
    finish(); await pending; expect(complete).toBe(true);
  });
  it.each(['win32', 'linux'] as const)('leaves %s taskbar behavior unchanged, with or without a tray', async platform => {
    const dock = { hide: vi.fn(), show: vi.fn(async () => {}) };
    await configureDock(dock, true, platform); await configureDock(dock, false, platform);
    expect(dock.hide).not.toHaveBeenCalled(); expect(dock.show).not.toHaveBeenCalled();
  });
  it('tolerates an unavailable Dock API', async () => {
    await expect(configureDock(undefined, true, 'darwin')).resolves.toBeUndefined();
    await expect(configureDock(undefined, false, 'darwin')).resolves.toBeUndefined();
  });
});
