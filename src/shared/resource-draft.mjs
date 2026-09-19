/** Display names and filesystem targets stay independent, as on the Resources page. */
export function suggestedResourceName(url) {
  const segment = url.trim().replace(/\/+$/, '').split(/[/:]/).at(-1)?.replace(/\.git$/, '') ?? '';
  try {return decodeURIComponent(segment).replace(/[\\/:\u0000-\u001f\u007f]/g, '-').replace(/^\.+$/, '').slice(0, 120)}
  catch {return ''}
}
export const validResourceName = value => typeof value === 'string' && Boolean(value.trim())
  && value.trim().length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);

export function validResourceTarget(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 8000 || /[\u0000-\u001f\u007f]/.test(value)) return false;
  const path = value.trim().replaceAll('\\', '/');
  if (/^(?:\/|[A-Za-z]:)/.test(path)) return false;
  const parts = path.split('/');
  return parts.every(part => part && part !== '.' && part !== '..' && part.toLowerCase() !== '.git')
    && !['.agent-project', 'memory', 'tasks', 'skills', 'mcp'].includes(parts[0].toLowerCase());
}
export function resourceTargetsOverlap(left, right) {
  const key = value => value.trim().replaceAll('\\', '/').toLowerCase();
  const a = key(left), b = key(right);
  return a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
}
export const defaultResourceTarget = name => `resources/${name}`;

export function draftResourceTarget(item) {
  if (!item.customPath) return defaultResourceTarget(item.name);
  if (item.mode !== 'link') return item.path;
  return defaultResourceTarget(suggestedResourceName(item.name) || item.id);
}
