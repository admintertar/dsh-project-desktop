import {updateFixture} from './update-fixtures.mjs';
import {productVersion} from '../src/app/product.mjs';
const [major, minor, patch] = productVersion.split('.');
export const nextVersion = `${major}.${minor}.${BigInt(patch) + 1n}`;
export const state = {version: productVersion, offline: false, status: 200, requests: [], opened: [], notifications: []};
export const options = {packaged: true,
  request: async (url, init) => {
    state.requests.push(url);
    if (url.startsWith('https://api.github.com/')) throw new Error('The app must not use the GitHub REST API');
    if (state.offline) throw new Error('Fixture network is offline');
    const fixture = updateFixture(state.version, process.platform);
    if (url.endsWith('/update.json')) return state.status === 200 ? Response.json(fixture.release) : new Response('', {status: state.status});
    return new Response(fixture.body);
  },
  openPath: async path => {state.opened.push(path); return ''},
  notify: message => state.notifications.push(message),
};
