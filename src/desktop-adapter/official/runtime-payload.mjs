/** Portable payload integrity, including framework symlinks and executable bits. */
import {createHash} from 'node:crypto';
import {isAbsolute, join, relative, resolve, sep} from 'node:path';
import {lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync} from 'node:fs';

/** Inventory all shipped bytes; reject dangling links and any link leaving the payload. */
export function inventoryOfficialPayload(root) {
  const canonicalRoot = realpathSync(root);
  const entries = [];
  const within = (base, path) => {
    const child = relative(base, path);
    return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`));
  };
  const visit = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      if (!prefix && entry.name === 'source.json') {
        if (!entry.isFile()) throw new Error('Official payload source manifest must be a regular file');
        continue;
      }
      const path = join(directory, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path, name);
      else if (entry.isSymbolicLink()) {
        const target = readlinkSync(path);
        if (isAbsolute(target) || !within(root, resolve(directory, target)) || !within(canonicalRoot, realpathSync(path))) {
          throw new Error(`Official payload contains an external link: ${name}`);
        }
        entries.push({path: name, target});
      } else if (entry.isFile()) {
        const body = readFileSync(path);
        entries.push({path: name, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex'),
          executable: process.platform !== 'win32' && (lstatSync(path).mode & 0o111) !== 0});
      } else throw new Error(`Official payload contains an unsupported entry: ${name}`);
    }
  };
  visit(root);
  return entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

/** Validate an unsigned development payload before a probe uses its executables and preload. */
export function verifyOfficialRuntimePayload(root, pin, target) {
  const metadata = JSON.parse(readFileSync(join(root, 'source.json'), 'utf8'));
  if (metadata.schemaVersion !== 1 || metadata.kind !== 'official-unsigned-development-runtime'
    || metadata.repository !== pin.repository || metadata.commit !== pin.commit || metadata.version !== pin.version
    || metadata.desktopTree !== pin.desktopTree || metadata.dependencyLockBlob !== pin.dependencyLockBlob
    || metadata.target !== target || metadata.signed !== false || metadata.relocated !== true) {
    throw new Error('Official runtime payload differs from the fixed source or target');
  }
  if (JSON.stringify(inventoryOfficialPayload(root)) !== JSON.stringify(metadata.inventory)) {
    throw new Error('Official runtime payload integrity verification failed');
  }
  return metadata;
}
