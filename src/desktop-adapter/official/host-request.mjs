/** 主进程凭据只能发给当前项目的 Host，重定向也不能带走 Cookie。 */
export function createOfficialHostRequest(hostUrl, cookie, send = fetch) {
  const origin = new URL(hostUrl).origin;
  return (path, init = {}) => {
    const url = new URL(path, origin);
    if (url.origin !== origin || url.username || url.password) throw new Error('Request must belong to the project Host');
    const headers = new Headers(init.headers);
    headers.set('cookie', cookie);
    return send(url.href, {...init, headers, redirect: 'error'});
  };
}

/** 清理失败仍保留资源所有权，ProjectRegistry 可重试，不能启动第二个 Host。 */
export function projectDisposer(actions) {
  const pending = new Set(actions);
  let running;
  return () => running ??= (async () => {
    const errors = [];
    for (const action of pending) {
      try {await action(); pending.delete(action)} catch (error) {errors.push(error)}
    }
    if (errors.length) throw new AggregateError(errors, 'Project cleanup is unconfirmed');
  })().finally(() => {running = undefined});
}
