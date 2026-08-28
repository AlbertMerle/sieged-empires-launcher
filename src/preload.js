const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sieged', {
  getState: () => ipcRenderer.invoke('app:getState'),
  login: () => ipcRenderer.invoke('auth:login'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  checkUpdates: () => ipcRenderer.invoke('pack:checkUpdates'),
  play: () => ipcRenderer.invoke('game:play'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  onPackProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('pack:progress', handler);
    return () => ipcRenderer.removeListener('pack:progress', handler);
  },
  onGameEvent: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('game:event', handler);
    return () => ipcRenderer.removeListener('game:event', handler);
  },
});
