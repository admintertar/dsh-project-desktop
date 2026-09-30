/** Run the shipped Shell, Host and plugin after relocation; never uses the user's Home. */
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createProjectFile} from '../dist/project-files.mjs';

async function waitForContent(window, ready, label) {
  const deadline = Date.now() + 30000;
  let text;
  do {
    text = await window.webContents.executeJavaScript('document.body.innerText');
    if (ready(text)) return;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(`${label} did not finish loading: ${text}`);
}

async function checkProject(project, name) {
  await project.window.webContents.executeJavaScript('globalThis.__DSH_BOOT_READY__.promise');
  assert.equal((await project.host.request('/api/project/snapshot')).status, 200);
  // Official boot readiness precedes the plugin's asynchronous Project request.
  await waitForContent(project.window, text => text.includes(name) && /项目模式|Project mode/.test(text)
    && !/Loading plugins|Loading project|正在读取项目/.test(text), name);
}

export async function runOfficialShellSmoke({electron, open, close, workspace, userData, showGuide}) {
  const guide = await showGuide();
  await waitForContent(guide, text => /DSH Project/.test(text), 'Welcome');
  const projects = [];
  for (const name of ['Installed Alpha', 'Installed Beta']) {
    const directory = join(userData, name); mkdirSync(directory);
    const manifest = createProjectFile(join(directory, name + '.agent-project'));
    const project = await open(manifest);
    await checkProject(project, name);
    assert.equal(await project.window.webContents.executeJavaScript('window.dshOnboarding.hasApiKey()'), false);
    projects.push({manifest, project});
  }
  const [a, b] = projects;
  assert.notEqual(a.project.host.url, b.project.host.url);
  assert.notEqual(a.project.window.webContents.session, b.project.window.webContents.session);
  await close(a.manifest, {showWelcome: false});
  assert.equal((await b.project.host.request('/api/project/snapshot')).status, 200);
  const reopened = await open(a.manifest);
  await checkProject(reopened, 'Installed Alpha');
  for (const {manifest} of projects) await close(manifest, {showWelcome: false});
  assert.equal(workspace.projects.size, 0);
  const build = JSON.parse(readFileSync(new URL('../dist/build.json', import.meta.url)));
  console.log('INSTALLATION_CHECK=' + JSON.stringify({ok: true, packaged: electron.app.isPackaged,
    platform: process.platform, arch: process.arch, appPath: electron.app.getAppPath(), version: electron.app.getVersion(),
    officialCommit: build.sourceCommit, projectCommit: build.projectCommit, welcome: true, twoProjects: true, closeIsolation: true, reopen: true}));
}
