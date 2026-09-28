/** Open the official Settings view through either the visible sidebar or its More menu. */
export async function openNativeSettings(project) {
  await project.window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 8000;
    let openedMore = false;
    let expandedSidebar = false;
    const check = () => {
      // Recovery restores the window at 980 px, where Desktop can collapse the
      // sidebar into an icon rail. The official brand button expands that rail.
      if (!expandedSidebar && document.querySelector('.dshDesktopFrame[data-sidebar-collapsed]')) {
        const expand = document.querySelector('[data-slot="sidebar.brand.mark"]')?.closest('button');
        if (expand) {expand.click(); expandedSidebar = true}
      }
      const settings = [...document.querySelectorAll('button')].find(button =>
        ['Settings', '设置'].some(label => button.innerText.trim().startsWith(label) || button.getAttribute('aria-label') === label));
      if (settings) {settings.click(); return resolve(true)}
      const more = [...document.querySelectorAll('button')].find(button =>
        ['More', '更多'].some(label => button.innerText.trim() === label || button.getAttribute('aria-label') === label));
      if (more && !openedMore) {more.click(); openedMore = true}
      if (Date.now() > deadline) return reject(new Error('Official Settings entrance was not found: ' + document.body.innerText));
      setTimeout(check, 50);
    }; check();
  })`);
}
