/**
 * Re-apply the active window material after a live theme change.
 *
 * Windows keeps the previous DWM backdrop palette until the window recomposes, so
 * a transparent themed surface (the advanced sidebar stays transparent whenever a
 * material is active) keeps the stale palette until the material is re-applied.
 * The pinned official runtime does this in `ElectronDesktopRuntime.setThemeSource`
 * through the platform strategy; the shell replacement has to keep the same step.
 * @param {{strategy: {refreshThemeMaterial: (window: unknown, material: string) => void}, getWindow: () => any, getMaterial: () => string | undefined}} host
 * @returns a function safe to call before the window or its specification exist
 */
export function createWindowMaterialRefresher({strategy, getWindow, getMaterial}) {
  return () => {
    const material = getMaterial();
    if (material === undefined) return;
    const window = getWindow();
    if (window === undefined || window.isDestroyed()) return;
    strategy.refreshThemeMaterial(window, material);
  };
}
