import { readQuickAskPage } from './quickask-stream.mjs';
import { app, BrowserWindow, Menu, dialog, ipcMain, screen, session, shell, globalShortcut } from 'electron';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import liquidGlass from 'electron-liquid-glass';
import { appendFile, readFile, rename, stat } from 'node:fs/promises';
import { isLoginDestination, navigationKind, shouldNavigate } from './runtime-policy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* The hosted app stays the single source of truth: serverless routes live on
   heysurf.dev, so the window just loads the workspace over HTTPS. */
const APP_ORIGIN = process.env.HEYSURF_ORIGIN ?? 'https://heysurf.dev';
const APP_URL = `${APP_ORIGIN}/app`;
// Quick Ask goes through the same same-origin Next proxy the web app uses.
const QUICKASK_API = `${APP_ORIGIN}/api/v1/quick-ask`;
const LOGIN_FILE = path.join(__dirname, 'login.html');
const LOGIN_URL = new URL('./login.html', import.meta.url).href;
const desktopCSS = await readFile(path.join(__dirname, 'desktop-performance.css'), 'utf8');
// Bound expendable HTTP cache; authentication and user storage are separate.
app.commandLine.appendSwitch('disk-cache-size', String(64 * 1024 * 1024));

/* Clerk session cookies on the app origin = a session exists. Used only as a
   launch fast-path; the web app reports the real state over `surf:auth-state`. */
const SESSION_COOKIES = new Set(['__session', '__clerk_db_jwt', '__client_uat']);

let mainWindow = null;
let pendingDeepLink = null;
let loginState = null;   // CSRF nonce for the in-flight browser login
let onLoginScreen = false;
let pendingNavigation = null;
let quitting = false;
app.on('before-quit', () => { quitting = true; });
let logQueue = Promise.resolve();

function logRuntime(event, detail = {}) {
  // Only lifecycle events are logged. Never record URLs, tickets, cookies, or
  // conversation content, and retain at most two roughly 1 MB log files.
  const entry = JSON.stringify({ time: new Date().toISOString(), event, ...detail });
  logQueue = logQueue.then(async () => {
    const file = path.join(app.getPath('userData'), 'runtime.log');
    if ((await stat(file).catch(() => null))?.size > 1024 * 1024) await rename(file, `${file}.previous`);
    await appendFile(file, entry + '\n');
  }).catch(() => {});
}

function navigate(target, local = false) {
  const win = mainWindow;
  if (!win || win.isDestroyed() || !shouldNavigate({ current: win.webContents.getURL(), pending: pendingNavigation, target })) return;
  pendingNavigation = target;
  const loaded = local ? win.loadFile(LOGIN_FILE) : win.loadURL(target);
  void loaded.catch(error => {
    if (error.code !== 'ERR_ABORTED') logRuntime('navigation-failed', { code: error.code });
  }).finally(() => { if (pendingNavigation === target) pendingNavigation = null; });
}

const allowedPermissions = new Set(['clipboard-read', 'notifications', 'media', 'fullscreen']);

function applyGlass(win) {
  if (liquidGlass.isGlassSupported()) {
    liquidGlass.addView(win.getNativeWindowHandle(), { cornerRadius: 12 });
  } else if (process.platform === 'darwin') {
    // Pre-Tahoe fallback: NSVisualEffectView under the window.
    win.setVibrancy('under-window');
  }
}

// ─── Quick Ask (Option+Space) ────────────────────────────────────────────────
// A real NSPanel (Electron `type: 'panel'`): floats above workspaces, takes
// key focus without dragging the app's menu bar forward, hides on blur like
// Spotlight. One ask only — each invocation starts a fresh, empty composer.
const quickAsk = { win: null };

