import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, Notification, type IpcMainInvokeEvent } from 'electron';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultSettings, loadSettings, saveSettings } from './settings.js';
import { demoSnapshot } from './demo.js';
import { configureStartup, type StartupResult } from './startup.js';
import { configureTrayMenu } from './tray-menu.js';
import { homedir } from 'node:os';
import { names, newAgent, providerIds, type Settings, type Snapshot } from '../shared/types.js';

const demo = process.argv.includes('--demo');
const smoke = process.argv.includes('--smoke');
const root = app.getAppPath();
const page = pathToFileURL(path.join(root, 'dist', 'renderer', 'index.html')).href;
let window: BrowserWindow | null = null; let tray: Tray | null = null; let worker: Worker | null = null;
let quitting = false; let settings = defaultSettings(); let settingsWarning = ''; let settingsFile = '';
let restarts = 0; let lastRefresh = 0; let lastPriceRefresh = 0;
let startup: StartupResult = { supported: false };
let launchedAtLogin = process.argv.includes('--startup');
async function applyStartup(): Promise<void> {
  startup = await configureStartup({
    platform: process.platform, enabled: settings.startAtLogin, packaged: app.isPackaged,
    isolated: demo || smoke, executable: process.execPath, home: homedir(),
    configHome: process.env.XDG_CONFIG_HOME, appImage: process.env.APPIMAGE,
    loginItems: { set: options => app.setLoginItemSettings(options), get: options => app.getLoginItemSettings(options) },
  });
}
const hostWarnings = () => [...(settingsWarning ? [settingsWarning] : []), ...(startup.warning ? [startup.warning] : [])];
let state: Snapshot = demo ? demoSnapshot() : { agents: providerIds.map(id => newAgent(id, names[id])), updatedAt: 0, resourceAt: 0, scanning: true, demo, errors: [], platform: process.platform };
const alerted = new Set<string>();

