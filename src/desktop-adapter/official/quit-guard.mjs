import {basename} from 'node:path';

/** 所有受影响 Host 都参与检查；某个 Host 不可达时沿用官方的保守提示，并保留其他项目的计划提醒。 */
export async function inspectProjectQuit(projects) {
  const results = await Promise.allSettled(projects.map(project => Promise.resolve().then(() => project.host.inspectQuit())));
  return {activeTasks: results.some(result => result.status === 'rejected' || result.value.activeTasks),
    scheduledTasks: results.some(result => result.status === 'fulfilled' && result.value.scheduledTasks)};
}

/** 官方退出对话框的完整 locale 契约；仅调整 Shell 的品牌、动作和项目范围。 */
export function projectQuitLocale(locale, {action, path}, name) {
  const zh = locale.id.startsWith('zh');
  const title = path ? basename(path, '.agent-project') : '';
  const messages = {...locale.messages, aboutProduct: name};
  if (action === 'quit') messages.quitTitle = zh ? `退出 ${name}？` : `Quit ${name}?`;
  else {
    const restart = action === 'restart';
    messages.quit = zh ? (restart ? '重启项目' : '关闭项目') : (restart ? 'Restart Project' : 'Close Project');
    messages.quitTitle = zh ? `${restart ? '重启' : '关闭'}项目“${title}”？` : `${restart ? 'Restart' : 'Close'} project “${title}”?`;
    messages.quitActiveTasks = zh ? '此项目中正在运行的任务将会中断。' : 'Running tasks in this project will be interrupted.';
    messages.quitScheduledTasks = zh
      ? `项目${restart ? '重启' : '关闭'}期间，定时任务不会运行。`
      : `Scheduled tasks in this project will not run while it is ${restart ? 'restarting' : 'closed'}.`;
    messages.quitActiveAndScheduledTasks = `${messages.quitActiveTasks}\n${messages.quitScheduledTasks}`;
  }
  return {...locale, messages};
}

/** 复用固定官方 DesktopQuitConfirmation；不同项目的原生对话框按序显示，防止顶层弹窗堆叠。 */
export function createOfficialQuitGuard(electron, services, {locale, name, icon}) {
  let queue = Promise.resolve(), active, disposed = false;
  const focus = () => {if (process.platform === 'darwin') electron.app.focus({steal: true})};
  return {
    focus,
    confirm(request) {
      const task = queue.catch(() => {}).then(async () => {
        if (disposed) return false;
        active = new services.DesktopQuitConfirmation({
          locale: () => projectQuitLocale(services.resolveDesktopLocale(
            request.action === 'quit' ? locale() : request.projects[0]?.locale ?? locale()), request, name),
          inspect: () => request.projects.length ? inspectProjectQuit(request.projects) : undefined,
          show: options => electron.dialog.showMessageBox(options), focus,
          ...(process.platform === 'win32' && icon ? {icon: electron.nativeImage.createFromPath(icon)} : {}),
        });
        try {return await active.confirm()} finally {active.dispose(); active = undefined}
      });
      queue = task;
      return task;
    },
    dispose() {disposed = true; active?.dispose()},
  };
}