async function quickAskToken(refresh = false) {
  // Prefer a live Clerk session in the workspace renderer — session.getToken
  // mints a fresh JWT even when the cached one aged out.
  if (mainWindow && !mainWindow.isDestroyed() && !onLoginScreen) {
    try {
      const token = await mainWindow.webContents.executeJavaScript(
        `window.Clerk && window.Clerk.session ? window.Clerk.session.getToken({ skipCache: ${refresh} }) : null`);
      if (typeof token === 'string' && token) return token;
    } catch { /* renderer not ready or page not Clerk-backed yet */ }
  }
  // Fallback: the session cookie IS a Clerk session JWT (same one the page
  // fetches). It can be near expiry if the app page has been closed a while,
  // in which case the backend 401s and the panel offers sign-in.
  try {
    const cookies = await session.defaultSession.cookies.get({ url: APP_ORIGIN, name: '__session' });
    return cookies[0]?.value || null;
  } catch { return null; }
}

function createQuickAskWindow() {
  const win = new BrowserWindow({
    type: 'panel',                      // native NSPanel on macOS
    width: 520,
    height: 48,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'quickask-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  void win.loadFile(path.join(__dirname, 'quickask.html'));
  win.webContents.on('did-finish-load', () => {
    if (liquidGlass.isGlassSupported()) {
      try { liquidGlass.addView(win.getNativeWindowHandle(), { cornerRadius: 24 }); return; } catch { /* fall through */ }
    }
    if (process.platform === 'darwin') win.setVibrancy('hud');
  });
  win.on('blur', () => { if (!win.webContents.isDevToolsOpened()) hideQuickAsk(); });
  win.on('closed', () => { if (quickAsk.win === win) quickAsk.win = null; });
  quickAsk.win = win;
  return win;
}

function showQuickAsk() {
  const win = quickAsk.win || createQuickAskWindow();
  // Center on the display that has the cursor.
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const bounds = win.getBounds();
  const area = display.workArea;
  win.setBounds({
    x: Math.round(area.x + (area.width - Math.min(520, area.width - 40)) / 2),
    y: Math.round(area.y + (area.height - 48) / 2),
    width: Math.min(520, area.width - 40),
    height: 48,
  });
  win.show();
  win.focus();
  win.webContents.send('qa:reset');
}

function hideQuickAsk() {
  quickAsk.win?.hide();
}

function toggleQuickAsk() {
  const win = quickAsk.win;
  if (win?.isVisible()) hideQuickAsk(); else showQuickAsk();
}

async function hasSessionCookie() {
  try {
    const cookies = await session.defaultSession.cookies.get({ url: APP_ORIGIN });
    return cookies.some((cookie) => SESSION_COOKIES.has(cookie.name));
  } catch {
    return false;
  }
}

function showApp(url = APP_URL) {
  const kind = navigationKind(url, APP_ORIGIN);
  if (kind !== 'internal') {
    if (kind === 'external') void shell.openExternal(url);
    return;
  }
  if (isLoginDestination(url, APP_ORIGIN)) { showLogin(); return; }
  onLoginScreen = false;
  navigate(url);
}

function showLogin() {
  onLoginScreen = true;
  navigate(LOGIN_URL, true);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    transparent: true,
    backgroundColor: '#00000000',
    // Do NOT set `vibrancy` alongside liquid glass — it overrides the glass view.
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
      spellcheck: true,
    },
  });
  mainWindow = win;
  win.once('ready-to-show', () => {
    if (process.env.HEYSURF_TEST_MODE !== '1') win.show();
  });

  // Keep one renderer: same-origin popups navigate the existing window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const kind = navigationKind(url, APP_ORIGIN);
    if (kind === 'internal') showApp(url);
    else if (kind === 'external') void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Intercept before the homepage/web login can load, including HTTP redirects.
  const interceptNavigation = (event, url) => {
    const kind = navigationKind(url, APP_ORIGIN);
    if (kind !== 'internal') {
      event.preventDefault();
      if (kind === 'external') void shell.openExternal(url);
      return;
    }
    if (isLoginDestination(url, APP_ORIGIN)) {
      event.preventDefault();
      showLogin();
    }
  };
  win.webContents.on('will-navigate', interceptNavigation);
  win.webContents.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
    if (isMainFrame) interceptNavigation(event, url);
  });
  // SPA navigations (router.replace('/login')) only fire did-navigate-in-page.
  win.webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame && isLoginDestination(url, APP_ORIGIN)) showLogin();
  });

  let recoveryShown = false;
  const offerRecovery = async (crashed = false) => {
    if (quitting || recoveryShown || win.isDestroyed()) return;
    recoveryShown = true;
    try {
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning', title: crashed ? 'HeySurf needs to reload' : 'HeySurf is taking longer than expected',
        message: crashed ? 'The workspace renderer stopped.' : 'The workspace is not responding.',
        detail: 'Reloading may discard an unsent draft.',
        buttons: crashed ? ['Reload HeySurf', 'Close Window'] : ['Keep Waiting', 'Reload HeySurf'],
        defaultId: 0, cancelId: crashed ? 1 : 0,
      });
      if (win.isDestroyed()) return;
      if (response === (crashed ? 0 : 1)) win.webContents.reload();
      else if (crashed) win.close();
    } finally { recoveryShown = false; }
  };
  win.on('unresponsive', () => {
    logRuntime('unresponsive', { processes: app.getAppMetrics().map(({ type, cpu, memory }) => ({ type, cpu, memory })) });
    void offerRecovery();
  });
  win.on('responsive', () => logRuntime('responsive'));
  win.webContents.on('render-process-gone', (_event, { reason, exitCode }) => {
    logRuntime('renderer-exited', { reason, exitCode });
    if (reason !== 'clean-exit') void offerRecovery(true);
  });
  win.webContents.on('did-finish-load', () => {
    void win.webContents.insertCSS(desktopCSS).catch(() => {});
  });
  win.on('closed', () => { if (mainWindow === win) { mainWindow = null; pendingNavigation = null; } });
  win.webContents.once('did-finish-load', () => {
    try { applyGlass(win); } catch { logRuntime('native-glass-unavailable'); }
  });
  return win;
}

