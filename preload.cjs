const { contextBridge, ipcRenderer } = require('electron');

/* Narrow bridge — exposed to the local login screen and to heysurf.dev pages.
   `reportAuth` lets the web app tell the shell when a session exists; the
   shell swaps between login.html and the workspace accordingly. */
contextBridge.exposeInMainWorld('surfDesktop', {
  isDesktop: true,
  performanceProfile: 'balanced',
  platform: process.platform,
  arch: process.arch,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  appVersion: () => ipcRenderer.invoke('surf:app-version'),
  beginLogin: () => ipcRenderer.invoke('surf:begin-login'),
  reportAuth: (signedIn) => ipcRenderer.send('surf:auth-state', Boolean(signedIn)),
});

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.surfDesktop = 'balanced';
}, { once: true });

// Append outside the app's React root after document load. Recreated for each
// full navigation; SPA routes retain the same native drag surface.
window.addEventListener('load', () => {
  if (document.getElementById('surf-desktop-titlebar')) return;
  const titlebar = document.createElement('div');
  titlebar.id = 'surf-desktop-titlebar';
  titlebar.setAttribute('aria-hidden', 'true');
  titlebar.title = 'Drag to move window';
  document.body.append(titlebar);
}, { once: true });
