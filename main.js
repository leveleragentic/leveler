require('dotenv').config();
const {
  app, BrowserWindow, Tray, Menu, ipcMain,
  nativeImage, shell, safeStorage, dialog
} = require('electron');
const path = require('path');
const fs   = require('fs');
const { Leverler } = require('./agents/leverler');

let mainWindow  = null;
let tray        = null;
let leverler    = null;
let CONFIG_PATH = null;

// ── Config persistence ────────────────────────────────────────────────────
function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (raw.triggers && safeStorage.isEncryptionAvailable()) {
      raw.triggers = raw.triggers.map(t => {
        if (t.emailConfig?.encPass) {
          try {
            t.emailConfig.pass = safeStorage.decryptString(
              Buffer.from(t.emailConfig.encPass, 'base64')
            );
          } catch (_) {}
          delete t.emailConfig.encPass;
        }
        return t;
      });
    }
    return raw;
  } catch { return {}; }
}

function saveConfig(config) {
  try {
    const toSave = JSON.parse(JSON.stringify(config));
    if (toSave.triggers && safeStorage.isEncryptionAvailable()) {
      toSave.triggers = toSave.triggers.map(t => {
        if (t.emailConfig?.pass) {
          t.emailConfig.encPass = safeStorage.encryptString(
            t.emailConfig.pass
          ).toString('base64');
          delete t.emailConfig.pass;
        }
        return t;
      });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(toSave, null, 2));
  } catch (err) {
    console.error('Failed to save config:', err.message);
  }
}

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
  CONFIG_PATH = path.join(app.getPath('userData'), 'leverler-config.json');
  createWindow();
  const updateTray = createTray();

  const saved = loadConfig();

  leverler = new Leverler({
    ollamaHost:          saved.ollamaHost          || process.env.OLLAMA_HOST  || 'http://localhost:11434',
    ollamaModel:         saved.ollamaModel         || process.env.OLLAMA_MODEL || 'qwen2.5:7b',
    ollamaTemperature:   saved.ollamaTemperature   ?? parseFloat(process.env.OLLAMA_TEMP || '0.4'),
    maxConcurrentAgents: saved.maxConcurrentAgents || 3,
    triggers:            saved.triggers            || [],
    confirmTrigger: async (trigger, ctx) => {
      const source  = ctx.source || 'external';
      const preview = ctx.text
        ? `"${ctx.text.slice(0, 120)}"`
        : ctx.messages ? `${ctx.messages.length} email(s)` : '';
      const { response } = await dialog.showMessageBox(mainWindow, {
        type:      'question',
        buttons:   ['Launch Agent', 'Dismiss'],
        defaultId: 0,
        cancelId:  1,
        title:     'Trigger Detected',
        message:   `Launch agent for "${trigger.name}"?`,
        detail:    `Source: ${source}${preview ? `\nContent: ${preview}` : ''}`,
      });
      return response === 0;
    },
  });

  // Forward events → renderer
  [
    'leverler:status', 'agent:start', 'agent:update',
    'agent:complete', 'log', 'trigger:fired', 'queue:update'
  ].forEach(evt => {
    leverler.on(evt, (data) => mainWindow?.webContents?.send(evt, data));
  });

  leverler.on('leverler:status', ({ running }) => updateTray(running));

  // ── IPC ─────────────────────────────────────────────────────────────
  ipcMain.handle('leverler:start',    () => leverler.start());
  ipcMain.handle('leverler:stop',     () => leverler.stop());
  ipcMain.handle('leverler:getState', () => leverler.getState());

  ipcMain.handle('leverler:setConfig', (_, cfg) => {
    leverler.setConfig(cfg);
    saveConfig(leverler.config);
  });
  ipcMain.handle('leverler:launchAgent', (_, opts) => leverler.launchAgent(opts));
  ipcMain.handle('leverler:addTrigger', (_, t) => {
    const result = leverler.addTrigger(t);
    saveConfig(leverler.config);
    return result;
  });
  ipcMain.handle('leverler:removeTrigger', (_, id) => {
    leverler.removeTrigger(id);
    saveConfig(leverler.config);
  });
  ipcMain.handle('leverler:updateTrigger', (_, id, data) => {
    leverler.updateTrigger(id, data);
    saveConfig(leverler.config);
  });
  ipcMain.handle('leverler:retryAgent',  (_, id)  => leverler.retryAgent(id));
  ipcMain.handle('leverler:checkOllama', ()       => leverler.checkOllama());
  ipcMain.handle('app:openExternal',     (_, url) => shell.openExternal(url));

  mainWindow.once('ready-to-show', () => mainWindow.show());
});

app.on('window-all-closed', (e) => e.preventDefault());
app.on('before-quit', () => leverler?.stop());
