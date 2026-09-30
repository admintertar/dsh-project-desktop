import {setTimeout as delay} from 'node:timers/promises';
import {updateFixture} from './update-fixtures.mjs';
import {latestUpdateManifestUrl, versionUpdateManifestUrl} from '../src/app/update-manifest.mjs';

/** Synthetic transport only; the official coordinator, IPC, preload, sidebar and dialog are real. */
export function createOfficialUpdateFixture(platform = process.platform) {
  const next = updateFixture('0.1.12', platform), current = updateFixture('0.1.11', platform);
  const state = {latest: next, next, current, checkError: false, downloadError: false, corrupt: false,
    requests: [], installed: [], holdDownload: false, releaseDownload: undefined};
  state.request = async (url, init = {}) => {
    state.requests.push(url);
    init.signal?.throwIfAborted();
    if (url === latestUpdateManifestUrl) {
      if (state.checkError) throw new Error('ERR_CONNECTION_RESET');
      await delay(50, undefined, {signal: init.signal});
      return Response.json(state.latest.release);
    }
    if (url === versionUpdateManifestUrl(next.release.version)) return Response.json(next.release);
    if (url !== next.release.assets.find(asset => asset.name === next.name).url) throw new Error('Unexpected update fixture URL');
    if (state.downloadError) throw new Error('ERR_CONNECTION_RESET');
    let offset = 0;
    return new Response(new ReadableStream({async pull(controller) {
      if (offset >= next.body.length) {controller.close(); return}
      if (offset > 0 && state.holdDownload) {
        await new Promise(resolve => {state.releaseDownload = () => {state.holdDownload = false; resolve()}});
      }
      await delay(60, undefined, {signal: init.signal});
      const chunk = Buffer.from(next.body.subarray(offset, offset + 64));
      if (state.corrupt) chunk[0] ^= 1;
      offset += chunk.length; controller.enqueue(chunk);
    }}));
  };
  return state;
}
