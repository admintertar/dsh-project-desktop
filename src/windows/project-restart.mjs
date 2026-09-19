/** Adapt ElectronDesktopRuntime.confirmAndRestart to one project window. */
export function createProjectRestartRequest({getWindow, getLocale, confirmationCopy, showMessageBox, restart, recover, isClosing = () => false}) {
  let pending;
  return (target = 'normal') => {
    if (!['normal', 'recovery'].includes(target)) return Promise.reject(new Error('Invalid project restart target'));
    if (pending) return pending;
    const window = getWindow();
    const unavailable = () => isClosing() || !window || window.isDestroyed();
    if (unavailable()) return Promise.resolve();
    const request = Promise.resolve().then(async () => {
      if (unavailable()) return;
      const locale = getLocale() === 'zh' ? 'zh' : 'en';
      const copy = confirmationCopy(locale, target);
      // Preserve official warnings and cancel-default behavior, while naming the actual restart scope.
      const project = locale === 'zh' ? '当前项目' : 'this project';
      const scope = text => text.replaceAll(locale === 'zh' ? / *DSH Desktop */g : /DSH Desktop/g, project);
      const result = await showMessageBox(window, {
        type: 'question', title: scope(copy.title), message: scope(copy.message),
        detail: copy.detail.replace('应用将', '当前项目将').replace('The app will', 'This project will'),
        buttons: [locale === 'zh' && target === 'normal' ? '重启项目' : copy.confirm, copy.cancel],
        defaultId: 1, cancelId: 1, noLink: true,
      });
      if (result.response === 0 && !unavailable()) return target === 'normal' ? restart() : recover();
    }).finally(() => {if (pending === request) pending = undefined});
    pending = request;
    return request;
  };
}
