// Waraqa for Windows: a small Electron shell around the Waraqa website.
const { app, BrowserWindow, shell, session, Menu, Notification } = require('electron');
const path = require('path');

const HOME = 'https://waraqa.hamadaanter1998.workers.dev/';
const HOST = new URL(HOME).host;
const ALLOWED_PERMISSIONS = new Set(['media', 'clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'notifications']);

let win = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}

const isOurs = (url) => { try { return new URL(url).host === HOST; } catch { return false; } };

function goBack() {
  if (!win) return;
  win.webContents.executeJavaScript('(window.waraqaBack&&window.waraqaBack())?1:0').then((handled) => {
    if (!handled && win.webContents.navigationHistory.canGoBack()) win.webContents.navigationHistory.goBack();
  }).catch(() => {});
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 500,
    backgroundColor: '#f6f7fb',
    title: 'ورقة',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: false },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());

  const wc = win.webContents;
  wc.setUserAgent(wc.getUserAgent() + ' WaraqaDesktop/' + app.getVersion());

  // Links to other sites open in the normal browser.
  wc.setWindowOpenHandler(({ url }) => {
    if (!isOurs(url) && /^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (url.startsWith('file:') || isOurs(url)) return;
    e.preventDefault();
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
  });

  // No internet: show a friendly page with a retry button.
  wc.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) win.loadFile(path.join(__dirname, 'offline.html'));
  });

  // Keyboard: reload, zoom, back.
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    const k = input.key.toLowerCase();
    if (k === 'f5' || (ctrl && k === 'r')) { e.preventDefault(); wc.reload(); }
    else if (ctrl && (k === '=' || k === '+')) { e.preventDefault(); wc.setZoomLevel(Math.min(4, wc.getZoomLevel() + 0.5)); }
    else if (ctrl && k === '-') { e.preventDefault(); wc.setZoomLevel(Math.max(-3, wc.getZoomLevel() - 0.5)); }
    else if (ctrl && k === '0') { e.preventDefault(); wc.setZoomLevel(0); }
    else if (input.alt && k === 'arrowleft') { e.preventDefault(); goBack(); }
    else if (ctrl && input.shift && k === 'i') { e.preventDefault(); wc.toggleDevTools(); }
  });
  win.on('app-command', (e, cmd) => { if (cmd === 'browser-backward') goBack(); });

  win.on('closed', () => { win = null; });
  win.loadURL(HOME);
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.waraqa.app');
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    cb(ALLOWED_PERMISSIONS.has(permission) && isOurs(details.requestingUrl || wc.getURL()));
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => ALLOWED_PERMISSIONS.has(permission) && isOurs(origin));

  // Saving files: ask where to save, starting in Downloads.
  ses.on('will-download', (e, item) => {
    item.setSaveDialogOptions({
      title: 'حفظ الملف',
      defaultPath: path.join(app.getPath('downloads'), item.getFilename()),
    });
    item.once('done', (ev, state) => {
      if (state !== 'completed') return;
      const saved = item.getSavePath();
      if (Notification.isSupported()) {
        const n = new Notification({ title: 'حُفظ الملف', body: path.basename(saved) + '\nاضغط لعرضه في المجلد' });
        n.on('click', () => shell.showItemInFolder(saved));
        n.show();
      }
    });
  });

  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => app.quit());
