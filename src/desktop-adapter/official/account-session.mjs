/** 适配官方 main.ts 的账号监听；Host 保留授权、凭据及回调的完整生命周期。 */
export function watchOfficialAccount({account, shell, nativeTheme, focus, rememberReturn, onError}) {
  let disposed = false, openedAttempt, returnedAttempt, releaseReturn;
  const forgetReturn = () => {releaseReturn?.(); releaseReturn = undefined};
  const stop = account.watch(state => {
    if (disposed) return;
    const attempt = state.attempt;
    if (attempt?.phase === 'waiting-browser' && attempt.authorizeUrl !== undefined && openedAttempt !== attempt.id) {
      openedAttempt = attempt.id;
      forgetReturn();
      releaseReturn = rememberReturn?.(focus);
      // authorizeUrl 已由官方 accountView 验证；保留 PKCE/state/redirect 等所有参数。
      const url = new URL(attempt.authorizeUrl);
      url.searchParams.set('theme', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
      void shell.openExternal(url.href).catch(() => {
        if (disposed) return;
        focus();
        // 原始系统错误可能包含授权 URL，不能传给日志或错误弹窗。
        onError(new Error('Unable to open the sign-in browser. Use the official dialog to copy the login link.'));
      });
    }
    if (['failed', 'expired', 'succeeded'].includes(attempt?.phase) && openedAttempt === attempt.id && returnedAttempt !== attempt.id) {
      returnedAttempt = attempt.id;
      focus();
    }
    if (!attempt || ['cancelled', 'failed', 'expired'].includes(attempt.phase)) forgetReturn();
  }, () => {
    // 官方订阅会重连；断流不代表退出登录，不切换项目或清除凭据。
  }, () => {if (!disposed) {forgetReturn(); focus()}});
  return () => {if (disposed) return; disposed = true; forgetReturn(); stop()};
}
