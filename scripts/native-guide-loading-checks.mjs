import assert from 'node:assert/strict';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createGuideWindow} from '../src/windows/guide-window.mjs';

const evaluate = (window, script) => window.webContents.executeJavaScript(script);
async function wait(window, expression) {
  const deadline = Date.now() + 10000;
  while (!await evaluate(window, `Boolean(${expression})`)) {
    if (Date.now() > deadline) throw new Error('Guide loading timeout: ' + expression);
    await delay(25);
  }
}
const click = (window, selector) => evaluate(window, `document.querySelector(${JSON.stringify(selector)}).click()`);
const input = (window, selector, value) => evaluate(window, `(() => {
  const node=document.querySelector(${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(value)});
  node.dispatchEvent(new Event('input',{bubbles:true}));
})()`);
const geometry = (window, selectors) => evaluate(window, `(() => {
  const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
  return ${JSON.stringify(selectors)}.map(selector=>rect(document.querySelector(selector)));
})()`);

/** Hold external opening/picker callbacks while exercising the actual preload,
 * main-process progress events, React controls and real project file creation. */
export async function checkGuideLoading({electron, repository, userData}) {
  // Opening a folder or file is now classified before the plugin resolves it, so the
  // picker fixture must be a real entry file rather than a display-only recent path.
  const openTarget = join(userData, 'loading-fixtures', 'Open Target.agent-project');
  mkdirSync(dirname(openTarget), {recursive: true});
  writeFileSync(openTarget, 'schemaVersion: 1\nid: open-target\nname: Open Target\nresources: []\nmemory: []\n');
  for (const locale of ['en', 'zh']) for (const theme of ['light', 'dark']) {
    electron.nativeTheme.themeSource = theme;
    const openLabel = locale === 'zh' ? '打开中…' : 'Opening…';
    const footerLabel = locale === 'zh' ? '正在打开项目窗口…' : 'Opening the project window…';
    const recent = {list: () => [1, 2].map(id => ({title: `Project ${id}`, path: `/fixtures/project-${id}/demo.agent-project`}))};
    let opening = Promise.withResolvers(), picker = Promise.withResolvers(), calls = 0;
    const window = await createGuideWindow({...electron, dialog: {...electron.dialog, showOpenDialog: () => picker.promise}},
      {repository, locale, hidden: true, recent, open: async () => {calls++; await opening.promise; throw new Error('Fixture opening failure')}});
    try {
      window.setSize(locale === 'zh' ? 420 : 900, locale === 'zh' ? 460 : 640);
      window.show();
      await wait(window, 'document.querySelectorAll(".recentProject").length===2');
      await delay(450);
      const selectors = ['.recentProject', '.recentProject:last-child', '.recentItem>span:last-child', '.welcomeContent>footer', '.toolbar'];
      const before = await geometry(window, selectors);
      const identity = await evaluate(window, 'document.querySelector(".recentItem").innerText');
      // Two clicks in one turn must not dispatch duplicate opening operations.
      await evaluate(window, 'document.querySelector(".recentItem").click();document.querySelector(".recentItem").click()');
      await wait(window, 'document.querySelector(".recentProject").getAttribute("aria-busy")==="true"');
      window.webContents.send('project-desktop:command', 'new');
      window.webContents.send('project-desktop:guide-progress', {id: 'stale-operation', phase: 'creating'});
      await wait(window, `document.querySelector('.guideWelcomeHint').textContent===${JSON.stringify(footerLabel)}`);
      assert.equal(calls, 1);
      assert.deepEqual(await geometry(window, selectors), before);
      assert.equal(await evaluate(window, 'document.querySelector(".recentItem").innerText'), identity);
      assert.equal(await evaluate(window, 'document.querySelectorAll(".recentTrailing[data-opening]").length'), 1);
      assert.equal(await evaluate(window, 'document.querySelector(".recentProject:last-child").getAttribute("aria-busy")'), 'false');
      assert.equal(await evaluate(window, 'document.querySelector(".guideBody>p[role=status]")===null'), true);
      writeFileSync(join(userData, `welcome-loading-${locale}-${theme}.png`), (await window.webContents.capturePage()).toPNG());
      opening.resolve();
      await wait(window, 'document.querySelector("[role=alert]")?.textContent.includes("Fixture opening failure") && !document.querySelector("section[aria-busy=true]")');
      assert.equal(await evaluate(window, 'document.querySelectorAll(".recentTrailing[data-opening]").length'), 0);

      // Selecting or cancelling a file is not yet opening a project.
      const buttonBefore = await geometry(window, ['.actions>button[data-guide-action=open]', '.toolbar', '.welcomeContent>footer']);
      await click(window, '.actions>button[data-guide-action=open]');
      await wait(window, 'document.querySelector("section[aria-busy=true]")');
      assert.equal(await evaluate(window, 'document.querySelector(".actions>button[data-guide-action=open]").getAttribute("aria-busy")'), 'false');
      picker.resolve({canceled: true, filePaths: []});
      await wait(window, '!document.querySelector("section[aria-busy=true]")');
      assert.equal(calls, 1);
      opening = Promise.withResolvers(); picker = Promise.withResolvers();
      await click(window, '.actions>button[data-guide-action=open]');
      picker.resolve({canceled: false, filePaths: [openTarget]});
      await wait(window, `document.querySelector('.actions>button[data-guide-action=open]').getAttribute('aria-label')===${JSON.stringify(openLabel)}`);
      assert.deepEqual(await geometry(window, ['.actions>button[data-guide-action=open]', '.toolbar', '.welcomeContent>footer']), buttonBefore);
      assert.equal(await evaluate(window, 'document.querySelectorAll(".recentTrailing[data-opening]").length'), 0);
      opening.resolve();
      await wait(window, '!document.querySelector("section[aria-busy=true]")');
      assert.equal(calls, 2);
    } finally {opening.resolve(); picker.resolve({canceled: true, filePaths: []}); window.destroy()}

    let manifest, browse = Promise.withResolvers();
    const startup = Promise.withResolvers();
    const create = await createGuideWindow(electron, {repository, locale, mode: 'create', hidden: true, recent,
      defaultDirectory: join(userData, 'loading-fixtures'), chooseDirectory: () => browse.promise,
      open: async path => {manifest = path; await startup.promise; throw new Error('Fixture startup failure')}});
    try {
      create.setSize(locale === 'zh' ? 420 : 980, locale === 'zh' ? 460 : 720); create.show();
      await wait(create, 'document.querySelector(".setting input") && !document.querySelector("section[aria-busy=true]")');
      await delay(450);
      await evaluate(create, 'window.guideProgressEvents=[];void window.projectGuide.onProgress(progress=>window.guideProgressEvents.push(progress))');
      await input(create, '.setting input', `Loading ${locale} ${theme}`);
      await click(create, '.projectPathControl>button');
      await wait(create, 'document.querySelector("section[aria-busy=true]")');
      assert.equal(await evaluate(create, 'document.querySelector(".createContent>footer button:last-child").getAttribute("aria-busy")'), 'false');
      assert.equal(await evaluate(create, 'document.querySelector(".guideProgress").textContent'), '');
      browse.resolve(null);
      await wait(create, '!document.querySelector("section[aria-busy=true]")');
      const selectors = ['.createContent>footer', '.createContent>footer button:last-child', '.projectPathControl', '.resourceGrid'];
      const before = await geometry(create, selectors);
      await click(create, '.createContent>footer button:last-child');
      await wait(create, `document.querySelector('.createContent>footer button:last-child').getAttribute('aria-label')===${JSON.stringify(openLabel)}`);
      await wait(create, `document.querySelector('.guideProgress').textContent===${JSON.stringify(footerLabel)}`);
      assert.deepEqual(await evaluate(create, 'window.guideProgressEvents.map(item=>item.phase)'), ['creating', 'opening']);
      assert.equal(await evaluate(create, 'new Set(window.guideProgressEvents.map(item=>item.id)).size'), 1);
      assert.ok(existsSync(manifest));
      assert.deepEqual(await geometry(create, selectors), before);
      assert.equal(await evaluate(create, 'document.querySelector(".setting input").disabled'), true);
      assert.equal(await evaluate(create, 'document.querySelector(".guideBody>p[role=status]")===null'), true);
      assert.equal(await evaluate(create, 'document.documentElement.scrollWidth>innerWidth || document.querySelector(".guideBody").scrollWidth>document.querySelector(".guideBody").clientWidth'), false);
      writeFileSync(join(userData, `create-loading-${locale}-${theme}.png`), (await create.webContents.capturePage()).toPNG());
      startup.resolve();
      await wait(create, 'document.querySelector("[role=alert]")?.textContent.includes("Fixture startup failure") && !document.querySelector("section[aria-busy=true]")');
      assert.equal(await evaluate(create, 'document.querySelector(".setting input").value'), `Loading ${locale} ${theme}`);
      assert.equal(await evaluate(create, 'document.querySelector(".setting input").disabled'), false);
      assert.equal(await evaluate(create, 'document.querySelector(".guideProgress").textContent'), '');
      const events = await evaluate(create, 'window.guideProgressEvents');
      create.webContents.send('project-desktop:guide-progress', {id: events[0].id, phase: 'opening'});
      await delay(100);
      assert.equal(await evaluate(create, 'document.querySelector(".createContent>footer button:last-child").getAttribute("aria-busy")'), 'false');
    } finally {browse.resolve(null); startup.resolve(); create.destroy()}
  }
  console.log('Guide loading placement, real phases, stable geometry, picker cancellation and failure recovery passed.');
}
