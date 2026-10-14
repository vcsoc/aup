import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const home = await mkdtemp(path.join(os.tmpdir(), 'aup-smoke-'));
const args = [...(process.env.AUP_EXECUTABLE ? [] : ['.']), '--demo', '--smoke', `--user-data-dir=${home}`];
if (process.platform === 'linux' && process.env.CI) args.push('--no-sandbox');
let app;
try {
  app = await electron.launch({ args, executablePath: process.env.AUP_EXECUTABLE || undefined, timeout: 30000 });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByRole('heading', { name: 'Agent activity.' })).toBeVisible();
  await expect(page.getByText('DEMO MODE', { exact: true })).toBeVisible();
  await expect(page.locator('.agent-card')).toHaveCount(6);
  expect(await page.evaluate(() => ({ require: typeof window.require, process: typeof window.process, fs: typeof window.panel.readFile }))).toEqual({ require: 'undefined', process: 'undefined', fs: 'undefined' });
  const capabilities = await app.evaluate(({ BrowserWindow }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration };
  });
  expect(capabilities).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false });
  await page.getByRole('button', { name: 'Needs attention' }).click();
  await expect(page.locator('.agent-card')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Kimi Code' })).toBeVisible();
  await page.getByRole('button', { name: 'Running', exact: true }).click();
  await expect(page.locator('.agent-card')).toHaveCount(4);
  await page.getByRole('button', { name: /All agents/ }).click();
  await page.locator('details').first().locator('summary').click();
  await expect(page.getByText('Recorded tokens', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('select[name=theme]').selectOption('dark');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const actual = await page.evaluate(() => window.panel.settings());
  expect(actual.networkEnabled).toBe(false);
  expect(actual.theme).toBe('dark');
  // Simulate malicious imported display strings through the same snapshot API.
  await page.evaluate(async () => {
    const state = await window.panel.snapshot();
    state.agents[0].name = '<img src=x onerror="window.injected=true">';
    // Renderer consumes only host snapshots, not arbitrary page messages.
    window.postMessage(state, '*');
  });
  expect(await page.locator('img').count()).toBe(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await page.setViewportSize({ width: 760, height: 1020 });
  await page.locator('details').first().locator('summary').click();
  await mkdir('.test-results', { recursive: true });
  await page.screenshot({ path: '.test-results/panel-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('select[name=theme]').selectOption('light');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.screenshot({ path: '.test-results/panel-light.png', fullPage: true });
  await page.setViewportSize({ width: 420, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '.test-results/panel-narrow.png', fullPage: true });
  await page.keyboard.press('Control+,');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: /Refresh/ }).click();
  await expect(page.locator('.agent-card')).toHaveCount(6);
  expect(errors).toEqual([]);
  console.log('PASS: Electron launch, six agents, filters, details, settings, themes, narrow layout, keyboard shortcuts, refresh, sandbox and preload capability checks.');
  console.log('Screenshots: .test-results/panel-{dark,light,narrow}.png');
} finally {
  await app?.close();
  await rm(home, { recursive: true, force: true });
}
