import {cpSync, existsSync, readFileSync} from 'node:fs';
import {join, resolve, sep} from 'node:path';
import {runtimePackage} from '../src/desktop-adapter/paths.mjs';
const source = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Usage: npm run setup:electron -- /path/to/electron-npm-package');
const destination = join(runtimePackage, 'node_modules/electron');
const version = JSON.parse(readFileSync(join(destination, 'package.json'), 'utf8')).version;
if (JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version !== version) throw new Error('Electron versions differ');
const binary = readFileSync(join(source, 'path.txt'), 'utf8').trim();
if (!resolve(source, 'dist', binary).startsWith(resolve(source, 'dist') + sep) || !existsSync(join(source, 'dist', binary))) throw new Error('Invalid Electron cache');
if (existsSync(join(destination, 'path.txt'))) throw new Error('Electron is already prepared; do not overwrite a running runtime');
// macOS framework links must stay relative to the copied app bundle.
cpSync(join(source, 'dist'), join(destination, 'dist'), {recursive: true, verbatimSymlinks: true});
cpSync(join(source, 'path.txt'), join(destination, 'path.txt'));
console.log(`Copied independent Electron ${version} binary cache; no Desktop source or build artifacts imported.`);
