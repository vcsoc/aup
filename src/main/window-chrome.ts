import type { BrowserWindowConstructorOptions } from 'electron';

/** Keep real AppKit traffic lights, overlaid inside the 36px application header. */
export function windowChrome(platform: NodeJS.Platform = process.platform): Pick<BrowserWindowConstructorOptions, 'titleBarStyle' | 'trafficLightPosition'> {
  return platform === 'darwin' ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 10, y: 11 } } : {};
}
