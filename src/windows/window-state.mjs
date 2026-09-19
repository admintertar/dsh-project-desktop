/** Keep restored bounds usable after a display is removed or its resolution changes. */
export function visibleBounds(saved, displays) {
  if (!saved || !displays.length || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(saved[key]))) return {};
  const areas = displays.map(display => display.workArea);
  const area = areas.find(area => saved.x < area.x + area.width - 80 && saved.x + saved.width > area.x + 80
    && saved.y >= area.y && saved.y < area.y + area.height - 40) ?? areas[0];
  const width = Math.min(Math.max(640, saved.width), area.width);
  const height = Math.min(Math.max(480, saved.height), area.height);
  return {width, height, x: Math.max(area.x, Math.min(saved.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(saved.y, area.y + area.height - height))};
}

export function trackWindowState(window, save, onError) {
  let timer;
  const flush = () => {
    clearTimeout(timer);
    if (window.isDestroyed()) return;
    try {save({...window.getNormalBounds(), maximized: window.isMaximized(), fullScreen: window.isFullScreen()})}
    catch (error) {onError(error)}
  };
  const changed = () => {clearTimeout(timer); timer = setTimeout(flush, 180)};
  for (const event of ['move', 'resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) window.on(event, changed);
  window.on('close', flush);
  window.on('closed', () => clearTimeout(timer));
  return flush;
}
