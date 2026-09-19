import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {readFileSync, writeFileSync} from 'node:fs';
import {parse} from 'yaml';
import {createProjectFromPlan} from '../src/app/project-bootstrap.mjs';
import {openNativeProject} from '../src/desktop-adapter/native.mjs';
import {projectStatePath} from '../src/app/project-state.mjs';

const evaluate = (window, code) => window.webContents.executeJavaScript(code);
const frame = window => evaluate(window, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
async function wait(window, expression) {
  const deadline = Date.now() + 15000;
  while (!await evaluate(window, expression)) {
    if (Date.now() > deadline) throw new Error('Timed out: ' + expression + '\n' + await evaluate(window, 'document.body.innerText'));
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  await frame(window);
}
async function fill(window, selector, value) {
  await evaluate(window, `(() => {const input=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event('input',{bubbles:true}));})()`); await frame(window);
}
const button = label => `[...document.querySelectorAll('button')].find(item => item.textContent.replace(/\\d+$/, '').trim() === ${JSON.stringify(label)})`;
async function click(window, label) {await wait(window, `Boolean(${button(label)})`); await evaluate(window, `${button(label)}.click()`); await frame(window);}

/** Real stable Host/Renderer; every project and Git mutation stays inside the supplied test directory. */
export async function checkResourceStates({electron, userData}) {
  const manifest = await createProjectFromPlan({location: userData, name: 'Resource states', templateId: 'fullstack'});
  const root = dirname(manifest), backend = join(root, 'resources/Resource states-backend');
  const git = (args, cwd = backend) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: 'pipe'}).trim();
  const project = await openNativeProject(electron, {...projectStatePath(userData, manifest), projectRoot: root,
    title: 'Resource states', locale: 'en', hidden: true, onError: console.error,
    connectTheme: host => host.setTheme('light'), close() {}, restart() {}, recover() {}});
  const window = project.window;
  window.setMinimumSize(420, 460);
  const measurements = [];
  try {
    window.showInactive();
    await project.host.updateShellSettings('locale', {preference: 'en'});
    await wait(window, `document.querySelector('.project-panel > .project-summary')?.textContent.includes('2 resources')`);
    assert.equal(await evaluate(window, `document.querySelectorAll('.project-resource-card[aria-label="Resource states"]').length`), 0);
    await click(window, 'Resources');
    assert.equal(await evaluate(window, `${button('Resources')}?.querySelector('.project-panel-count')?.textContent`), '2');
    for (const locale of ['en', 'zh']) for (const theme of ['light', 'dark']) {
      window.setSize(1180, 820); await frame(window);
      await project.host.updateShellSettings('locale', {preference: locale});
      electron.nativeTheme.themeSource = theme; await project.host.setTheme(theme);
      const labels = locale === 'zh' ? {resources: '资源', link: '关联远端', state: '需要关联远端', check: '检查更新', overview: '项目概览'}
        : {resources: 'Resources', link: 'Link remote', state: 'Link a remote', check: 'Check for updates', overview: 'Project'};
      await wait(window, `document.body.hasAttribute('data-ds-dark-theme') === ${theme === 'dark'}`);
      await wait(window, `document.querySelector('.project-panel h1')?.textContent === ${JSON.stringify(labels.resources)}`);
      await wait(window, `document.querySelectorAll('.project-resource-card').length === 2`);
      assert.deepEqual(await evaluate(window, `[...document.querySelectorAll('.project-resource-sync-label')].map(item => item.textContent)`), [labels.state, labels.state]);
      assert.equal(await evaluate(window, `[...document.querySelectorAll('.project-resource-sync-label [data-tone]')].every(item => item.dataset.tone === 'neutral')`), true);
      assert.equal(await evaluate(window, `[...document.querySelectorAll('.project-resource-card button')].some(item => item.getAttribute('aria-label')?.startsWith(${JSON.stringify(labels.check)}))`), false);
      assert.equal(await evaluate(window, `document.querySelectorAll('.project-resource-card[aria-label="Resource states"]').length`), 0);
      for (const width of [1180, 420]) {
        window.setSize(width, 820); await frame(window);
        await wait(window, `innerWidth === ${width}`);
        await click(window, labels.link);
        await wait(window, `document.querySelectorAll('[role=dialog] input').length === 2`);
        await fill(window, '[role=dialog] input', 'invalid URL');
        const size = () => evaluate(window, `(() => {const input=document.querySelector('[role=dialog] input'),r=input.getBoundingClientRect(),dialog=document.querySelector('[role=dialog]');
          return {x:r.x,width:r.width,overflow:dialog.scrollWidth>dialog.clientWidth,bodyOverflow:document.body.scrollWidth>innerWidth};})()`);
        const before = await size();
        await evaluate(window, `document.querySelector('[role=dialog] button[type=submit]').click()`);
        await wait(window, `Boolean(document.querySelector('[role=dialog] [role=alert]'))`);
        const after = await size(); assert.deepEqual(after, before); assert.equal(after.overflow || after.bodyOverflow, false);
        await fill(window, '[role=dialog] input', 'https://example.invalid/team/backend.git');
        await fill(window, '[role=dialog] input[id$="-branch"]', 'main');
        measurements.push({locale, theme, width, before, after});
        writeFileSync(join(userData, `resource-state-${locale}-${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG());
        await evaluate(window, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
        await wait(window, `!document.querySelector('[role=dialog]')`);
        assert.equal(await evaluate(window, `document.activeElement?.textContent`), labels.link);
      }
    }
    window.setSize(1180, 820); await frame(window);
    const original = readFileSync(join(backend, 'AGENT.md'), 'utf8');
    await click(window, '关联远端');
    await fill(window, '[role=dialog] input', 'https://example.invalid/team/backend.git');
    await evaluate(window, `document.querySelector('[role=dialog] button[type=submit]').click()`);
    await wait(window, `!document.querySelector('[role=dialog]') && document.querySelector('.project-resource-sync-label')?.textContent === '尚无本地提交'`);
    assert.equal(git(['remote', 'get-url', 'origin']), 'https://example.invalid/team/backend.git');
    const branch = git(['symbolic-ref', '--short', 'HEAD']);
    assert.equal(git(['config', `branch.${branch}.merge`]), `refs/heads/${branch}`);
    assert.equal(git(['remote'], root), '');
    assert.equal(readFileSync(join(backend, 'AGENT.md'), 'utf8'), original);
    assert.equal(parse(readFileSync(manifest, 'utf8')).resources[1].url, 'https://example.invalid/team/backend.git');
    git(['add', 'AGENT.md']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'fixture']);
    await wait(window, `Boolean(document.querySelector('button[aria-label="检查更新: Resource states-backend"]'))`);
    // Empty resource pages/counts still exclude the retained root binding.
    for (const id of ['backend', 'web']) {
      const data = await (await project.host.request('/api/project/resources')).json();
      const response = await project.host.request('/api/project/resources', {method: 'POST', headers: {'content-type': 'application/json', origin: new URL(project.host.url).origin},
        body: JSON.stringify({action: 'remove', id, expectedRevision: data.revision})});
      assert.equal(response.status, 200);
    }
    await wait(window, `document.querySelector('.project-panel')?.textContent.includes('暂无资源') && !document.querySelector('.project-resource-card')`);
    await click(window, '刷新');
    assert.equal((await (await project.host.request('/api/project/resources')).json()).resources.length, 0);
    assert.equal(parse(readFileSync(manifest, 'utf8')).resources[0].id, 'root');
    writeFileSync(join(userData, 'resource-states-empty.png'), (await window.webContents.capturePage()).toPNG());
    return {measurements, manifest};
  } finally {await project.close();}
}
