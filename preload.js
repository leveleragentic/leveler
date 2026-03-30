const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('leverler', {
  start:          ()         => ipcRenderer.invoke('leverler:start'),
  stop:           ()         => ipcRenderer.invoke('leverler:stop'),
  getState:       ()         => ipcRenderer.invoke('leverler:getState'),
  setConfig:      (cfg)      => ipcRenderer.invoke('leverler:setConfig', cfg),
  launchAgent:    (opts)     => ipcRenderer.invoke('leverler:launchAgent', opts),
  addTrigger:     (t)        => ipcRenderer.invoke('leverler:addTrigger', t),
  removeTrigger:  (id)       => ipcRenderer.invoke('leverler:removeTrigger', id),
  updateTrigger:  (id, data) => ipcRenderer.invoke('leverler:updateTrigger', id, data),
  checkOllama:    ()         => ipcRenderer.invoke('leverler:checkOllama'),
  openExternal:   (url)      => ipcRenderer.invoke('app:openExternal', url),
  on: (event, cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on(event, handler);
    return () => ipcRenderer.removeListener(event, handler);
  },
});
