import { describe, expect, it, vi } from 'vitest';
import { configureTrayMenu } from '../src/main/tray-menu.js';

describe('tray context-menu activation', () => {
  it('never attaches an automatic macOS click menu; only explicit right-click opens it', () => {
    const listeners = new Map<string, () => void>(); const menu = { label: 'Panel actions' };
    const tray = { setContextMenu: vi.fn(), popUpContextMenu: vi.fn(), on: vi.fn((event: string, handler: () => void) => listeners.set(event, handler)) };
    configureTrayMenu(tray, menu, 'darwin');
    expect(tray.setContextMenu).not.toHaveBeenCalled();
    expect(tray.popUpContextMenu).not.toHaveBeenCalled();
    expect([...listeners.keys()]).toEqual(['right-click']);
    listeners.get('right-click')!();
    expect(tray.popUpContextMenu).toHaveBeenCalledExactlyOnceWith(menu);
  });
  it.each(['linux', 'win32'] as const)('preserves native context-menu attachment on %s', platform => {
    const menu = {}; const tray = { setContextMenu: vi.fn(), popUpContextMenu: vi.fn(), on: vi.fn() };
    configureTrayMenu(tray, menu, platform);
    expect(tray.setContextMenu).toHaveBeenCalledExactlyOnceWith(menu);
    expect(tray.on).not.toHaveBeenCalled(); expect(tray.popUpContextMenu).not.toHaveBeenCalled();
  });
});
