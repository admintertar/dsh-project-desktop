import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {createServer as createHttpsServer} from 'node:https';
import {dirname, join} from 'node:path';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
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
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event('input',{bubbles:true}));})()`); await frame(window);
}
const button = label => `[...document.querySelectorAll('button')].find(item => item.textContent.replace(/\\d+$/, '').trim() === ${JSON.stringify(label)})`;
async function click(window, label) {await wait(window, `Boolean(${button(label)})`); await evaluate(window, `${button(label)}.click()`); await frame(window);}
/** The Host accepts a sync action asynchronously and answers before Git has run, so wait for Git. */
async function waitGit(read, expected) {
  const deadline = Date.now() + 20000;
  let actual = read();
  while (actual !== expected) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for Git: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    await new Promise(resolve => setTimeout(resolve, 100));
    actual = read();
  }
}
/** Icon actions carry their meaning in the accessible name, never in the button text. */
const actionSelector = label => `button[aria-label="${label}: Resource states-backend"]`;
async function clickAction(window, label) {await wait(window, `Boolean(document.querySelector('${actionSelector(label)}'))`);
  await evaluate(window, `document.querySelector('${actionSelector(label)}').click()`); await frame(window);}

/** Real stable Host/Renderer; every project and Git mutation stays inside the supplied test directory. */
export async function checkResourceStates({electron, userData}) {
  const manifest = await createProjectFromPlan({location: userData, name: 'Resource states', templateId: 'fullstack'});
  const root = dirname(manifest), backend = join(root, 'resources/Resource states-backend');
  const git = (args, cwd = backend) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: 'pipe'}).trim();
  // Windows pins the browse directory-picker backend, so the panel asks the Desktop runtime for a
  // directory instead of the native seam. Replace only the OS chooser, through a prototype overlay
  // that leaves every other Electron face untouched: the Host, the runtime RPC bridge, the panel and
  // every Git call stay real, and the chooser answers with a real directory.
  const picked = join(root, 'picked-resource');
  // Each chooser request answers with the directory the running case is about to pick.
  let nextPick = picked;
  let chooser = electron;
  if (process.platform === 'win32') {
    mkdirSync(picked, {recursive: true});
    writeFileSync(join(picked, 'README.md'), '# picked resource\n');
    chooser = Object.create(electron, {dialog: {value: {...electron.dialog,
      showOpenDialog: async () => ({canceled: false, filePaths: [nextPick]})}}});
  }
  const project = await openNativeProject(chooser, {...projectStatePath(userData, manifest), projectRoot: root,
    title: 'Resource states', locale: 'en', hidden: true, onError: console.error,
    connectTheme: host => host.setTheme('light'), close() {}, restart() {}, recover() {}});
  const window = project.window;
  window.setMinimumSize(420, 460);
  const measurements = [];
  let remoteServer;
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
        await clickAction(window, labels.link);
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
        assert.equal(await evaluate(window, `document.activeElement?.getAttribute('aria-label')`), `${labels.link}: Resource states-backend`);
      }
    }
    window.setSize(1180, 820); await frame(window);
    const original = readFileSync(join(backend, 'AGENT.md'), 'utf8');
    // A reachable HTTPS remote is the only way the product can confirm a comparison: it accepts
    // only https/ssh URLs, and a failed check leaves every action blocked as an error.
    const remoteRoot = join(userData, 'git-remote'); mkdirSync(remoteRoot, {recursive: true});
    const remote = join(remoteRoot, 'backend.git');
    const remoteKey = join(userData, 'remote-key.pem'), remoteCertificate = join(userData, 'remote.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', remoteKey, '-out', remoteCertificate,
      '-days', '1', '-nodes', '-subj', '/CN=127.0.0.1'], {stdio: 'pipe'});
    execFileSync('git', ['init', '--bare', '--quiet', remote], {stdio: 'pipe'});
    // The product pushes over smart HTTP, which a bare repository leaves disabled by default.
    execFileSync('git', ['--git-dir', remote, 'config', 'http.receivepack', 'true'], {stdio: 'pipe'});
    git(['config', 'user.name', 'Fixture']);
    git(['config', 'user.email', 'fixture@example.invalid']);
    // The fixture environment holds no trusted CA for a loopback certificate.
    git(['config', 'http.sslVerify', 'false']);
    const branch = git(['symbolic-ref', '--short', 'HEAD']);
    // Give the remote the same commit first, so associating ends in a clean comparison.
    git(['add', 'AGENT.md']);
    git(['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'fixture']);
    git(['push', '--quiet', remote, branch]);
    // Serve the remote over loopback; the product's Git calls are asynchronous, so this server
    // keeps answering while the Host runs them.
    remoteServer = createHttpsServer({key: readFileSync(remoteKey), cert: readFileSync(remoteCertificate)}, (request, response) => {
      const target = new URL(request.url, 'https://127.0.0.1');
      const cgi = spawn('git', ['http-backend'], {env: {...process.env, GIT_PROJECT_ROOT: remoteRoot, GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: target.pathname, QUERY_STRING: target.search.slice(1), REQUEST_METHOD: request.method,
        CONTENT_TYPE: request.headers['content-type'] ?? '', CONTENT_LENGTH: request.headers['content-length'] ?? '',
        REMOTE_ADDR: '127.0.0.1', REMOTE_USER: '', GIT_PROTOCOL: request.headers['git-protocol'] ?? ''}});
      request.pipe(cgi.stdin);
      let head = Buffer.alloc(0), sent = false;
      cgi.stdout.on('data', chunk => {
        if (sent) return response.write(chunk);
        head = Buffer.concat([head, chunk]);
        const end = head.indexOf('\r\n\r\n'); if (end < 0) return;
        sent = true;
        let status = 200;
        for (const line of head.subarray(0, end).toString('utf8').split('\r\n')) {
          const index = line.indexOf(':'); if (index < 0) continue;
          const name = line.slice(0, index), value = line.slice(index + 1).trim();
          if (name.toLowerCase() === 'status') status = Number(value.split(' ')[0]); else response.setHeader(name, value);
        }
        response.writeHead(status);
        const rest = head.subarray(end + 4); if (rest.length) response.write(rest);
      });
      cgi.stdout.on('end', () => response.end());
      cgi.on('error', () => {if (!sent) response.writeHead(500); response.end();});
    });
    await new Promise((resolve, reject) => {remoteServer.once('error', reject); remoteServer.listen(0, '127.0.0.1', resolve)});
    const remoteUrl = `https://127.0.0.1:${remoteServer.address().port}/backend.git`;
    await clickAction(window, '关联远端');
    await fill(window, '[role=dialog] input', remoteUrl);
    await evaluate(window, `document.querySelector('[role=dialog] button[type=submit]').click()`);
    await wait(window, `!document.querySelector('[role=dialog]')`);
    assert.equal(git(['remote', 'get-url', 'origin']), remoteUrl);
    assert.equal(git(['config', `branch.${branch}.merge`]), `refs/heads/${branch}`);
    assert.equal(git(['remote'], root), '');
    assert.equal(readFileSync(join(backend, 'AGENT.md'), 'utf8'), original);
    assert.equal(parse(readFileSync(manifest, 'utf8')).resources[1].url, remoteUrl);
    // A real check must succeed before the card offers any action at all.
    await evaluate(window, `document.querySelector('button[aria-label="检查更新: Resource states-backend"]').click()`);
    await wait(window, `document.querySelector('.project-resource-sync-label')?.textContent === '已是最新'`);

    // --- Resource Git actions: commit, push and branch switching through the real UI ---
    const copy = {
      zh: {commit: '提交改动', push: '推送提交', cancel: '取消', message: '提交信息', changes: '将要提交的改动',
        fileSuffix: '个文件', modified: '已修改', required: '请填写提交信息。', current: '当前分支', clean: '已是最新'},
      en: {commit: 'Commit changes', push: 'Push commits', cancel: 'Cancel', message: 'Commit message', changes: 'Changes to commit',
        fileSuffix: 'files', modified: 'Modified', required: 'Enter a commit message.', current: 'Current branch', clean: 'Up to date'}
    };
    const action = (locale, kind) => actionSelector(copy[locale][kind]);
    const dialogButton = label => `[...document.querySelectorAll('[role=dialog] button')].find(item => item.textContent.trim() === ${JSON.stringify(label)})`;
    // A dirty tree offers commit on the card; push stays absent until a local commit exists.
    writeFileSync(join(backend, 'AGENT.md'), `${original}\ncommitted from the panel\n`);
    await wait(window, `Boolean(document.querySelector('${action('zh', 'commit')}'))`);
    assert.equal(await evaluate(window, `Boolean(document.querySelector('${action('zh', 'push')}'))`), false);
    // Cancel closes the dialog and returns focus to the action that opened it.
    await evaluate(window, `document.querySelector('${action('zh', 'commit')}').click()`);
    await wait(window, `Boolean(document.querySelector('[role=dialog] textarea'))`);
    await evaluate(window, `${dialogButton(copy.zh.cancel)}.click()`);
    await wait(window, `!document.querySelector('[role=dialog]')`);
    assert.equal(await evaluate(window, `document.activeElement?.getAttribute('aria-label')`), `${copy.zh.commit}: Resource states-backend`);
    // Both locales name the dialog, its field and every change it would record.
    for (const locale of ['zh', 'en']) {
      await project.host.updateShellSettings('locale', {preference: locale});
      await wait(window, `Boolean(document.querySelector('${action(locale, 'commit')}'))`);
      await evaluate(window, `document.querySelector('${action(locale, 'commit')}').click()`);
      await wait(window, `Boolean(document.querySelector('[role=dialog] textarea'))`);
      // The change list arrives from its own read, so wait for it before asserting on it.
      await wait(window, `Boolean(document.querySelector('[role=dialog] .project-commit-changes-head'))`);
      assert.equal(await evaluate(window, `document.querySelector('[role=dialog] textarea').getAttribute('aria-label')`), `${copy[locale].message}: Resource states-backend`);
      assert.equal(await evaluate(window, `document.querySelector('[role=dialog] .project-commit-changes-head .project-setting-title').textContent`), copy[locale].changes);
      const fileCount = await evaluate(window, `document.querySelectorAll('[role=dialog] .project-commit-file').length`);
      assert.equal(await evaluate(window, `document.querySelector('[role=dialog] .project-commit-changes-head .project-setting-description').textContent`), `${fileCount} ${copy[locale].fileSuffix}`);
      assert.equal(await evaluate(window, `(() => {const row=[...document.querySelectorAll('[role=dialog] .project-commit-file')].find(item => item.querySelector('code').textContent === 'AGENT.md');
        return row?.querySelector('.project-commit-status').getAttribute('aria-label');})()`), copy[locale].modified);
      if (locale === 'zh') {
        // The primary action stays enabled so an empty message reports itself inline.
        await evaluate(window, `${dialogButton(copy.zh.commit)}.click()`);
        await wait(window, `document.querySelector('[role=dialog] [role=alert]')?.textContent === ${JSON.stringify(copy.zh.required)}`);
        assert.equal(git(['log', '-1', '--format=%s']), 'fixture');
        await evaluate(window, `${dialogButton(copy.zh.cancel)}.click()`);
        await wait(window, `!document.querySelector('[role=dialog]')`);
      }
    }
    // The message reaches Git, the tree turns clean and the card offers push.
    await fill(window, '[role=dialog] textarea', 'panel commit');
    await evaluate(window, `${dialogButton(copy.en.commit)}.click()`);
    await wait(window, `!document.querySelector('[role=dialog]')`);
    // The dialog closes on acceptance, so the commit itself may still be landing in Git.
    await waitGit(() => git(['log', '-1', '--format=%s']), 'panel commit');
    assert.equal(git(['status', '--porcelain']), '');
    // Push needs a checked comparison, so ask for one before the card can offer it.
    await evaluate(window, `document.querySelector('button[aria-label="Check for updates: Resource states-backend"]').click()`);
    await wait(window, `Boolean(document.querySelector('${action('en', 'push')}'))`);
    // Push fast-forwards the real remote and the card stops reporting a local commit.
    const pushed = git(['rev-parse', 'HEAD']);
    await evaluate(window, `document.querySelector('${action('en', 'push')}').click()`);
    await wait(window, `document.querySelector('.project-resource-sync-label')?.textContent === ${JSON.stringify(copy.en.clean)}`);
    assert.equal(git(['rev-parse', 'HEAD']), pushed);
    await waitGit(() => execFileSync('git', ['--git-dir', remote, 'rev-parse', branch], {encoding: 'utf8'}).trim(), pushed);
    // Branch switching lives in the details dialog and moves the real HEAD.
    git(['branch', 'feature']);
    await evaluate(window, `document.querySelector('button[aria-label="Resource details: Resource states-backend"]').click()`);
    await wait(window, `Boolean(document.querySelector('[role=dialog] .project-select-trigger[aria-label="${copy.en.current}: ${branch}"]'))`);
    await evaluate(window, `document.querySelector('[role=dialog] .project-select-trigger').click()`);
    await wait(window, `document.querySelectorAll('[role=menuitem]').length === 2`);
    await evaluate(window, `[...document.querySelectorAll('[role=menuitem]')].find(item => item.textContent === 'feature').click()`);
    await wait(window, `!document.querySelector('[role=menu]')`);
    await wait(window, `document.querySelector('[role=dialog] .project-select-trigger')?.getAttribute('aria-label') === ${JSON.stringify(`${copy.en.current}: feature`)}`);
    await waitGit(() => git(['symbolic-ref', '--short', 'HEAD']), 'feature');
    // Local changes disable switching instead of being stashed behind the user's back.
    writeFileSync(join(backend, 'AGENT.md'), `${original}\ndirty for switch\n`);
    await wait(window, `document.querySelector('[role=dialog] .project-select-trigger')?.disabled === true`);
    // The details dialog stays inside a narrow window without horizontal overflow.
    window.setSize(420, 820); await frame(window);
    await wait(window, `innerWidth === 420`);
    assert.equal(await evaluate(window, `(() => {const dialog=document.querySelector('[role=dialog]');
      return dialog.scrollWidth > dialog.clientWidth || document.body.scrollWidth > innerWidth;})()`), false);
    writeFileSync(join(userData, 'resource-git-actions.png'), (await window.webContents.capturePage()).toPNG());
    await evaluate(window, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await wait(window, `!document.querySelector('[role=dialog]')`);
    // Leave the fixture as the later removal step expects it: original branch, clean tree, Chinese UI.
    git(['checkout', '--', 'AGENT.md']);
    git(['switch', '--quiet', branch]);
    await project.host.updateShellSettings('locale', {preference: 'zh'});
    await wait(window, `document.querySelector('.project-panel h1')?.textContent === '资源'`);

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

    // --- Windows only: the launcher pins the browse backend, so a local resource must stay pickable ---
    // macOS/Linux keep the official native seam, whose chooser is a separate OS process this harness
    // cannot drive; the desktop-runtime path exists exactly for the Windows composition.
    if (process.platform === 'win32') {
      await click(window, '添加资源');
      await wait(window, `Boolean(document.querySelector('[role=dialog] .project-resource-directory'))`);
      // The panel must offer the local flow instead of refusing it with the native-picker notice.
      assert.equal(await evaluate(window, `document.querySelector('[role=dialog]').textContent
        .includes('当前环境不支持原生文件夹选择')`), false);
      const choose = `[...document.querySelectorAll('[role=dialog] button')].find(item => item.textContent.trim() === '选择目录…')`;
      assert.equal(await evaluate(window, `Boolean(${choose}) && ${choose}.disabled === false`), true);
      await evaluate(window, `${choose}.click()`);
      await wait(window, `document.querySelector('[role=dialog] .project-resource-directory code')?.textContent.endsWith('picked-resource')`);
      assert.equal(await evaluate(window, `document.querySelector('[role=dialog] input[id$="-name"]')?.value`), 'picked-resource');
      writeFileSync(join(userData, 'resource-add-local.png'), (await window.webContents.capturePage()).toPNG());
      await evaluate(window, `document.querySelector('[role=dialog] button[type=submit]').click()`);
      await wait(window, `!document.querySelector('[role=dialog]')`);
      await wait(window, `Boolean(document.querySelector('.project-resource-card'))`);
      const resources = parse(readFileSync(manifest, 'utf8')).resources;
      assert.equal(resources.some(item => item.name === 'picked-resource' && item.type === 'local'), true);
      writeFileSync(join(userData, 'resource-add-local-saved.png'), (await window.webContents.capturePage()).toPNG());

      // Binding an existing resource must reach the same chooser instead of refusing the local flow.
      const rebound = join(root, 'rebound-resource');
      mkdirSync(rebound, {recursive: true});
      writeFileSync(join(rebound, 'README.md'), '# rebound resource\n');
      nextPick = rebound;
      await evaluate(window, `document.querySelector('button[aria-label="绑定目录: picked-resource"]').click()`);
      await wait(window, `Boolean(document.querySelector('[role=dialog] .project-resource-directory'))`);
      assert.equal(await evaluate(window, `document.querySelector('[role=dialog]').textContent
        .includes('当前环境不支持原生文件夹选择')`), false);
      assert.equal(await evaluate(window, `Boolean(${choose}) && ${choose}.disabled === false`), true);
      await evaluate(window, `${choose}.click()`);
      await wait(window, `document.querySelector('[role=dialog] .project-resource-directory code')?.textContent.endsWith('rebound-resource')`);
      await evaluate(window, `document.querySelector('[role=dialog] button[type=submit]').click()`);
      await wait(window, `!document.querySelector('[role=dialog]')`);
      await wait(window, `document.querySelector('.project-panel')?.textContent.includes('rebound-resource')`);
      assert.equal(JSON.stringify(await (await project.host.request('/api/project/resources')).json()).includes('rebound-resource'), true);

      // Importing a skill folder must use the same desktop-runtime chooser.
      const skill = join(root, 'picked-skill');
      mkdirSync(skill, {recursive: true});
      writeFileSync(join(skill, 'SKILL.md'), '---\nname: picked-skill\ndescription: Windows picker fixture\n---\nUse this skill.');
      nextPick = skill;
      // Panel navigation lives in the sidebar, which the earlier narrow-window pass collapsed.
      window.setSize(1180, 820); await frame(window);
      await wait(window, `innerWidth === 1180`);
      await click(window, '技能');
      // The toolbar only enables import once the Host reports a reachable chooser.
      await wait(window, `(() => {const item = [...document.querySelectorAll('.project-capability-toolbar button')]
        .find(button => button.textContent.trim() === '导入技能'); return Boolean(item) && item.disabled === false;})()`);
      assert.equal(await evaluate(window, `document.querySelector('.project-capability-toolbar').textContent
        .includes('当前环境不支持原生文件夹选择')`), false);
      await click(window, '导入技能');
      await wait(window, `Boolean(document.querySelector('[role=dialog]'))`);
      await click(window, '选择技能文件夹');
      await wait(window, `!document.querySelector('[role=dialog]')`);
      await wait(window, `document.querySelector('.project-panel')?.textContent.includes('picked-skill')`);
      writeFileSync(join(userData, 'resource-bind-and-skill.png'), (await window.webContents.capturePage()).toPNG());
    }
    return {measurements, manifest};
  } finally {remoteServer?.close(); await project.close();}
}
