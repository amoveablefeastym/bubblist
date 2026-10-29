const { app, BrowserWindow, ipcMain, screen, Menu, globalShortcut, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

const BUBBLE = 72; // window size; the bubble itself is a little smaller, leaving room to float
const PANEL_W = 380; // default size; the user can resize and it's remembered
const PANEL_H = 620;
const PANEL_MIN_W = 300;
const PANEL_MIN_H = 380;
const GAP = 12;

// Keep data in the same folder whether run from source or as the packaged
// "Bubblist.app" (whose name would otherwise pick a different folder).
// Early builds were called glass-todo; carry their data over once.
const legacyData = path.join(app.getPath('appData'), 'glass-todo');
const userData = path.join(app.getPath('appData'), 'bubblist');
if (!fs.existsSync(userData) && fs.existsSync(path.join(legacyData, 'todos.json'))) {
  fs.mkdirSync(userData, { recursive: true });
  for (const file of ['todos.json', 'prefs.json']) {
    const from = path.join(legacyData, file);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(userData, file));
  }
}
app.setPath('userData', userData);

const dataFile = () => path.join(app.getPath('userData'), 'todos.json');
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

// Apple's Liquid Glass (macOS 26+) via a native view behind the page. Returns
// false when it isn't available, so callers can fall back to plain vibrancy.
function applyLiquidGlass(win, options) {
  try {
    const liquidGlass = require('electron-liquid-glass');
    if (!liquidGlass.isGlassSupported()) return false;
    const id = liquidGlass.addView(win.getNativeWindowHandle(), options);
    if (id < 0) return false;
    liquidGlass.unstable_setVariant(id, liquidGlass.GlassMaterialVariant.clear);
    return true;
  } catch (err) {
    console.error('Liquid glass unavailable:', err);
    return false;
  }
}

let bubble;
let panel;
let lastBlurHide = 0;
let drag = null;

