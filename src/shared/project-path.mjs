/**
 * Join a project location and folder name for display, exactly as the shell
 * will create it.
 *
 * The create guide runs in a sandboxed Renderer without `node:path`, so the
 * platform separator comes from the window chrome instead of `path.sep`.
 * Windows normalizes to backslashes, matching `node:path.join` on win32, so
 * the preview never shows a mixed `D:\folder/name` path; other platforms keep
 * the user's text unchanged.
 */
export function projectPathPreview(directory, name, platform = '') {
  const location = typeof directory === 'string' ? directory.trim() : '';
  const folder = typeof name === 'string' ? name.trim() : '';
  const windows = platform === 'win32';
  const separator = windows ? '\\' : '/';
  let base = windows ? location.replaceAll('/', '\\') : location;
  base = base.replace(windows ? /\\+$/ : /\/+$/, '');
  // Preserve a bare root ("/" or "C:\") instead of collapsing it to "".
  if (base === '') base = location === '' ? '' : separator;
  else if (windows && /^[A-Za-z]:$/.test(base)) base += separator;
  if (folder === '') return base;
  if (base === '') return folder;
  // A preserved root already ends in its separator ("/", "C:\").
  return base.endsWith(separator) ? `${base}${folder}` : `${base}${separator}${folder}`;
}
