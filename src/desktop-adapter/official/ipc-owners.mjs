/** Bind official Desktop preload calls to the owning project main frame. */
export function createOfficialWindowOwners() {
  const owners = new Map();
  return {
    register(window, context) {
      const id = window.webContents.id;
      if (owners.has(id)) throw new Error('Official Desktop WebContents already has an owner');
      const owner = {...context, window};
      owners.set(id, owner);
      // Capture the ID while WebContents is alive. The closed event must not
      // query a destroyed Electron object or erase a newer registration.
      return () => {if (owners.get(id) === owner) owners.delete(id)};
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
