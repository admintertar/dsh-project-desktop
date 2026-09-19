import {createRequire} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runtimePackage} from '../paths.mjs';

export const desktopRequire = createRequire(join(runtimePackage, 'package.json'));
/** All private Desktop imports must remain behind this version-specific boundary. */
export const loadDesktop = name => import(pathToFileURL(join(runtimePackage, 'lib', name + '.js')).href);
export const loadDependency = name => import(pathToFileURL(desktopRequire.resolve(name)).href);
