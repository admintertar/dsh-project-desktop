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

/**
 * One folder name for a repository checkout: never a path, never the `.agent-project`
 * entry file's own suffix, and never a name Git reserves for its own metadata.
 */
export function validRepositoryName(value) {
  if (typeof value !== 'string') return false;
  const name = value.trim();
  return Boolean(name) && name.length <= 160 && name !== '.' && name !== '..' && name !== '.git'
    && !/[/\\\u0000-\u001f\u007f]/.test(name) && !name.toLowerCase().endsWith('.agent-project');
}

/** The folder name `git clone` itself would derive, so the import form can prefill it. */
export function repositoryFolderName(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/[/\\]+$/, '');
  const scp = /^[^/@\s]+@[^/@\s:]+:(.+)$/.exec(trimmed);
  const tail = (scp ? scp[1] : trimmed).split(/[/\\]/).filter(Boolean).at(-1) ?? '';
  const name = tail.replace(/\.git$/i, '').trim();
  return validRepositoryName(name) ? name : '';
}
