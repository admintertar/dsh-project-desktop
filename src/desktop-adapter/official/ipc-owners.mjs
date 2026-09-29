/** Bind official Desktop preload calls to the owning project main frame. */
export function createOfficialWindowOwners() {
  const owners = new Map();
  return {
    register(window, context) {
      if (owners.has(window.webContents.id)) throw new Error('Official Desktop WebContents already has an owner');
      owners.set(window.webContents.id, {window, ...context});
    },
    unregister(window) {
      const owner = owners.get(window.webContents.id);
      if (owner?.window === window) owners.delete(window.webContents.id);
    },
    get size() {return owners.size},
    trusted(event) {
      const owner = owners.get(event.sender.id);
      let url;
      try {url = new URL(event.senderFrame?.url)} catch {throw new Error('Untrusted Desktop caller')}
      if (!owner || owner.window.isDestroyed?.() || event.sender !== owner.window.webContents
        || event.senderFrame !== event.sender.mainFrame || url.protocol !== 'dsh-app:' || url.hostname !== 'app') {
        throw new Error('Untrusted Desktop caller');
      }
      return owner;
    },
  };
}
