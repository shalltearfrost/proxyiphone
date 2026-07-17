'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  assignInterface: (payload) => ipcRenderer.invoke('assign-interface', payload),
  toggleProxy: (payload) => ipcRenderer.invoke('toggle-proxy', payload),
  checkIp: (payload) => ipcRenderer.invoke('check-ip', payload),
  setAuth: (payload) => ipcRenderer.invoke('set-auth', payload),
  onState: (cb) => ipcRenderer.on('state', (_e, state) => cb(state)),
  onStats: (cb) => ipcRenderer.on('stats', (_e, stats) => cb(stats)),
});
