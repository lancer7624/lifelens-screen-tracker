/**
 * preload.js — IPC 桥接
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  onStateUpdate: (cb) => ipcRenderer.on('state-update', (_e, s) => cb(s)),
  triggerCapture: () => ipcRenderer.invoke('trigger-capture'),
  toggleRunning: () => ipcRenderer.invoke('toggle-running'),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  getSummaries: () => ipcRenderer.invoke('get-summaries'),
  getHeatmap: () => ipcRenderer.invoke('get-heatmap'),
  setModel: (model) => ipcRenderer.invoke('set-model', model),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
