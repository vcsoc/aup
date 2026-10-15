import { describe, expect, it } from 'vitest';
import { windowChrome } from '../src/main/window-chrome.js';

describe('native window controls', () => {
  it('removes the macOS title strip, positioning real traffic lights in the app header', () => {
    expect(windowChrome('darwin')).toEqual({ titleBarStyle: 'hidden', trafficLightPosition: { x: 10, y: 11 } });
    expect(windowChrome('darwin')).not.toHaveProperty('frame', false);
  });
  it.each(['win32', 'linux'] as const)('preserves the native frame and controls on %s', platform => {
    expect(windowChrome(platform)).toEqual({});
  });
});
