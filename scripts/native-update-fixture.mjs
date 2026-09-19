import {updateFixture} from './update-fixtures.mjs';
import {productVersion} from '../src/app/product.mjs';
const [major, minor, patch] = productVersion.split('.');
export const nextVersion = `${major}.${minor}.${BigInt(patch) + 1n}`;
export const state = {version: productVersion, offline: false, requests: [], opened: [], notifications: []};
export const options = {packaged: true,
  request: async (url, init) => {
    state.requests.push(url);
    if (state.offline) throw new Error('Fixture network is offline');
    const fixture = updateFixture(state.version, process.platform);
    if (url.startsWith('https://api.github.com/')) return Response.json(fixture.release);
    if (url.endsWith('.sha256')) return new Response(fixture.checksum);
    return new Response(fixture.body);
  },
  openPath: async path => {state.opened.push(path); return ''},
  notify: message => state.notifications.push(message),
};