function createBubble() {
  const wa = screen.getPrimaryDisplay().workArea;
  const prefs = readJSON(prefsFile(), {});
  const pos = prefs.bubble || { x: wa.x + wa.width - BUBBLE - 24, y: wa.y + Math.round(wa.height / 3) };

  bubble = new BrowserWindow({
    width: BUBBLE,
    height: BUBBLE,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  bubble.setAlwaysOnTop(true, 'floating');
  bubble.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // The bubble draws itself as a see-through soap bubble in CSS, so it skips
  // Liquid Glass (which would frost what's behind it).
  bubble.loadFile('bubble.html');
}

function createPanel() {
  panel = new BrowserWindow({
    width: PANEL_W,
    height: PANEL_H,
    minWidth: PANEL_MIN_W,
    minHeight: PANEL_MIN_H,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    roundedCorners: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  panel.setAlwaysOnTop(true, 'floating');
  panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  panel.loadFile('panel.html');
  panel.webContents.once('did-finish-load', () => {
    if (applyLiquidGlass(panel, { cornerRadius: 22, tintColor: '#ffffff12' })) {
      panel.webContents.executeJavaScript("document.body.classList.add('liquid')");
    } else {
      panel.setVibrancy('fullscreen-ui');
    }
  });

  panel.on('blur', () => {
    if (panel.isVisible() && !drag && !resize) {
      lastBlurHide = Date.now();
      hidePanel();
    }
  });
}

function panelSize(wa) {
  const saved = readJSON(prefsFile(), {}).panel || {};
  return {
    width: Math.min(Math.max(saved.width || PANEL_W, PANEL_MIN_W), wa.width - 16),
    height: Math.min(Math.max(saved.height || PANEL_H, PANEL_MIN_H), wa.height - 16),
  };
}

function placePanel() {
  const b = bubble.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  const { width, height } = panelSize(wa);
  const onRight = b.x + b.width / 2 > wa.x + wa.width / 2;
  const x = onRight ? b.x - width - GAP : b.x + b.width + GAP;
  const y = Math.min(Math.max(b.y + b.height / 2 - 60, wa.y + 8), wa.y + wa.height - height - 8);
  panel.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
  return onRight ? 'right' : 'left';
}

// Resizing from the panel's own handles (transparent windows can't use the
// system's edge resizing). The edge facing the bubble stays put; `edge` is
// 'side' (the outer side), 'top', 'bottom', or a corner: 'corner' (outer
// bottom) or 'corner-top' (outer top).
let resize = null;

ipcMain.on('panel:resizeStart', (_e, edge) => {
  const start = screen.getCursorScreenPoint();
  const bounds = panel.getBounds();
  const wa = screen.getDisplayMatching(bounds).workArea;
  const growsLeft = bubble.getBounds().x > bounds.x; // panel sits left of the bubble
  resize = { edge, start, bounds, wa, growsLeft };
  resize.timer = setInterval(() => {
    const p = screen.getCursorScreenPoint();
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    let { x, y, width, height } = bounds;
    if (edge === 'side' || edge.startsWith('corner')) {
      const maxW = growsLeft ? bounds.x + bounds.width - wa.x - 8 : wa.x + wa.width - bounds.x - 8;
      width = Math.min(Math.max(bounds.width + (growsLeft ? -dx : dx), PANEL_MIN_W), maxW);
      if (growsLeft) x = bounds.x + bounds.width - width;
    }
    if (edge === 'bottom' || edge === 'corner') {
      height = Math.min(Math.max(bounds.height + dy, PANEL_MIN_H), wa.y + wa.height - bounds.y - 8);
    }
    if (edge === 'top' || edge === 'corner-top') {
      // Grow upward: the bottom edge stays where it is.
      const bottom = bounds.y + bounds.height;
      height = Math.min(Math.max(bounds.height - dy, PANEL_MIN_H), bottom - wa.y - 8);
      y = bottom - height;
    }
    panel.setBounds({ x, y, width, height });
  }, 8);
});

ipcMain.on('panel:resizeEnd', () => {
  if (!resize) return;
  clearInterval(resize.timer);
  resize = null;
  const { width, height } = panel.getBounds();
  writeJSON(prefsFile(), { ...readJSON(prefsFile(), {}), panel: { width, height } });
});

function showPanel() {
  const side = placePanel();
  panel.setOpacity(0);
  panel.show();
  panel.focus();
  panel.webContents.send('panel:shown', side);
  bubble.webContents.send('bubble:open', true);
  let o = 0;
  const fade = setInterval(() => {
    o = Math.min(1, o + 0.2);
    if (!panel.isDestroyed()) panel.setOpacity(o);
    if (o >= 1) clearInterval(fade);
  }, 16);
}

function hidePanel() {
  panel.hide();
  bubble.webContents.send('bubble:open', false);
}

function togglePanel() {
  if (panel.isVisible()) hidePanel();
  else showPanel();
}

ipcMain.handle('todos:load', () => readJSON(dataFile(), null));
ipcMain.on('todos:save', (_e, data) => writeJSON(dataFile(), data));
ipcMain.on('todos:count', (_e, n) => bubble && bubble.webContents.send('bubble:count', n));
ipcMain.on('panel:hide', () => hidePanel());

// Dragging is driven from the main process by polling the cursor, so the bubble
// keeps up even when the mouse outruns its tiny window.
ipcMain.on('bubble:dragStart', () => {
  const start = screen.getCursorScreenPoint();
  const [wx, wy] = bubble.getPosition();
  drag = { start, offset: { x: start.x - wx, y: start.y - wy }, moved: false, at: Date.now() };
  drag.timer = setInterval(() => {
    const p = screen.getCursorScreenPoint();
    if (Math.abs(p.x - drag.start.x) + Math.abs(p.y - drag.start.y) > 4) drag.moved = true;
    if (drag.moved) {
      bubble.setPosition(p.x - drag.offset.x, p.y - drag.offset.y);
      if (panel.isVisible()) placePanel();
    }
  }, 8);
});

ipcMain.on('bubble:dragEnd', () => {
  if (!drag) return;
  clearInterval(drag.timer);
  const { moved, at } = drag;
  drag = null;
  if (moved) {
    const [x, y] = bubble.getPosition();
    writeJSON(prefsFile(), { ...readJSON(prefsFile(), {}), bubble: { x, y } });
  } else if (panel.isVisible()) {
    hidePanel();
  } else if (lastBlurHide < at - 150) {
    // Only open if the panel wasn't just closed by this same click blurring it.
    showPanel();
  }
});

ipcMain.on('bubble:menu', () => {
  const items = [{ label: 'Open Bubblist', click: showPanel }];
  if (app.isPackaged) {
    items.push({
      label: 'Open at login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    });
  }
  items.push({ type: 'separator' }, { label: 'Quit', click: () => app.quit() });
  Menu.buildFromTemplate(items).popup({ window: bubble });
});

app.whenReady().then(() => {
  if (app.dock) app.dock.hide();
  // Turn on open-at-login the first time the packaged app runs; after that the
  // bubble's right-click menu controls it.
  const prefs = readJSON(prefsFile(), {});
  if (app.isPackaged && prefs.loginItemFor !== app.getName()) {
    app.setLoginItemSettings({ openAtLogin: true });
    writeJSON(prefsFile(), { ...prefs, loginItemFor: app.getName() });
  }
  nativeTheme.themeSource = 'light'; // keep the frosted glass white even in dark mode
  createBubble();
  createPanel();
  globalShortcut.register('CommandOrControl+Shift+Space', togglePanel);
});

app.on('will-quit', () => globalShortcut.unregisterAll());