function icon(urgent = false): Electron.NativeImage {
  // Raw RGBA avoids SVG decoding differences between Windows/Linux/macOS.
  const scale = 2; const size = 22 * scale; const pixels = Buffer.alloc(size * size * 4);
  const color = urgent ? [235, 158, 79] : process.platform === 'darwin' ? [0, 0, 0] : [192, 211, 196];
  const rect = (x: number, y: number, w: number, h: number) => {
    for (let yy = y * scale; yy < (y + h) * scale; yy++) for (let xx = x * scale; xx < (x + w) * scale; xx++) {
      const i = (yy * size + xx) * 4; pixels[i] = color[0]; pixels[i + 1] = color[1]; pixels[i + 2] = color[2]; pixels[i + 3] = 255;
    }
  };
  rect(4, 6, 14, 12); rect(2, 10, 2, 5); rect(18, 10, 2, 5); rect(10, 3, 2, 3);
  // Transparent eye cutouts.
  for (const x of [7, 13]) for (let y = 10 * scale; y < 12 * scale; y++) for (let xx = x * scale; xx < (x + 2) * scale; xx++) pixels[(y * size + xx) * 4 + 3] = 0;
  const image = nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor: scale });
  if (process.platform === 'darwin' && !urgent) image.setTemplateImage(true);
  return image;
}
function show(anchor = false): void {
  if (!window) return;
  if (anchor && tray) {
    const trayBounds = tray.getBounds();
    const point = trayBounds.width ? { x: trayBounds.x, y: trayBounds.y } : screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(point).workArea;
    const [width, height] = window.getSize();
    const x = Math.max(area.x, Math.min(point.x - width / 2, area.x + area.width - width));
    const below = point.y + trayBounds.height;
    const y = Math.max(area.y, Math.min(below + height <= area.y + area.height ? below : point.y - height, area.y + area.height - height));
    window.setPosition(Math.round(x), Math.round(y));
  }
  if (window.isMinimized()) window.restore(); window.show(); window.focus();
}
function updateTray(): void {
  const live = state.agents.filter(agent => !agent.stale);
  const limits = live.flatMap(agent => agent.limits.filter(limit => !limit.resetsAt || Date.parse(limit.resetsAt) > Date.now()));
  const worst = Math.max(0, ...limits.map(limit => limit.percent));
  tray?.setImage(icon(worst * 100 >= settings.threshold));
  tray?.setToolTip(`Agent Usage Panel${limits.length ? ` · ${Math.round(worst * 100)}% highest quota used` : ''}`);
  if (process.platform === 'darwin') tray?.setTitle(limits.length ? `${Math.round(worst * 100)}%` : '');
  const active = new Set<string>();
  for (const agent of live) for (const limit of agent.limits) {
    if (limit.percent * 100 < settings.threshold || (limit.resetsAt && Date.parse(limit.resetsAt) <= Date.now())) continue;
    const key = `${agent.id}:${limit.label}:${limit.resetsAt}`; active.add(key);
    if (!demo && !alerted.has(key) && Notification.isSupported()) {
      new Notification({ title: `${agent.name} usage alert`, body: `${limit.label}: ${Math.round(limit.percent * 100)}% used`, silent: true }).show();
    }
    alerted.add(key);
  }
  for (const key of alerted) if (!active.has(key)) alerted.delete(key);
}
function publish(): void {
  const snapshot = { ...state, errors: [...state.errors, ...hostWarnings()] };
  window?.webContents.send('panel:update', snapshot); updateTray();
}
function startWorker(): void {
  worker = new Worker(new URL('./worker.js', import.meta.url), { workerData: { settings, pricingFile: path.join(app.getPath('userData'), 'model-prices.json') } });
  worker.on('message', (snapshot: Snapshot) => { state = snapshot; publish(); });
  worker.on('error', () => {
    state = { ...state, scanning: false, errors: ['The monitoring worker stopped. Restarting (up to three attempts); restart the app if this persists.'] }; publish();
  });
  worker.on('exit', () => {
    worker = null;
    if (!quitting && restarts++ < 3) setTimeout(startWorker, 1000);
  });
}
function trusted(event: IpcMainInvokeEvent): void {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== page) throw new Error('Untrusted IPC sender');
}
function handle(channel: string, action: (input?: unknown) => unknown): void {
  ipcMain.handle(channel, (event, input) => { trusted(event); return action(input); });
}
function createWindow(): void {
  window = new BrowserWindow({
    width: 420, height: 550, minWidth: 360, minHeight: 160, show: false,
    title: 'Agent Usage Panel', backgroundColor: '#141919',
    webPreferences: { preload: path.join(root, 'assets', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: !app.isPackaged },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  // Renderer has no network capability, even if a future UI change adds a URL.
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') && !details.url.startsWith('devtools:') }));
  window.on('close', event => { if (!quitting && !smoke) { event.preventDefault(); window?.hide(); } });
  window.once('ready-to-show', () => { if (!launchedAtLogin || !tray) show(); });
  void window.loadURL(page);
}

if (!app.requestSingleInstanceLock() && !smoke) app.quit();
else {
  app.on('second-instance', () => show());
  app.on('activate', () => show());
  app.on('before-quit', () => { quitting = true; void worker?.terminate(); tray?.destroy(); });
  app.on('window-all-closed', () => { if (smoke || quitting) app.quit(); });
  void app.whenReady().then(async () => {
    settingsFile = path.join(app.getPath('userData'), 'settings.json');
    if (!demo) {
      const loaded = await loadSettings(settingsFile); settings = loaded.settings; settingsWarning = loaded.warning || '';
    }
    await applyStartup();
    if (!demo && !smoke && process.platform === 'darwin') launchedAtLogin ||= app.getLoginItemSettings().wasOpenedAtLogin;
    handle('panel:snapshot', () => ({ ...state, errors: [...state.errors, ...hostWarnings()] }));
    handle('panel:settings', () => settings);
    handle('panel:info', () => ({ version: app.getVersion(), platform: process.platform, settingsPath: demo ? '(demo: settings are not written)' : settingsFile, startupSupported: startup.supported }));
    handle('panel:save-settings', async input => {
      settings = demo ? (await import('./settings.js')).settingsSchema.parse(input) : await saveSettings(settingsFile, input);
      await applyStartup();
      settingsWarning = ''; alerted.clear(); worker?.postMessage({ type: 'settings', settings }); publish(); return settings;
    });
    handle('panel:refresh', () => { if (Date.now() - lastRefresh >= 5000) { lastRefresh = Date.now(); worker?.postMessage({ type: 'refresh' }); } });
    handle('panel:refresh-prices', () => {
      if (demo) return;
      if (Date.now() - lastPriceRefresh < 60000) throw new Error('Wait one minute between model-price updates.');
      lastPriceRefresh = Date.now(); worker?.postMessage({ type: 'prices' });
    });
    handle('panel:fit-content', height => {
      if (typeof height !== 'number' || !Number.isFinite(height) || height < 1 || height > 20000) throw new Error('Invalid content height');
      if (!window || window.isMaximized() || window.isFullScreen()) return;
      const bounds = window.getBounds(), content = window.getContentBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      const target = Math.max(160, Math.min(Math.ceil(height), area.height - (bounds.height - content.height)));
      if (Math.abs(content.height - target) > 1) window.setContentSize(content.width, target);
      const updated = window.getBounds();
      if (updated.y + updated.height > area.y + area.height) window.setPosition(updated.x, Math.max(area.y, area.y + area.height - updated.height));
    });
    handle('panel:hide', () => window?.hide());
    handle('panel:quit', () => app.quit());
    createWindow();
    try {
      tray = new Tray(icon());
      configureTrayMenu(tray, Menu.buildFromTemplate([
        { label: 'Open Agent Usage Panel', click: () => show(true) },
        { label: 'Refresh usage', click: () => worker?.postMessage({ type: 'refresh' }) },
        { type: 'separator' }, { label: 'Quit', click: () => app.quit() },
      ]));
      tray.on('click', () => { if (window?.isVisible()) window.hide(); else show(true); });
      tray.on('double-click', () => show(true));
      updateTray();
    } catch { state.errors.push('System tray unavailable; use this window or the application launcher.'); }
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ label: 'Agent Usage Panel', submenu: [{ role: 'about' as const }, { type: 'separator' as const }, { role: 'quit' as const }] }] : []),
      { label: 'View', submenu: [{ label: 'Show panel', accelerator: 'CmdOrCtrl+Shift+U', click: () => show() }, { role: 'reload' }, { role: 'togglefullscreen' }] },
      { role: 'editMenu' },
      { label: 'App', submenu: [{ role: 'quit' }] },
    ]));
    if (!demo) startWorker();
  });
}
