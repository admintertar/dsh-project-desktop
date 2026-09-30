import {setTimeout as delay} from 'node:timers/promises';

/** 官方 ThemeRuntime 先发布 DOM 主题，再异步保存 ConfigForm；确认落盘后同步 Shell。 */
export function createOfficialThemeSync({read, apply, timeout = 10000, interval = 25}) {
  let current;
  let disposed = false;
  return {
    async notify(preference) {
      current?.abort();
      if (disposed) return;
      const controller = current = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]);
      try {
        // 单次 describe 可能先于官方 mutate 完成；不能据此丢弃唯一一次主题通知。
        // 启动时的临时色仍须通过保存值校验，后续通知会取消过时的读取与重试。
        while (true) {
          signal.throwIfAborted();
          const saved = await read(signal);
          signal.throwIfAborted();
          if (saved === preference) return await apply(preference);
          await delay(interval, undefined, {signal});
        }
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        if (current === controller) current = undefined;
      }
    },
    dispose() {disposed = true; current?.abort()},
  };
}
