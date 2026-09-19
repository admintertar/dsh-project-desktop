import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {parse} from 'yaml';
import {createGuideWindow} from '../src/windows/guide-window.mjs';
import {GuideClones} from '../src/app/guide-clones.mjs';
import {loadGuideResources} from '../src/desktop-adapter/stable/guide-resources.mjs';
import {privateGitFixture, waitUntil} from '../tests/fixtures/private-git.mjs';

const frame = window => window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
const evaluate = (window, code) => window.webContents.executeJavaScript(code);
async function waitFor(window, code) {await waitUntil(() => evaluate(window, code), code); await frame(window)}
async function fill(window, selector, text) {
  await evaluate(window, `(() => {const input=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});
    input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await frame(window);
}
async function openRemote(window) {
  if (await evaluate(window, `Boolean(document.querySelector('.resourceDraftRemote .resourceDraftEdit button'))`)) {
    await evaluate(window, `document.querySelector('.resourceDraftRemote .resourceDraftEdit button').click()`);
  } else {
    await evaluate(window, `document.querySelector('.resourceDraftSource').click()`);
    await waitFor(window, `Boolean(document.querySelector('[role=menuitem]'))`);
    await evaluate(window, `document.querySelector('[role=menuitem]').click()`);
  }
}
const save = async window => {await evaluate(window, `document.querySelector('[role=dialog] button[type=submit]').click()`); await frame(window)};
const close = window => evaluate(window, `document.querySelector('[role=dialog] button[aria-label]').click()`);

export async function checkGuideRemote({electron, repository, userData}) {
  const f = await privateGitFixture(), lib = await loadGuideResources();
  const pools = [], windows = [];
  try {
    for (const locale of ['en', 'zh']) for (const theme of ['light', 'dark']) {
      electron.nativeTheme.themeSource = theme;
      let opened;
      const window = await createGuideWindow(electron, {repository, mode: 'create', locale, hidden: true,
        defaultDirectory: f.root, recent: {list: () => []}, open: async path => {opened = path},
        createClonePool: async () => {const pool = await GuideClones.create(userData, {runGit: f.run(lib.runResourceGit)}); pools.push(pool); return pool;}});
      windows.push(window); window.showInactive();
      await waitFor(window, `document.querySelector('.resourceDraft') && !document.querySelector('[aria-busy=true]')`);
      const urlLabel = locale === 'zh' ? 'Git 仓库地址' : 'Git repository URL';
      const branchLabel = locale === 'zh' ? '分支' : 'Branch';
      await openRemote(window); await waitFor(window, 'Boolean(document.querySelector("[role=dialog]"))');
      // The official Modal supplies its chrome; our boundary keeps Tab inside its controls.
      await evaluate(window, `document.querySelector('[role=dialog] button[type=submit]').focus()`);
      window.webContents.sendInputEvent({type: 'keyDown', keyCode: 'Tab'});
      window.webContents.sendInputEvent({type: 'keyUp', keyCode: 'Tab'});
      await waitFor(window, `document.activeElement === document.querySelector('[role=dialog] button[aria-label]')`);
      assert.equal(await evaluate(window, 'document.getElementById("root").inert'), true);
      await save(window);
      await waitFor(window, 'Boolean(document.querySelector("input[aria-invalid=true]"))');
      await fill(window, `input[aria-label="${urlLabel}"]`, 'https://example.com/team/repository.git');
      await fill(window, `input[aria-label="${branchLabel}"]`, 'bad..branch');
      await save(window);
      assert.equal(await evaluate(window, `document.querySelector('input[aria-label="${branchLabel}"]').getAttribute('aria-invalid')`), 'true');
      await fill(window, `input[aria-label="${branchLabel}"]`, 'feature/demo');
      writeFileSync(join(userData, `remote-dialog-${locale}-${theme}.png`), (await window.webContents.capturePage()).toPNG());
      const measures = [];
      for (const [width, height] of [[1180, 820], [420, 460]]) {
        window.setSize(width, height); await waitFor(window, `window.innerWidth <= ${width}`);
        const measure = () => evaluate(window, `(() => {const modal=document.querySelector('[role=dialog]'),body=modal.querySelector('form').parentElement;
          const input=modal.querySelector('input').getBoundingClientRect();
          return {x:input.x,width:input.width,overflow:body.scrollWidth>body.clientWidth,dialogOverflow:modal.scrollWidth>modal.clientWidth,
            bottom:modal.lastElementChild.getBoundingClientRect().bottom,viewport:innerHeight};})()`);
        const before = await measure();
        await fill(window, `input[aria-label="${urlLabel}"]`, 'invalid'); await save(window); const after = await measure();
        assert.equal(before.x, after.x); assert.equal(before.width, after.width);
        assert.equal(after.overflow || after.dialogOverflow, false); assert.ok(after.bottom <= after.viewport);
        assert.equal(await evaluate(window, `Boolean(document.querySelector('[role=dialog] [role=alert]'))`), true);
        await evaluate(window, `document.querySelector('[role=dialog] form').parentElement.scrollTop = 10000`); await frame(window);
        assert.equal((await measure()).overflow, false);
        measures.push({width, before, after});
        if (width === 420) writeFileSync(join(userData, `remote-dialog-${locale}-${theme}-narrow.png`), (await window.webContents.capturePage()).toPNG());
        await fill(window, `input[aria-label="${urlLabel}"]`, f.url);
      }
      writeFileSync(join(userData, `remote-dialog-${locale}-${theme}.json`), JSON.stringify(measures, null, 2));
      // Escape cancels edits and restores keyboard focus, without switching this empty resource to remote.
      await evaluate(window, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
      await waitFor(window, '!document.querySelector("[role=dialog]")');
      assert.equal(await evaluate(window, `document.querySelector('.resourceDraftSource').textContent`), locale === 'zh' ? '关联资源' : 'Link resource');
      assert.equal(await evaluate(window, 'document.getElementById("root").inert'), false);
      assert.equal(await evaluate(window, `document.activeElement === document.querySelector('.resourceDraftSource')`), true);
      if (locale !== 'en' || theme !== 'light') {
        if (locale === 'zh' && theme === 'dark') {
          await openRemote(window); await waitFor(window, 'Boolean(document.querySelector("[role=dialog]"))');
          await fill(window, `input[aria-label="${urlLabel}"]`, f.url);
          await save(window); await waitFor(window, `Boolean(document.querySelector('input[type=password]'))`);
          writeFileSync(join(userData, 'remote-auth-zh-dark-narrow.png'), (await window.webContents.capturePage()).toPNG());
          const pool = pools.at(-1);
          assert.equal(pool.auth.snapshot().requests.length, 1);
          window.destroy();
          await waitUntil(() => pool.closing && pool.entries.size === 0, 'closed window cleans its waiting clone');
          assert.equal(pool.auth.snapshot().requests.length, 0);
        } else window.destroy();
        continue;
      }
      window.setSize(1180, 820); await frame(window);
      await fill(window, 'input[aria-label="Project name"]', 'Remote guide');
      await openRemote(window); await waitFor(window, 'Boolean(document.querySelector("[role=dialog]"))');
      await fill(window, `input[aria-label="${urlLabel}"]`, f.url);
      await fill(window, `input[aria-label="${branchLabel}"]`, 'feature/demo');
      await save(window); await waitFor(window, `Boolean(document.querySelector('.resourceDraftRemote'))`);
      await waitFor(window, `Boolean(document.querySelector('input[type=password]'))`);
      assert.equal(await evaluate(window, `document.querySelector('.createContent>footer button:last-child').disabled`), true);
      writeFileSync(join(userData, 'remote-auth-en.png'), (await window.webContents.capturePage()).toPNG());
      const requests = f.requests;
      const userSelector = '[role=dialog] input[autocomplete=username]';
      await fill(window, userSelector, f.credential.username);
      await fill(window, '[role=dialog] input[type=password]', f.credential.password);
      await save(window); await waitFor(window, `document.querySelector('.resourceDraftStatus')?.textContent === 'Clone complete'`);
      assert.ok(f.requests > requests);
      const clonedRequests = f.requests;
      // Editing reopens the saved values. Closing it does not redownload or discard them.
      await openRemote(window); await waitFor(window, `Boolean(document.querySelector('input[aria-label="${branchLabel}"]'))`);
      assert.equal(await evaluate(window, `document.querySelector('input[aria-label="${branchLabel}"]').value`), 'feature/demo');
      await close(window); await waitFor(window, '!document.querySelector("[role=dialog]")');
      writeFileSync(join(userData, 'remote-clone-complete.png'), (await window.webContents.capturePage()).toPNG());
      await evaluate(window, `document.querySelector('.createContent>footer button:last-child').click()`);
      await waitUntil(() => opened, 'created project');
      assert.equal(f.requests, clonedRequests, 'creation must reuse the downloaded repository');
      const resource = parse(readFileSync(opened, 'utf8')).resources[1];
      assert.equal(resource.path, 'resources/Remote guide-backend');
      assert.equal(resource.branch, 'feature/demo');
      assert.equal(readFileSync(join(f.root, 'Remote guide', resource.path, 'branch.txt'), 'utf8'), 'Selected feature branch\n');
      await waitUntil(() => window.isDestroyed(), 'create window closed');
    }
  } finally {
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    await Promise.all(pools.map(pool => pool.dispose())); await f.close();
  }
}
