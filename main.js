require('dotenv').config();
const {
  app, BrowserWindow, Tray, Menu, ipcMain,
  nativeImage, shell
} = require('electron');
const path = require('path');
const { Leverler } = require('./agents/leverler');

let mainWindow = null;
let tray       = null;
let leverler   = null;

// ── Tray icon ─────────────────────────────────────────────────────────────
function makeTrayIcon(active) {
  const size = 16;
  const buf  = Buffer.alloc(size * size * 4);
  const cx = 8, cy = 8, r = 5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const i  = (y * size + x) * 4;
      if (Math.sqrt(dx * dx + dy * dy) <= r) {
        if (active) {
          buf[i] = 0; buf[i+1] = 229; buf[i+2] = 128; buf[i+3] = 255;
        } else {
          buf[i] = 80; buf[i+1] = 100; buf[i+2] = 120; buf[i+3] = 255;
        }
      } else {
        buf[i+3] = 0;
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

// ── Window ────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120, height: 760, minWidth: 840, minHeight: 600,
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
  mainWindow.on('close', (e) => { e.preventDefault(); mainWindow.hide(); });

  if (process.env.ELECTRON_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// ── Tray ──────────────────────────────────────────────────────────────────
function createTray() {
  tray = new Tray(makeTrayIcon(false));
  tray.setToolTip('Leverler — Local AI Agent Orchestrator');
  tray.on('click', () => mainWindow.isVisible() ? mainWindow.focus() : mainWindow.show());

  const rebuild = (isRunning) => {
    tray.setImage(makeTrayIcon(isRunning));
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `Leverler  ${isRunning ? '● LISTENING' : '○ IDLE'}`, enabled: false },
      { type: 'separator' },
      { label: 'Open Dashboard', click: () => { mainWindow.show(); mainWindow.focus(); } },
      { type: 'separator' },
      {
        label: isRunning ? 'Pause Leverler' : 'Start Leverler',
        click: () => isRunning ? leverler.stop() : leverler.start(),
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.exit(0) },
    ]));
  };

  rebuild(false);
  return rebuild;
}

// ── Boot ──────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  const updateTray = createTray();

  leverler = new Leverler({
    ollamaHost:          process.env.OLLAMA_HOST  || 'http://localhost:11434',
    ollamaModel:         process.env.OLLAMA_MODEL || 'qwen2.5:7b',
    ollamaTemperature:   parseFloat(process.env.OLLAMA_TEMP || '0.4'),
    maxConcurrentAgents: 3,
  });

  // Forward events → renderer
  [
    'leverler:status', 'agent:start', 'agent:update',
    'agent:complete', 'log', 'trigger:fired'
  ].forEach(evt => {
    leverler.on(evt, (data) => mainWindow?.webContents?.send(evt, data));
  });

  leverler.on('leverler:status', ({ running }) => updateTray(running));

  // ── IPC ─────────────────────────────────────────────────────────────
  ipcMain.handle('leverler:start',         ()            => leverler.start());
  ipcMain.handle('leverler:stop',          ()            => leverler.stop());
  ipcMain.handle('leverler:getState',      ()            => leverler.getState());
  ipcMain.handle('leverler:setConfig',     (_, cfg)      => leverler.setConfig(cfg));
  ipcMain.handle('leverler:launchAgent',   (_, opts)     => leverler.launchAgent(opts));
  ipcMain.handle('leverler:addTrigger',    (_, t)        => leverler.addTrigger(t));
  ipcMain.handle('leverler:removeTrigger', (_, id)       => leverler.removeTrigger(id));
  ipcMain.handle('leverler:updateTrigger', (_, id, data) => leverler.updateTrigger(id, data));
  ipcMain.handle('leverler:checkOllama',   ()            => leverler.checkOllama());
  ipcMain.handle('app:openExternal',       (_, url)      => shell.openExternal(url));

  mainWindow.once('ready-to-show', () => mainWindow.show());
});

app.on('window-all-closed', (e) => e.preventDefault());
app.on('before-quit', () => leverler?.stop());
