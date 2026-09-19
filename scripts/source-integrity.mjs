import {createHash} from 'node:crypto';
import {lstatSync, readFileSync, readlinkSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

function objectHash(kind, bytes) {
  return createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest();
}

/** Recreate Git's tree identity from bytes and executable/symlink modes. No .git required. */
export function sourceTree(directory) {
  const entries = readdirSync(directory).map(name => {
    const path = join(directory, name);
    const stat = lstatSync(path);
    if (stat.isDirectory()) return {name, order: `${name}/`, mode: '40000', hash: Buffer.from(sourceTree(path), 'hex')};
    if (stat.isSymbolicLink()) return {name, order: name, mode: '120000', hash: objectHash('blob', Buffer.from(readlinkSync(path)))};
    if (!stat.isFile()) throw new Error(`Unsupported upstream entry: ${path}`);
    return {name, order: name, mode: stat.mode & 0o111 ? '100755' : '100644', hash: objectHash('blob', readFileSync(path))};
  });
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.order), Buffer.from(b.order)));
  return objectHash('tree', Buffer.concat(entries.map(item => Buffer.concat([
    Buffer.from(`${item.mode} ${item.name}\0`), item.hash,
  ])))).toString('hex');
}

export function assertSourceTree(directory, expected) {
  const actual = sourceTree(directory);
  if (actual !== expected) throw new Error(`Upstream source changed: ${directory}\nExpected ${expected}; found ${actual}`);
  return actual;
}
