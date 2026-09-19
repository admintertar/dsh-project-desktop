/** Shared by the creation guide and main process; keep the Project plugin's HTTPS/SSH policy. */
export function validResourceUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\s\u0000-\u001f\u007f\\?#]/.test(value)) return false;
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:[A-Za-z0-9._~/-]+$/.test(value)) return true;
  try {
    const url = new URL(value);
    const decoded = decodeURIComponent(url.pathname);
    return (url.protocol === 'https:' || url.protocol === 'ssh:') && Boolean(url.hostname)
      && !url.password && !url.search && !url.hash && (url.protocol !== 'https:' || !url.username)
      && url.pathname !== '/' && !/[\u0000-\u0020\u007f]/.test(decoded);
  } catch {return false;}
}

/** Git check-ref-format rules, with no checkout shorthand; empty selects the remote default. */
export function validResourceBranch(value) {
  if (typeof value !== 'string' || value.length > 255) return false;
  if (!value) return true;
  return value !== 'HEAD' && !/^[-@]/.test(value) && !/[\u0000-\u0020\u007f~^:?*\[\\]/.test(value)
    && !value.includes('..') && !value.includes('@{') && !value.endsWith('.')
    && value.split('/').every(part => part && !part.startsWith('.') && !part.endsWith('.lock'));
}
