const isOpen = url => url === 'dsh://open' || url === 'dsh://open/';

/** 官方协议只负责唤起，不接收凭据。回调在各项目的 loopback Host 中完成。 */
export function installOfficialDeepLinks(app, {focusDefault, onError, register = app.isPackaged || process.env.DSH_DESKTOP_DEV_APP === '1'}) {
  let ready = false, pending = false, disposed = false;
  const returns = new Map();
  const focus = () => {
    void Promise.resolve().then(() => {
      if (disposed) return;
      return ([...returns.values()].at(-1) ?? focusDefault)();
    }).catch(onError);
  };
  const handle = url => {
    if (disposed || !isOpen(url)) return false;
    if (ready) focus(); else pending = true;
    return true;
  };
  const openUrl = (event, url) => {if (handle(url)) event.preventDefault()};
  app.on('open-url', openUrl);
  if (register) app.setAsDefaultProtocolClient('dsh');
  return {
    handle,
    remember(focusProject) {
      const key = Symbol(); returns.set(key, focusProject);
      return () => returns.delete(key);
    },
    ready() {ready = true; if (pending) {pending = false; focus()}},
    dispose() {disposed = true; returns.clear(); app.removeListener('open-url', openUrl)},
  };
}
