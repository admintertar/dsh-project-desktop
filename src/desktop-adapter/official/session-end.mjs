/** 官方 main.ts 的系统退出识别；多窗口共用标记，普通退出仍走任务确认。 */
export function installOfficialSessionEnd({app, powerMonitor}, platform = process.platform) {
  let ending = false;
  const cleanups = new Set();
  const shutdown = () => {ending = true};
  const continuing = () => {ending = false};
  const created = (_event, window) => {
    const events = platform === 'win32' ? ['session-end'] : ['focus', 'show'];
    const listener = platform === 'win32' ? shutdown : continuing;
    const cleanup = () => {
      for (const event of events) window.removeListener(event, listener);
      window.removeListener('closed', cleanup); cleanups.delete(cleanup);
    };
    for (const event of events) window.on(event, listener);
    window.once('closed', cleanup); cleanups.add(cleanup);
  };
  app.on('browser-window-created', created);
  if (platform !== 'win32') powerMonitor.on('shutdown', shutdown);
  return {
    get ending() {return ending},
    dispose() {
      app.removeListener('browser-window-created', created);
      powerMonitor.removeListener('shutdown', shutdown);
      for (const cleanup of cleanups) cleanup();
    },
  };
}
