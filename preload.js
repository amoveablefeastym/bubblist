const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('todos:load'),
  save: (data) => ipcRenderer.send('todos:save', data),
  setCount: (n) => ipcRenderer.send('todos:count', n),
  hidePanel: () => ipcRenderer.send('panel:hide'),
  dragStart: () => ipcRenderer.send('bubble:dragStart'),
  dragEnd: () => ipcRenderer.send('bubble:dragEnd'),
  menu: () => ipcRenderer.send('bubble:menu'),
  on: (channel, fn) => ipcRenderer.on(channel, (_e, ...args) => fn(...args)),
});
