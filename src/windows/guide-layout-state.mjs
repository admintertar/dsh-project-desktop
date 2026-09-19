import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';

const modes = new Set(['welcome', 'create']);
const validWidth = value => Number.isInteger(value) && value > 0 && value <= 4096;

/** Local UI preferences only. The renderer clamps widths to the guide layout limits. */
export class GuideLayoutState {
  constructor(file) {this.file = file}
  read() {
    if (!existsSync(this.file)) return {version: 2, sidebarWidths: {}};
    let value;
    try {
      value = JSON.parse(readFileSync(this.file, 'utf8'));
      if (![1, 2].includes(value.version) || !value.sidebarWidths || typeof value.sidebarWidths !== 'object' || Array.isArray(value.sidebarWidths)
        || Object.entries(value.sidebarWidths).some(([mode, width]) => !modes.has(mode) || !validWidth(width))) throw new Error('Invalid guide layout');
    } catch {
      renameSync(this.file, `${this.file}.unreadable-${Date.now()}`);
      return {version: 2, sidebarWidths: {}};
    }
    if (value.version === 1) {
      // Preserve both saved preferences proportionally when introducing narrower guides.
      value = {version: 2, sidebarWidths: Object.fromEntries(Object.entries(value.sidebarWidths)
        .map(([mode, width]) => [mode, Math.round(width * 2 / 3)]))};
      this.write(value);
    }
    return value;
  }
  width(mode) {return this.read().sidebarWidths[mode]}
  save(mode, width) {
    if (!modes.has(mode) || !validWidth(width)) throw new Error('Invalid sidebar width');
    const value = this.read();
    value.sidebarWidths[mode] = width;
    this.write(value);
  }
  write(value) {
    mkdirSync(dirname(this.file), {recursive: true, mode: 0o700});
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(value) + '\n', {mode: 0o600});
    renameSync(temporary, this.file);
  }
}
