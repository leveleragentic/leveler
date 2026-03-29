const { contextBridge, ipcRenderer } = require('electron');

// Expose a clean, typed API to the renderer
contextBridge.exposeInMainWorld('leverler', {
  // Control
  start:          ()         => ipcRenderer.invoke('leverler:start'),
  stop:           ()         => ipcRenderer.invoke('leverler:stop'),
  getState:       ()         => ipcRenderer.invoke('leverler:getState'),
  setConfig:      (cfg)      => ipcRenderer.invoke('leverler:setConfig', cfg),

  // Agents
  launchAgent:    (opts)     => ipcRenderer.invoke('leverler:launchAgent', opts),

  // Triggers
  addTrigger:     (t)        => ipcRenderer.invoke('leverler:addTrigger', t),
  removeTrigger:  (id)       => ipcRenderer.invoke('leverler:removeTrigger', id),
  updateTrigger:  (id, data) => ipcRenderer.invoke('leverler:updateTrigger', id, data),

  // Utilities
  openExternal:   (url)      => ipcRenderer.invoke('app:openExternal', url),
  readClipboard:  ()         => ipcRenderer.invoke('app:readClipboard'),

  // Event subscriptions
  on: (event, cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on(event, handler);
    return () => ipcRenderer.removeListener(event, handler); // returns unsub fn
  },
});
