/**
 * Which tray contribution the Shell deliberately merges away.
 *
 * The pinned Host runs an official `desktop-diagnostics` plugin that contributes its own
 * "Export Diagnostics…" command to the Project Tools menu (`group: 'tools'`, `order: 20`, label
 * from the official tray copy). The Shell widens that export into one "Export Logs and
 * Diagnostics…" entry that writes the startup report and copies the official archive beside it,
 * so the official duplicate is dropped instead of leaving two menu entries that send the same
 * evidence to two destinations.
 *
 * All three signals must agree before a contribution is dropped: the group, the order the pinned
 * Host assigns, and the official label in a locale the Shell serves. Anything that fails to match
 * every one of them stays visible, so a renamed or reordered official command can never be
 * removed by accident — it would only reappear as a duplicate.
 */

/** Tray group the pinned Host puts its project-tool commands in. */
export const OFFICIAL_TOOLS_GROUP = 'tools';
/** Order the pinned `desktop-diagnostics` contribution registers with (`src/diagnostics.ts`). */
export const OFFICIAL_DIAGNOSTICS_ORDER = 20;

/**
 * Decide whether one tray contribution is the official diagnostics command.
 * @param {{group?: string, order?: number, label?: () => string}|undefined} item - a tray contribution as the Host projects it.
 * @param {Set<string>} labels - the official diagnostics label in every locale the Shell serves.
 * @returns {boolean} true only when the group, the order and the label all agree.
 */
export function isOfficialDiagnosticsTrayItem(item, labels) {
  if (!item || item.group !== OFFICIAL_TOOLS_GROUP || item.order !== OFFICIAL_DIAGNOSTICS_ORDER) return false;
  if (typeof item.label !== 'function') return false;
  try {return labels.has(item.label())} catch {return false}
}
