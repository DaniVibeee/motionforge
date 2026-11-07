'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  info: () => ipcRenderer.invoke('app:info'),

  saveProject: (data, suggestedName) => ipcRenderer.invoke('project:save', { data, suggestedName }),
  openProject: () => ipcRenderer.invoke('project:open'),

  importMedia: (kind) => ipcRenderer.invoke('media:import', kind),

  chooseExportPath: (suggestedName) => ipcRenderer.invoke('export:choose', suggestedName),
  exportStart: (opts) => ipcRenderer.invoke('export:start', opts),
  exportFrame: (buffer) => ipcRenderer.invoke('export:frame', buffer),
  exportFinish: () => ipcRenderer.invoke('export:finish'),
  exportCancel: () => ipcRenderer.invoke('export:cancel'),

  saveBuffer: (buffer, suggestedName) => ipcRenderer.invoke('export:saveBuffer', { buffer, suggestedName }),

  showItemInFolder: (p) => ipcRenderer.invoke('shell:showItem', p),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
});