async function openWorkspace() {
  const win = mainWindow || createWindow();
  const loggedIn = await hasSessionCookie();
  if (mainWindow !== win || win.isDestroyed()) return;
  if (pendingDeepLink) {
    const target = pendingDeepLink; pendingDeepLink = null; showApp(target);
  } else if ((!win.webContents.getURL() || win.webContents.getURL() === 'about:blank') && !pendingNavigation) {
    if (loggedIn) showApp(); else showLogin();
  }
}

function handleDeepLink(url) {
  if (url.startsWith('heysurf://auth')) {
    // Browser authorize → heysurf://auth?ticket=…&state=… → consume in-window.
    const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
    const params = new URLSearchParams(query);
    const ticket = params.get('ticket');
    const state = params.get('state');
    if (!ticket) return;
    if (loginState && state !== loginState) return; // CSRF: not our login attempt
    loginState = null;
    const consume = `${APP_ORIGIN}/auth/app/consume?ticket=${encodeURIComponent(ticket)}`;
    if (mainWindow) {
      showApp(consume);
      mainWindow.focus();
    } else {
      pendingDeepLink = consume;
      if (app.isReady()) void openWorkspace();
    }
    return;
  }
  const target = `${APP_ORIGIN}/${url.replace(/^heysurf:\/\/?/, '')}`;
  if (mainWindow) {
    showApp(target);
    mainWindow.focus();
  } else {
    pendingDeepLink = target;
    if (app.isReady()) void openWorkspace();
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const link = argv.find((arg) => arg.startsWith('heysurf://'));
    if (link) handleDeepLink(link);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  if (process.env.HEYSURF_TEST_MODE === '1') {
    // Isolated native tests must not change the user's heysurf:// handler.
  } else if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('heysurf', process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient('heysurf');
  }
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  ipcMain.handle('surf:app-version', () => app.getVersion());
  ipcMain.handle('surf:begin-login', () => {
    loginState = crypto.randomUUID();
    const device = encodeURIComponent(os.hostname().replace(/\.local$/, ''));
    const url = `${APP_ORIGIN}/auth/app?device=${device}&state=${loginState}&return=heysurf://auth`;
    void shell.openExternal(url);
  });
  ipcMain.on('surf:auth-state', (_event, signedIn) => {
    if (signedIn === false) showLogin();
    else if (signedIn === true && onLoginScreen) showApp();
  });

  ipcMain.handle('qa:ask', async (_event, text) => {
    if (_event.sender !== quickAsk.win?.webContents) return { error: 'forbidden' };
    const token = await quickAskToken();
    if (!token) return { error: 'signin' };
    try {
      const res = await fetch(QUICKASK_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: String(text || '').slice(0, 4000),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
        signal: AbortSignal.timeout(125_000),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401) return { error: 'signin' };
      if (!res.ok) return { error: 'api', message: data?.error?.message || `Quick Ask failed (${res.status})` };
      return data;
    } catch (error) {
      return { error: 'network', message: error.name === 'TimeoutError' ? 'Timed out. Try again.' : 'No connection. Try again.' };
    }
  });
  ipcMain.handle('qa:read', async (event, { threadId, cursor } = {}) => {
    if (event.sender !== quickAsk.win?.webContents || !/^[a-zA-Z0-9-]+$/.test(threadId || '') || !/^\d+-\d+$/.test(cursor || '')) return { error: 'invalid' };
    try {
      return await readQuickAskPage({ refreshToken: true, fetchPage: async refresh => {
        const token = await quickAskToken(refresh);
        if (!token) return { status: 401 };
        return fetch(`${QUICKASK_API}/${threadId}?cursor=${encodeURIComponent(cursor)}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
        });
      } });
    } catch { return { error: 'network', retryable: true, message: 'Unable to reconnect. Your run continues in HeySurf.' }; }
  });
  ipcMain.on('qa:resize', (_event, height) => {
    const win = quickAsk.win;
    if (!win) return;
    const b = win.getBounds();
    const area = screen.getDisplayMatching(b).workArea;
    const h = Math.max(48, Math.min(Math.floor(area.height * .6), 480, Math.round(height || 48)));
    if (h === b.height) return;
    win.setBounds({ x: b.x, y: Math.round(area.y + (area.height - h) / 2), width: b.width, height: h }, true);
  });
  ipcMain.on('qa:dismiss', () => hideQuickAsk());
  ipcMain.on('qa:open-app', () => { hideQuickAsk(); void openWorkspace(); });

  app.whenReady().then(async () => {
    if (process.env.HEYSURF_TEST_MODE === '1' && process.platform === 'darwin') {
      app.setActivationPolicy('prohibited');
    }
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(allowedPermissions.has(permission));
    });
    // Signing out inside the app drops the session cookies → back to login.
    // Re-check the jar: a single expired cookie can be a mid-rotation blip,
    // so only bail when no session marker remains.
    session.defaultSession.cookies.on('changed', (_event, cookie, _cause, removed) => {
      if (!removed || !SESSION_COOKIES.has(cookie.name)) return;
      void hasSessionCookie().then((still) => { if (!still) showLogin(); });
    });

    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]));

    // Option+Space toggles the Quick Ask panel (macOS Option = Alt).
    if (!globalShortcut.register('Alt+Space', toggleQuickAsk)) {
      logRuntime('quickask-shortcut-conflict');
    }
    app.quickAskToggle = toggleQuickAsk; // test/debug hook — same path as the hotkey
    app.on('will-quit', () => globalShortcut.unregisterAll());

    await openWorkspace();

    app.on('activate', () => {
      if (!mainWindow) void openWorkspace();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
