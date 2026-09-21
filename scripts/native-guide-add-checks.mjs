import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {parse} from 'yaml';
import {createGuideWindow} from '../src/windows/guide-window.mjs';
import {GuideClones} from '../src/app/guide-clones.mjs';
import {loadGuideResources} from '../src/desktop-adapter/stable/guide-resources.mjs';
import {privateGitFixture, waitUntil} from '../tests/fixtures/private-git.mjs';

const evaluate = (window, code) => window.webContents.executeJavaScript(code);
const frame = window => evaluate(window, 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
async function wait(window, code) {await waitUntil(() => evaluate(window, code), code); await frame(window)}
async function click(window, selector) {await evaluate(window, `document.querySelector(${JSON.stringify(selector)}).click()`); await frame(window)}
async function fill(window, selector, value) {
  await evaluate(window, `(() => {const input=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event('input',{bubbles:true}));})()`); await frame(window);
}
async function select(window, index, option) {
  await evaluate(window, `document.querySelectorAll('.addResourceForm .project-select-trigger')[${index}].click()`);
  await wait(window, `Boolean(document.querySelector('[role=menuitem]'))`);
  await evaluate(window, `document.querySelectorAll('[role=menuitem]')[${option}].click()`); await frame(window);
}
const save = window => click(window, '[role=dialog] button[type=submit]');
const close = window => click(window, '[role=dialog] button[aria-label]');
async function open(window) {await click(window, '.resourceEditorHeading button'); await wait(window, `Boolean(document.querySelector('.addResourceForm'))`)}

export async function checkGuideAdd({electron, repository, userData}) {
  const fixture = await privateGitFixture(), library = await loadGuideResources();
  const seed = join(fixture.root, 'seed'); fixture.git(['remote', 'add', 'origin', fixture.url], seed);
  const gitConfig = readFileSync(join(seed, '.git/config'), 'utf8');
  const pools = [], windows = [];
  try {
    for (const locale of ['zh', 'en']) for (const theme of ['light', 'dark']) {
      const poolCount = pools.length;
      electron.nativeTheme.themeSource = theme;
      let opened, cancelled = false;
      const window = await createGuideWindow({...electron, dialog: {...electron.dialog,
        showOpenDialog: async () => cancelled ? {canceled: true, filePaths: []} : {canceled: false, filePaths: [seed]}}},
      {repository, locale, mode: 'create', hidden: true, recent: {list: () => []}, defaultDirectory: fixture.root,
        open: async path => {opened = path}, createClonePool: async () => {
          const pool = await GuideClones.create(userData, {runGit: fixture.run(library.runResourceGit)}); pools.push(pool); return pool;
        }});
      windows.push(window); window.showInactive();
      await wait(window, `Boolean(document.querySelector('.resourceDraft')) && !document.querySelector('[aria-busy=true]')`);
      const compositions = locale === 'zh' ? [
        ['fullstack', 'Web 应用', ['服务端', 'Web 前端']], ['admin', '管理系统', ['服务端', '管理后台']],
        ['miniapp', '小程序项目', ['服务端', '小程序']], ['app', '移动应用', ['服务端', '移动端']],
        ['desktop', '桌面应用', ['桌面端']], ['empty', '空项目', []],
      ] : [
        ['fullstack', 'Web application', ['Backend', 'Web frontend']], ['admin', 'Admin system', ['Backend', 'Admin panel']],
        ['miniapp', 'Mini-program project', ['Backend', 'Mini program']], ['app', 'Mobile application', ['Backend', 'Mobile app']],
        ['desktop', 'Desktop application', ['Desktop app']], ['empty', 'Empty project', []],
      ];
      for (const [id, title, roles] of compositions) {
        window.setSize(1180, 820); await wait(window, 'Math.abs(innerWidth - 1180) <= 2');
        await click(window, `.templateItem[data-template-id="${id}"]`);
        assert.equal(await evaluate(window, `document.querySelector('.toolbar h1').textContent`), title);
        assert.deepEqual(await evaluate(window, `Array.from(document.querySelectorAll('.resourceDraftRole'), el => el.textContent)`), roles);
        for (const [width, height] of [[1180, 820], [420, 460]]) {
          window.setSize(width, height); await wait(window, `Math.abs(innerWidth - ${width}) <= 2`);
          if (width === 420) {
            const trigger = '.createTemplateSelect button';
            const alternate = compositions.find(item => item[0] !== id);
            await click(window, trigger); await wait(window, `document.querySelectorAll('[role=menuitem]').length === 6`);
            await evaluate(window, `[...document.querySelectorAll('[role=menuitem]')].find(item=>item.textContent===${JSON.stringify(alternate[1])}).click()`);
            await wait(window, `!document.querySelector('[role=menu]')`);
            assert.equal(await evaluate(window, `document.querySelector('.toolbar h1').textContent`), alternate[1]);
            assert.deepEqual(await evaluate(window, `Array.from(document.querySelectorAll('.resourceDraftRole'), el => el.textContent)`), alternate[2]);
            window.focus();
            await evaluate(window, `document.querySelector(${JSON.stringify(trigger)}).focus()`); await frame(window);
            // Electron uses accelerator names; "Down" becomes DOM key "ArrowDown".
            window.webContents.sendInputEvent({type: 'keyDown', keyCode: 'Down'});
            window.webContents.sendInputEvent({type: 'keyUp', keyCode: 'Down'});
            await wait(window, `document.querySelectorAll('[role=menuitem]').length === 6`);
            await evaluate(window, `[...document.querySelectorAll('[role=menuitem]')].find(item=>item.textContent===${JSON.stringify(title)}).click()`);
            await wait(window, `!document.querySelector('[role=menu]')`);
            assert.equal(await evaluate(window, `document.activeElement === document.querySelector(${JSON.stringify(trigger)})`), true);
            assert.equal(await evaluate(window, `document.querySelector(${JSON.stringify(trigger)}).textContent`), title);
            assert.deepEqual(await evaluate(window, `Array.from(document.querySelectorAll('.resourceDraftRole'), el => el.textContent)`), roles);
          }
          const layout = await evaluate(window, `(() => {const body=document.querySelector('.guideBody'),nav=document.querySelector('.createNav');
            body.scrollTop=body.scrollHeight; return {overflow:body.scrollWidth>body.clientWidth||nav.scrollWidth>nav.clientWidth,
              bodyHeight:body.clientHeight, footer:document.querySelector('.createContent>footer').getBoundingClientRect().bottom,
              navBottom:nav.querySelector('.templateItem:last-child').getBoundingClientRect().bottom, height:innerHeight};})()`);
          assert.equal(layout.overflow, false); assert.ok(layout.bodyHeight >= 120);
          assert.ok(layout.footer <= layout.height); assert.ok(layout.navBottom <= layout.height);
          await frame(window);
          if (['admin', 'desktop', 'empty'].includes(id)) {
            writeFileSync(join(userData, `composition-${id}-${locale}-${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG());
          }
        }
      }
      window.setSize(1180, 820); await wait(window, 'Math.abs(innerWidth - 1180) <= 2');
      assert.equal(await evaluate(window, `document.querySelectorAll('.resourceEditor button').length`), 1);
      assert.equal(await evaluate(window, `Boolean(document.querySelector('.resourceGrid'))`), false);
      const label = locale === 'zh' ? {name: '名称', url: '仓库地址', path: '项目内目录', branch: '初始分支', project: '项目名称'}
        : {name: 'Name', url: 'Repository URL', path: 'Project directory', branch: 'Initial branch', project: 'Project name'};
      const input = key => `.addResourceForm input[aria-label="${label[key]}"]`;
      await fill(window, `input[aria-label="${label.project}"]`, `Add-${locale}-${theme}`);
      // Cancel from the resource heading leaves no placeholder card.
      await open(window);
      assert.equal(await evaluate(window, `document.querySelectorAll('.resourceDraft').length`), 0);
      assert.equal(await evaluate(window, `document.querySelector('[role=dialog] button[type=submit]').disabled`), true);
      await close(window); await wait(window, `!document.querySelector('[role=dialog]')`);
      await open(window); await click(window, '.project-resource-directory button');
      await wait(window, `document.querySelector(${JSON.stringify(input('name'))}).value === 'seed'`);
      assert.equal(await evaluate(window, `document.querySelectorAll('.addResourceForm .project-select-trigger').length`), 2);
      // A picked Git working tree preselects Git instead of waiting for a manual type change.
      assert.equal(await evaluate(window, `document.querySelectorAll('.addResourceForm .project-select-trigger')[1].textContent`),
        locale === 'zh' ? 'Git 仓库' : 'Git repository');
      await select(window, 1, 1);
      await fill(window, input('name'), 'Shared / library');
      cancelled = true; await click(window, '.project-resource-directory button'); cancelled = false;
      assert.equal(await evaluate(window, `document.querySelector(${JSON.stringify(input('name'))}).value`), 'Shared / library');
      writeFileSync(join(userData, `add-local-${locale}-${theme}.png`), (await window.webContents.capturePage()).toPNG());
      await save(window); await wait(window, `!document.querySelector('[role=dialog]') && document.querySelectorAll('.resourceDraft').length === 1`);
      assert.equal(await evaluate(window, `document.querySelectorAll('.resourceDraftRole').length`), 0);
      await open(window); await click(window, '.project-resource-directory button');
      await wait(window, `Boolean(document.querySelector('.addResourceForm [role=alert]'))`);
      assert.equal(await evaluate(window, `document.querySelector('[role=dialog] button[type=submit]').disabled`), true);
      await close(window); await open(window); await select(window, 0, 1);
      await fill(window, input('url'), fixture.url);
      assert.equal(await evaluate(window, `document.querySelector(${JSON.stringify(input('name'))}).value`), 'private');
      assert.equal(await evaluate(window, `document.querySelector(${JSON.stringify(input('path'))}).value`), 'resources/private');
      await fill(window, input('name'), 'Remote / API'); await fill(window, input('path'), 'resources/service');
      await fill(window, input('url'), fixture.url + '-edit'); await fill(window, input('url'), fixture.url);
      assert.equal(await evaluate(window, `document.querySelector(${JSON.stringify(input('name'))}).value`), 'Remote / API');
      assert.equal(await evaluate(window, `document.querySelector(${JSON.stringify(input('path'))}).value`), 'resources/service');
      assert.equal(await evaluate(window, `document.querySelector('.project-settings-card-header').getAttribute('aria-expanded')`), 'false');
      await click(window, '.project-settings-card-header'); await fill(window, input('branch'), 'feature/demo');
      const measurements = [];
      for (const [width, height] of [[1180, 820], [420, 460]]) {
        window.setSize(width, height); await wait(window, `Math.abs(innerWidth - ${width}) <= 2`);
        const measure = () => evaluate(window, `(() => {const form=document.querySelector('.addResourceForm'),modal=form.closest('[role=dialog]'),body=form.parentElement,
          input=form.querySelector('input').getBoundingClientRect();return {x:input.x,width:input.width,overflow:body.scrollWidth>body.clientWidth||modal.scrollWidth>modal.clientWidth,
            footerBottom:modal.lastElementChild.getBoundingClientRect().bottom,height:innerHeight};})()`);
        const before = await measure();
        await fill(window, input('path'), '../outside'); await save(window);
        await wait(window, `Boolean(document.querySelector('.addResourceForm [role=alert]'))`);
        const after = await measure(); assert.equal(before.x, after.x); assert.equal(before.width, after.width);
        assert.equal(after.overflow, false); assert.ok(after.footerBottom <= after.height);
        await fill(window, input('path'), 'resources/service');
        await evaluate(window, `document.querySelector('.addResourceForm').parentElement.scrollTop=0`); await frame(window);
        await click(window, '.addResourceForm .project-select-trigger'); await wait(window, `Boolean(document.querySelector('[role=menuitem]'))`);
        await evaluate(window, `document.querySelector('[role=menuitem]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
        await wait(window, `!document.querySelector('[role=menu]') && Boolean(document.querySelector('.addResourceForm'))`);
        await evaluate(window, `document.querySelector('.addResourceForm').parentElement.scrollTop=10000`); await frame(window);
        assert.equal((await measure()).overflow, false);
        measurements.push({width,before,after});
        writeFileSync(join(userData, `add-git-${locale}-${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG());
      }
      writeFileSync(join(userData, `add-layout-${locale}-${theme}.json`), JSON.stringify(measurements,null,2));
      await fill(window, input('branch'), 'bad..branch'); await save(window);
      await wait(window, `Boolean(document.querySelector('.addResourceForm [role=alert]'))`);
      assert.equal(pools.length, poolCount, 'invalid drafts must not start a clone');
      await fill(window, input('branch'), 'feature/demo'); window.setSize(1180,820); await frame(window);
      await evaluate(window, `document.querySelector('.addResourceForm').parentElement.scrollTop=0`); await frame(window);
      writeFileSync(join(userData, `add-git-${locale}-${theme}.png`), (await window.webContents.capturePage()).toPNG());
      await save(window); await wait(window, `document.querySelectorAll('.resourceDraft').length === 2 && !document.querySelector('.addResourceForm')`);
      await wait(window, `Boolean(document.querySelector('input[type=password]'))`);
      await fill(window, '[role=dialog] input[autocomplete=username]', fixture.credential.username);
      await fill(window, '[role=dialog] input[type=password]', fixture.credential.password);
      await save(window); await wait(window, `[...document.querySelectorAll('.resourceDraftStatus')].some(s=>s.textContent===${JSON.stringify(locale==='zh'?'克隆完成':'Clone complete')})`);
      // Editing the new card preserves its explicitly chosen target and completed clone.
      await click(window, '.resourceDraftRemote .resourceDraftEdit button'); await wait(window, `Boolean(document.querySelector('.remoteRepositoryForm'))`);
      await save(window); await wait(window, `!document.querySelector('[role=dialog]')`);
      assert.equal(await evaluate(window, `document.querySelectorAll('.resourceDraft')[1].querySelector('.resourceDraftPath>span').textContent`), 'resources/service');
      const requests = fixture.requests;
      await click(window, '.createContent>footer button:last-child'); await waitUntil(()=>opened,'project created from imports');
      const definition = parse(readFileSync(opened,'utf8'));
      assert.equal(definition.resources[1].name,'Shared / library'); assert.equal(definition.resources[1].type,'git');
      assert.equal(definition.resources[1].url,fixture.url);
      assert.equal(definition.resources[2].name,'Remote / API'); assert.equal(definition.resources[2].path,'resources/service');
      assert.equal(definition.resources[2].branch,'feature/demo');
      assert.equal(readFileSync(join(fixture.root,`Add-${locale}-${theme}`,'resources/service/branch.txt'),'utf8'),'Selected feature branch\n');
      assert.equal(fixture.requests,requests); assert.equal(readFileSync(join(seed,'.git/config'),'utf8'),gitConfig);
      await waitUntil(()=>window.isDestroyed(),'creation window closes');
    }
  } finally {
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    await Promise.all(pools.map(pool=>pool.dispose())); await fixture.close();
  }
}
