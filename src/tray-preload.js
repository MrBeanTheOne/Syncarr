const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('trayPanel', {
  getActivity: () => ipcRenderer.invoke('tray:getActivity'),
  command: (command) => ipcRenderer.invoke('tray:command', command),
  resize: (size) => ipcRenderer.send('tray:resize', size),
  onActivity: (callback) => {
    const listener = (_event, activity) => callback(activity);
    ipcRenderer.on('tray:activity', listener);
    return () => ipcRenderer.removeListener('tray:activity', listener);
  }
});
