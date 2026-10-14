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
  // Reopening the app still reveals a hidden login-started panel.
  await app.evaluate(({ app }) => app.emit('activate'));
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('input[name=startAtLogin]')).toBeChecked();
  await expect(page.locator('input[name=startAtLogin]')).toBeDisabled();
  console.log('PASS: background login launch, tray fallback, reopen, settings migration, and smoke isolation from OS startup registration.');
} finally { await app?.close(); await rm(home, { recursive: true, force: true }); }
