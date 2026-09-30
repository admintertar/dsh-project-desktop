import electron from 'electron';
import {AsyncLocalStorage} from 'node:async_hooks';
export const {app, dialog, shell, systemPreferences, WebContentsView} = electron;
const projectSessions = new AsyncLocalStorage();
// 官方 PlatformView 以账号生成分区名；加项目命名空间，避免同账号的两个项目共享 Cookie。
export const session = new Proxy(electron.session, {get(target, key) {
  if (key !== 'fromPartition') return Reflect.get(target, key);
  return (partition, options) => {
    const project = projectSessions.getStore();
    const scoped = project === undefined ? partition : partition.startsWith('persist:')
      ? `persist:project-${project}:${partition.slice(8)}` : `project-${project}:${partition}`;
    return target.fromPartition(scoped, options);
  };
}});
export const withProjectSessionScope = (project, action) => projectSessions.run(project, action);

let current;
// 官方 keyboard/directory-picker 使用应用级 ipcMain。仅把注册位置适配到窗口，
// 保留上游的参数校验、持久化、物理按键处理和对话框完整行为。
export const ipcMain = {
  handle(channel, listener) {
    if (!current) throw new Error('Official IPC installation needs a window scope');
    const scope = current;
    scope.ipc.handle(channel, (event, ...args) => {scope.assertSender(event); return listener(event, ...args)});
    scope.channels.add(channel);
  },
  removeHandler(channel) {
    if (!current) throw new Error('Official IPC disposal needs a window scope');
    current.ipc.removeHandler(channel);
    current.channels.delete(channel);
  },
};

export function createWindowIpcScope(ipc, assertSender) {
  const scope = {ipc, assertSender, channels: new Set()};
  return {
    run(action) {
      const previous = current;
      current = scope;
      try {return action()} finally {current = previous}
    },
    dispose() {for (const channel of scope.channels) ipc.removeHandler(channel); scope.channels.clear()},
  };
}
