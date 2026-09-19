import {readFileSync} from 'node:fs';

export const productVersion = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
export const productName = 'DSH Project Desktop';
