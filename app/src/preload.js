const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sieged', {
  fetchNews: () => ipcRenderer.invoke('news:fetch'),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPackVersion: () => ipcRenderer.invoke('app:getPackVersion'),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  fetchLauncherStream: () => ipcRenderer.invoke('app:fetchLauncherStream'),
  joinDiscord: () => ipcRenderer.invoke('discord:join'),
  openWebsite: () => ipcRenderer.invoke('website:open'),
  openDownloadPage: () => ipcRenderer.invoke('download:open'),
  getState: () => ipcRenderer.invoke('app:getState'),
  login: () => ipcRenderer.invoke('auth:login'),
  loginBrowser: () => ipcRenderer.invoke('auth:loginBrowser'),
  selectAccount: (uuid) => ipcRenderer.invoke('auth:select', uuid),
  removeAccount: (uuid) => ipcRenderer.invoke('auth:remove', uuid),
  logout: () => ipcRenderer.invoke('auth:logout'),
  play: () => ipcRenderer.invoke('game:play'),
  onGameEvent: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('game:event', handler);
    return () => ipcRenderer.removeListener('game:event', handler);
  },
});
