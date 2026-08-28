const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setup', {
  getState: () => ipcRenderer.invoke('setup:getState'),
  browsePath: () => ipcRenderer.invoke('setup:browsePath'),
  runInstall: (installDir) => ipcRenderer.invoke('setup:runInstall', installDir),
  launchApp: (installDir) => ipcRenderer.invoke('setup:launchApp', installDir),
  quit: () => ipcRenderer.invoke('setup:quit'),
  onProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('setup:progress', handler);
    return () => ipcRenderer.removeListener('setup:progress', handler);
  },
});
