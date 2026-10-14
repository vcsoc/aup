import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaultSettings } from '../dist/main/settings.js';
const home = await mkdtemp(path.join(os.tmpdir(), 'aup-login-'));
const profile = path.join(home, 'profile');
let app;
try {
  const { startAtLogin: _, ...oldSettings } = defaultSettings({}, home);
  Object.assign(oldSettings, { processEnabled: false, localEnabled: false, importDir: '' });
  await mkdir(profile); await writeFile(path.join(profile, 'settings.json'), JSON.stringify(oldSettings));
  const args = [...(process.env.AUP_EXECUTABLE ? [] : ['.']), '--smoke', '--startup', `--user-data-dir=${profile}`];
  if (process.platform === 'linux' && process.env.CI) args.push('--no-sandbox');
  app = await electron.launch({ args, executablePath: process.env.AUP_EXECUTABLE || undefined, timeout: 30000 });
  const page = await app.firstWindow();
  await page.waitForLoadState('load');
  await expect(page.getByRole('link', { name: 'Agent Usage Panel home' })).toHaveCount(1);
  const settings = await page.evaluate(() => window.panel.settings());
  expect(settings.startAtLogin).toBe(true);
  expect(settings.localEnabled).toBe(false);
  expect((await page.evaluate(() => window.panel.info())).startupSupported).toBe(false);
  const snapshot = await page.evaluate(() => window.panel.snapshot());
  const noTray = snapshot.errors.includes('System tray unavailable; use this window or the application launcher.');
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(noTray);
  if (!noTray) {
    // Inspect the real native item on its next normal update, not a mock Tray.
    await app.evaluate(({ Tray }) => {
      const setImage = Tray.prototype.setImage;
      Tray.prototype.setImage = function(image) {
        globalThis.__nativeTray = this;
        globalThis.__trayCheck = { empty: image.isEmpty(), template: image.isTemplateImage(), pixels: image.toBitmap().some((value, i) => i % 4 === 3 && value > 0), bounds: this.getBounds(), title: this.getTitle(), destroyed: this.isDestroyed() };
        return setImage.call(this, image);
      };
    });
    await page.evaluate(settings => window.panel.saveSettings(settings), settings);
    const nativeTray = await app.evaluate(() => globalThis.__trayCheck);
    expect(nativeTray.empty).toBe(false); expect(nativeTray.pixels).toBe(true); expect(nativeTray.destroyed).toBe(false);
    if (process.platform === 'darwin') {
      expect(nativeTray.template).toBe(true); expect(nativeTray.title).toBe('');
      expect(nativeTray.bounds.width).toBeGreaterThan(0); expect(nativeTray.bounds.height).toBeGreaterThan(0);
      const clicks = await app.evaluate(({ BrowserWindow }) => {
        const tray = globalThis.__nativeTray, window = BrowserWindow.getAllWindows()[0];
        const popup = tray.popUpContextMenu; let menus = 0; let actions = [];
        tray.popUpContextMenu = menu => { menus++; actions = menu.items.filter(item => item.type !== 'separator').map(item => item.label); };
        const visible = [], menuCounts = [];
        try {
          window.hide();
          for (const event of ['click', 'click', 'right-click', 'click']) {
            tray.emit(event, {}, tray.getBounds()); visible.push(window.isVisible()); menuCounts.push(menus);
          }
          return { visible, menuCounts, actions };
        } finally { tray.popUpContextMenu = popup; window.hide(); }
      });
      expect(clicks.visible).toEqual([true, false, false, true]);
      expect(clicks.menuCounts).toEqual([0, 0, 1, 1]);
      expect(clicks.actions).toEqual(['Open Agent Usage Panel', 'Refresh usage', 'Quit']);
    }
  }
  // Reopening the app still reveals a hidden login-started panel.
  await app.evaluate(({ app }) => app.emit('activate'));
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('input[name=startAtLogin]')).toBeChecked();
  await expect(page.locator('input[name=startAtLogin]')).toBeDisabled();
  console.log('PASS: native nonempty menu-bar icon, macOS left-click window-only/right-click menu dispatch, background login launch, tray fallback, reopen, settings migration, and smoke isolation from OS startup registration.');
} finally { await app?.close(); await rm(home, { recursive: true, force: true }); }
