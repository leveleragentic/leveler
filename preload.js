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
  retryAgent:     (id)       => ipcRenderer.invoke('leverler:retryAgent', id),
  checkOllama:    ()         => ipcRenderer.invoke('leverler:checkOllama'),
  openExternal:   (url)      => ipcRenderer.invoke('app:openExternal', url),
  history: {
    list:   (opts) => ipcRenderer.invoke('history:list',   opts),
    count:  (opts) => ipcRenderer.invoke('history:count',  opts),
    get:    (id)   => ipcRenderer.invoke('history:get',    id),
    delete: (id)   => ipcRenderer.invoke('history:delete', id),
    clear:  ()     => ipcRenderer.invoke('history:clear'),
  },
  memory: {
    getGlobal: ()        => ipcRenderer.invoke('memory:getGlobal'),
    setGlobal: (content) => ipcRenderer.invoke('memory:setGlobal', content),
  },
  on: (event, cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on(event, handler);
    return () => ipcRenderer.removeListener(event, handler);
  },
});
