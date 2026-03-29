require('dotenv').config();
const {
  app, BrowserWindow, Tray, Menu, ipcMain,
  nativeImage, shell, clipboard
} = require('electron');
const path = require('path');
const { Leverler } = require('./agents/leverler');

let mainWindow = null;
let tray = null;
let leverler = null;

// ─── Tray Icon (green dot PNG, base64 encoded) ──────────────────────────────
function makeTrayIcon(active) {
  // 16x16 canvas drawn via nativeImage
  const { nativeImage } = require('electron');
  // Simple colored circle using raw RGBA buffer
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const cx = 8, cy = 8, r = 5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const i = (y * size + x) * 4;
      if (dist <= r) {
        if (active) {
          buf[i]     = 0;   // R
          buf[i + 1] = 229; // G  (0x00E5)
          buf[i + 2] = 128; // B
          buf[i + 3] = 255; // A
        } else {
          buf[i]     = 80;
          buf[i + 1] = 100;
          buf[i + 2] = 120;
          buf[i + 3] = 255;
        }
      } else {
        buf[i + 3] = 0; // transparent
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

// ─── Window ──────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 840,
    minHeight: 600,
    show: false,
    backgroundColor: '#07090f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Hide instead of close — keep alive in tray
  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.hide();
  });

  if (process.env.ELECTRON_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// ─── System Tray ─────────────────────────────────────────────────────────────
function createTray() {
  tray = new Tray(makeTrayIcon(false));
  tray.setToolTip('Leverler — AI Agent Orchestrator');

  const rebuild = (isRunning) => {
    tray.setImage(makeTrayIcon(isRunning));
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: `Leverler  ${isRunning ? '● LISTENING' : '○ IDLE'}`,
        enabled: false,
        icon: makeTrayIcon(isRunning).resize({ width: 12, height: 12 }),
      },
      { type: 'separator' },
      {
        label: 'Open Dashboard',
        click: () => { mainWindow.show(); mainWindow.focus(); },
      },
      { type: 'separator' },
      {
        label: isRunning ? 'Pause Leverler' : 'Start Leverler',
        click: () => isRunning ? leverler.stop() : leverler.start(),
      },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.exit(0); } },
    ]));
  };

  tray.on('click', () => {
    mainWindow.isVisible() ? mainWindow.focus() : mainWindow.show();
  });

  rebuild(false);
  return rebuild;
}

// ─── App Boot ─────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  const updateTray = createTray();

  // Initialize orchestrator
  leverler = new Leverler({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

  // Forward leverler events → renderer
  const fwd = (event) => leverler.on(event, (data) => {
    mainWindow?.webContents?.send(event, data);
  });
  ['leverler:status', 'agent:start', 'agent:update', 'agent:complete',
   'log', 'trigger:fired'].forEach(fwd);

  leverler.on('leverler:status', ({ running }) => updateTray(running));

  // ─── IPC Handlers ──────────────────────────────────────────────────────────
  ipcMain.handle('leverler:start',       ()            => leverler.start());
  ipcMain.handle('leverler:stop',        ()            => leverler.stop());
  ipcMain.handle('leverler:getState',    ()            => leverler.getState());
  ipcMain.handle('leverler:setConfig',   (_, cfg)      => leverler.setConfig(cfg));
  ipcMain.handle('leverler:launchAgent', (_, opts)     => leverler.launchAgent(opts));
  ipcMain.handle('leverler:addTrigger',  (_, t)        => leverler.addTrigger(t));
  ipcMain.handle('leverler:removeTrigger',(_, id)      => leverler.removeTrigger(id));
  ipcMain.handle('leverler:updateTrigger',(_, id, data)=> leverler.updateTrigger(id, data));
  ipcMain.handle('app:openExternal',      (_, url)      => shell.openExternal(url));
  ipcMain.handle('app:readClipboard',     ()            => clipboard.readText());

  // Show window on first launch
  mainWindow.once('ready-to-show', () => mainWindow.show());
});

app.on('window-all-closed', (e) => e.preventDefault()); // Stay alive
app.on('before-quit', () => leverler?.stop());
