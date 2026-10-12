const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('nebula', {
  call: (method, ...args) => ipcRenderer.invoke('call', method, args),
  on: (channel, cb) => {
    const h = (e, data) => cb(data);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return null; } },
});
