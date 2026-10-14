const { contextBridge, ipcRenderer } = require('electron');
// Fixed capabilities only: no arbitrary IPC, paths, shell, filesystem or tokens.
contextBridge.exposeInMainWorld('panel', Object.freeze({
  snapshot: () => ipcRenderer.invoke('panel:snapshot'),
  settings: () => ipcRenderer.invoke('panel:settings'),
  saveSettings: settings => ipcRenderer.invoke('panel:save-settings', settings),
  refresh: () => ipcRenderer.invoke('panel:refresh'),
  refreshPrices: () => ipcRenderer.invoke('panel:refresh-prices'),
  fitContent: height => ipcRenderer.invoke('panel:fit-content', height),
  info: () => ipcRenderer.invoke('panel:info'),
  hide: () => ipcRenderer.invoke('panel:hide'),
  quit: () => ipcRenderer.invoke('panel:quit'),
  onSnapshot: callback => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('panel:update', listener);
    return () => ipcRenderer.removeListener('panel:update', listener);
  },
}));
