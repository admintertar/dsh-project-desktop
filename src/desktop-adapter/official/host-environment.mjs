/** 直接复用官方 login-shell reader，全应用只读取一次，项目变量在创建 Host 时覆盖。 */
export function createOfficialHostEnvironment(services, base = process.env) {
  const controller = new AbortController();
  let reading;
  return {
    read() {
      controller.signal.throwIfAborted();
      reading ??= services.readDesktopLoginShellEnvironment(base, services.resolveDesktopLoginShellConfig(base),
        {signal: controller.signal}).then(result => result.environment);
      return reading;
    },
    dispose() {controller.abort()},
  };
}
