const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('projectGuide', Object.freeze({
  onStateChanged(callback) {
    const listener = () => callback(); ipcRenderer.on('project-desktop:state-changed', listener);
    return () => ipcRenderer.removeListener('project-desktop:state-changed', listener);
  },
  onCommand(callback) {
    const listener = (_event, action) => {if (action === 'new' || action === 'choose') callback(action)};
    ipcRenderer.on('project-desktop:command', listener);
    return () => ipcRenderer.removeListener('project-desktop:command', listener);
  },
  async invoke(action, value) {
    const result = await ipcRenderer.invoke('project-desktop:guide', action, value);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  },
}));
