const { contextBridge, ipcRenderer } = require('electron');

/* Narrow bridge for the Quick Ask panel only. The renderer asks, the main
   process carries the Clerk token and does the HTTPS call. */
contextBridge.exposeInMainWorld('quickAsk', {
  ask: text => ipcRenderer.invoke('qa:ask', String(text || '').slice(0, 4000)),
  read: (threadId, cursor) => ipcRenderer.invoke('qa:read', { threadId, cursor }),
  resize: height => ipcRenderer.send('qa:resize', Number(height) || 0),
  dismiss: () => ipcRenderer.send('qa:dismiss'),
  openApp: () => ipcRenderer.send('qa:open-app'),
  onReset: fn => ipcRenderer.on('qa:reset', () => fn()),
});
