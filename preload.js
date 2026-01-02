// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  extractMetadata: (path) => ipcRenderer.invoke('extract-metadata', path),
  onMenuOpenFile: (callback) => ipcRenderer.on('menu-open-file', callback),
  onMenuClear: (callback) => ipcRenderer.on('menu-clear', callback)
});