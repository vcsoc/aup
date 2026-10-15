import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
if (process.platform !== 'darwin') { console.log('SKIP: macOS integrated native window controls (other platforms retain their frame).'); process.exit(0); }
const home = await mkdtemp(path.join(os.tmpdir(), 'aup-window-'));
let app;
try {
  // No --smoke: exercise the actual close-to-tray policy. Demo still prevents
  // monitoring, credential access, settings writes, and login registration.
  app = await electron.launch({ args: [...(process.env.AUP_EXECUTABLE ? [] : ['.']), '--demo', `--user-data-dir=${home}`], executablePath: process.env.AUP_EXECUTABLE || undefined, timeout: 30000 });
  const page = await app.firstWindow();
  await expect(page.getByRole('link', { name: 'Agent Usage Panel home' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('select[name=theme]').selectOption('dark');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => page.evaluate(() => Math.abs(innerHeight - document.querySelector('#app').getBoundingClientRect().height))).toBeLessThanOrEqual(2);
  const native = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return { bounds: window.getBounds(), content: window.getContentBounds(), buttons: window.getWindowButtonPosition(), closable: window.isClosable(), minimizable: window.isMinimizable(), maximizable: window.isMaximizable(), fullscreenable: window.isFullScreenable() };
  });
  expect(native.bounds).toEqual(native.content); expect(native.buttons).toEqual({ x: 10, y: 11 });
  expect(native.closable && native.minimizable && native.maximizable && native.fullscreenable).toBe(true);
  const header = await page.locator('.topbar').evaluate(el => ({ height: el.getBoundingClientRect().height, drag: getComputedStyle(el).getPropertyValue('-webkit-app-region'), brandLeft: el.querySelector('.brand').getBoundingClientRect().left, brandDrag: getComputedStyle(el.querySelector('.brand')).getPropertyValue('-webkit-app-region'), actionsDrag: getComputedStyle(el.querySelector('.header-actions')).getPropertyValue('-webkit-app-region') }));
  expect(header.height).toBe(36); expect(header.brandLeft).toBeGreaterThanOrEqual(80);
  expect(header.drag).toBe('drag'); expect(header.brandDrag).toBe('no-drag'); expect(header.actionsDrag).toBe('no-drag');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);
  await app.evaluate(({ app }) => app.emit('activate'));
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(false);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  expect(await page.locator('dialog').evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(36);
  await page.getByRole('button', { name: 'Close settings' }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  expect(await app.evaluate(({ BrowserWindow }) => ({ count: BrowserWindow.getAllWindows().length, visible: BrowserWindow.getAllWindows()[0].isVisible() }))).toEqual({ count: 1, visible: false });
  await app.evaluate(({ app }) => app.emit('activate'));
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
  // Webview screenshots omit AppKit overlays. Capture only this app's native
  // window when screen access is already granted; never request new permission.
  const capture = await app.evaluate(({ BrowserWindow, systemPreferences }) => ({ allowed: systemPreferences.getMediaAccessStatus('screen') === 'granted', id: BrowserWindow.getAllWindows()[0].getMediaSourceId() }));
  if (capture.allowed && /^window:\d+:/.test(capture.id)) {
    await app.evaluate(({ app, BrowserWindow }) => { app.focus({ steal: true }); BrowserWindow.getAllWindows()[0].focus(); });
    await page.waitForTimeout(1000); // Let AppKit's reopen animation settle before native capture.
    await mkdir('.test-results', { recursive: true });
    try {
      execFileSync('/usr/sbin/screencapture', ['-x', '-o', '-l', capture.id.split(':')[1], '.test-results/window-native.png']);
      await page.getByRole('tab', { name: 'Stats', exact: true }).click();
      await expect.poll(() => page.evaluate(() => Math.abs(innerHeight - document.querySelector('#app').getBoundingClientRect().height))).toBeLessThanOrEqual(2);
      await page.waitForTimeout(1000);
      execFileSync('/usr/sbin/screencapture', ['-x', '-o', '-l', capture.id.split(':')[1], '.test-results/stats-native.png']);
    }
    catch { console.log('Native window screenshot unavailable; geometry/control checks passed.'); }
  }
  console.log('PASS: native traffic lights in the 36px header, no OS title strip, draggable header/clickable actions, unobstructed settings, minimize/restore and production close-to-tray/reopen.');
} finally { await app?.close(); await rm(home, { recursive: true, force: true }); }
