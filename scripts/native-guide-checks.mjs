import assert from 'node:assert/strict';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {createGuideWindow} from '../src/windows/guide-window.mjs';

async function waitFor(window, expression) {
  return window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 8000;
    const check = () => {if (${expression}) return requestAnimationFrame(resolve);
      if (Date.now() > deadline) return reject(new Error(${JSON.stringify(expression)} + '\\n\\n' + document.body.innerText)); setTimeout(check, 50)}; check();
  })`);
}

/** Closing destroys the renderer, so its executeJavaScript reply may never arrive. */
async function clickAndWaitForClose(window, selector) {
  let timer;
  const closed = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Window did not close: ${window.getTitle()}`)), 10000);
    window.once('closed', resolve);
  });
  try {
    await Promise.race([closed, window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`)]);
    await closed;
  } finally {clearTimeout(timer)}
}

/** Verify the application's real entry points share one window, preserving an in-progress draft. */
export async function checkProjectCreateEntryPoints({electron, guide}) {
  await guide.webContents.executeJavaScript(`document.querySelector('.actions button[data-guide-action=new]').click()`);
  await waitFor(guide, "!document.querySelector('section[aria-busy=\"true\"]')");
  const createWindows = () => electron.BrowserWindow.getAllWindows().filter(item => item.webContents.getURL().endsWith('?mode=create'));
  assert.equal(createWindows().length, 1);
  const window = createWindows()[0];
  try {
    await waitFor(window, "document.querySelector('.templateItem') && document.querySelector('.setting')");
    await window.webContents.executeJavaScript(`(() => {const input = document.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, 'Draft'); input.dispatchEvent(new Event('input', {bubbles:true}))})()`);
    const menuItems = electron.Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items ?? []);
    // Windows windows can never show a native menu bar, so the File entries deliberately register
    // no accelerator there and window-accelerators.mjs owns those chords instead. Match the label
    // and treat the accelerator only as an extra identifier on platforms that do register it.
    const newProject = menuItems.find(item => item.accelerator === 'CmdOrCtrl+Shift+N')
      ?? menuItems.find(item => /^(新建项目…|New Project…)$/.test(item.label));
    assert.ok(newProject, `application menu: ${JSON.stringify(menuItems.map(item => ({label: item.label, accelerator: item.accelerator})))}`);
    newProject.click();
    await guide.webContents.executeJavaScript(`window.projectGuide.invoke('new')`);
    assert.equal(createWindows().length, 1);
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('input').value`), 'Draft');
    assert.equal(await guide.webContents.executeJavaScript(`Boolean(document.querySelector('.recent')) && !document.querySelector('.setting')`), true);
    await clickAndWaitForClose(window, '.createContent > footer button:first-child');
    assert.equal(guide.isDestroyed(), false);
  } finally {if (!window.isDestroyed()) window.destroy()}
}

export async function checkGuide({electron, repository, userData}) {
  const directory = join(userData, 'fixtures', 'Guide project'); mkdirSync(directory, {recursive: true});
  const editedLocation = join(userData, 'fixtures', 'AgentIDE', 'Edited location');
  let chooserCalls = 0;
  let opening = 0;
  let opened;
  let window;
  const launcher = await createGuideWindow(electron, {repository, locale: 'en', hidden: true, recent: {list: () => []},
    open: async () => {},
    async openNewProject() {
      window = await createGuideWindow({...electron, dialog: {...electron.dialog,
        showOpenDialog: async () => ({canceled: false, filePaths: [directory]})}}, {repository, locale: 'en', hidden: true, mode: 'create', recent: {list: () => []},
        defaultDirectory: directory,
        chooseDirectory: async () => {chooserCalls++; return directory},
        async open(path) {opened = path; if (++opening === 1) throw new Error('Fixture Host startup failure')},
      });
    },
  });
  try {
    launcher.showInactive();
    await waitFor(launcher, "document.querySelector('h1')?.textContent === 'Recent projects'");
    // Exercise the actual welcome button: its renderer must keep showing recent projects.
    await launcher.webContents.executeJavaScript(`document.querySelector('.actions button[data-guide-action=new]').click()`);
    await waitFor(launcher, "!document.querySelector('section[aria-busy=\"true\"]')");
    assert.ok(window); assert.notEqual(window.id, launcher.id);
    assert.notEqual(window.webContents.session, launcher.webContents.session);
    assert.equal(await launcher.webContents.executeJavaScript(`Boolean(document.querySelector('.recent')) && !document.querySelector('.setting')`), true);
    window.showInactive();
    await waitFor(window, "document.querySelector('.setting') && !document.querySelector('section[aria-busy=\"true\"]')");
    assert.equal(window.getTitle(), 'New Project');
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.recent') === null`), true);
    assert.equal(chooserCalls, 0);
    // Every composition remains available inside the independent window.
    for (const [id, roles] of [['admin', ['Backend', 'Admin panel']], ['miniapp', ['Backend', 'Mini program']],
      ['app', ['Backend', 'Mobile app']], ['desktop', ['Desktop app']], ['empty', []], ['fullstack', ['Backend', 'Web frontend']]]) {
      const selector = `.templateItem[data-template-id="${id}"]`;
      await window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`);
      await waitFor(window, `document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-pressed') === 'true'`);
      assert.deepEqual(await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.resourceDraftRole'), item => item.textContent)`), roles);
    }
    await window.webContents.executeJavaScript(`document.querySelector('.resourceEditorHeading button').click()`);
    await waitFor(window, "Boolean(document.querySelector('.addResourceForm'))");
    assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('.resourceDraft').length`), 2);
    await window.webContents.executeJavaScript(`document.querySelector('.project-resource-directory button').click()`);
    await waitFor(window, `document.querySelector('.addResourceForm input')?.value === 'Guide project'`);
    await window.webContents.executeJavaScript(`document.querySelector('[role=dialog] button[type=submit]').click()`);
    await waitFor(window, "document.querySelectorAll('.resourceDraft').length === 3");
    assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('.resourceDraft')[2].querySelector('.resourceDraftRole')`), null);
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.resourceDraft select') === null`), true);
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('input[aria-label="Resource name"]') === null`), true);
    // Resource names become inputs only while explicitly editing them.
    await window.webContents.executeJavaScript(`document.querySelector('.resourceDraftName').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))`);
    await waitFor(window, `document.querySelector('input[aria-label="Resource name"]') !== null`);
    await window.webContents.executeJavaScript(`(() => {const input = document.querySelector('input[aria-label="Resource name"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, 'Custom backend'); input.dispatchEvent(new Event('input', {bubbles:true})); input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}))})()`);
    await waitFor(window, `document.querySelector('.resourceDraftName')?.textContent === 'Custom backend'`);
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.resourceDraftPath span').textContent`), 'resources/Custom backend');
    // Opening/cancelling the editor must not change the original resource.
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.resourceDraftSource').textContent`), 'Link resource');
    await window.webContents.executeJavaScript(`document.querySelector('.resourceDraftSource').click()`);
    await waitFor(window, `document.querySelector('[role=menuitem]') !== null`);
    await window.webContents.executeJavaScript(`document.querySelector('[role=menuitem]').click()`);
    await waitFor(window, `document.querySelector('[role=dialog]') !== null`);
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('input[aria-label="Git repository URL"]') !== null`), true);
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.resourceDraftSource').textContent`), 'Link resource');
    await window.webContents.executeJavaScript(`document.querySelector('[role=dialog] button[aria-label="Cancel"]').click()`);
    await waitFor(window, `document.querySelector('input[aria-label="Git repository URL"]') === null`);
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.resourceDraftSource').textContent`), 'Link resource');
    // A temporary local association must return to resources/ when unlinked.
    await window.webContents.executeJavaScript(`document.querySelector('.resourceDraftSource').click()`);
    await waitFor(window, `Boolean(document.querySelector('[role=menuitem]'))`);
    await window.webContents.executeJavaScript(`document.querySelectorAll('[role=menuitem]')[1].click()`);
    await waitFor(window, `document.querySelector('.resourceDraftPath span').textContent === ${JSON.stringify(directory)}`);
    await window.webContents.executeJavaScript(`document.querySelector('.resourceDraftSource').click()`);
    await waitFor(window, `document.querySelectorAll('[role=menuitem]').length === 3`);
    await window.webContents.executeJavaScript(`document.querySelectorAll('[role=menuitem]')[2].click()`);
    await waitFor(window, `document.querySelector('.resourceDraftPath span').textContent === 'resources/Custom backend'`);
    await window.webContents.executeJavaScript(`document.querySelectorAll('.resourceDraft')[2].querySelector('footer button').click()`);
    await waitFor(window, "document.querySelectorAll('.resourceDraft').length === 2");
    await window.webContents.executeJavaScript(`(() => {const input = document.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, 'Guide project'); input.dispatchEvent(new Event('input', {bubbles:true}))})()`);
    await waitFor(window, `document.querySelectorAll('.resourceDraftPath span')[1].textContent === 'resources/Guide project-web'`);
    // Test both location controls, then create at a typed destination that differs from the default.
    await window.webContents.executeJavaScript(`document.querySelector('.setting button').click()`);
    await waitFor(window, "!document.querySelector('section[aria-busy=\"true\"]')");
    assert.equal(chooserCalls, 1);
    await window.webContents.executeJavaScript(`(() => {const input = document.querySelector('input[aria-label="Project path"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, ${JSON.stringify(editedLocation)}); input.dispatchEvent(new Event('input', {bubbles:true}))})()`);
    // The preview must use the host separator exactly as node:path.join will create it.
    await waitFor(window, `document.querySelector('.projectPathPreview')?.textContent === ${JSON.stringify(join(editedLocation, 'Guide project'))}`);
    assert.equal(existsSync(editedLocation), false, 'typing a path must not create it before confirmation');
    const width = await window.webContents.executeJavaScript(`document.querySelector('.setting').getBoundingClientRect().width`);
    await window.webContents.executeJavaScript(`document.querySelector('.createContent > footer button:last-child').click()`);
    await waitFor(window, "document.querySelector('[role=alert]')?.textContent.includes('Fixture Host startup failure')");
    const original = readFileSync(opened, 'utf8');
    const createdRoot = dirname(opened);
    assert.equal(createdRoot, join(editedLocation, 'Guide project'));
    assert.ok(readFileSync(join(createdRoot, 'AGENT.md'), 'utf8').includes('Project instructions'));
    assert.ok(readFileSync(join(createdRoot, '.gitignore'), 'utf8').includes('/resources/Custom backend/'));
    assert.ok(readFileSync(join(createdRoot, 'resources/Custom backend', 'AGENT.md'), 'utf8').includes('Resource instructions'));
    assert.ok(readFileSync(join(createdRoot, 'resources/Custom backend', '.git', 'HEAD'), 'utf8'));
    assert.ok(readFileSync(join(createdRoot, 'resources/Guide project-web', '.git', 'HEAD'), 'utf8'));
    assert.equal(existsSync(join(createdRoot, 'Custom backend')), false);
    assert.equal(existsSync(join(createdRoot, 'Guide project-web')), false);
    assert.ok(readFileSync(join(createdRoot, '.git', 'HEAD'), 'utf8'));
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.setting').getBoundingClientRect().width`), width);
    writeFileSync(join(userData, 'guide-selection-en.png'), (await window.webContents.capturePage()).toPNG());
    await clickAndWaitForClose(window, '.createContent > footer button:last-child');
    assert.equal(opening, 2); assert.equal(readFileSync(opened, 'utf8'), original, 'retry preserves created manifest');
    assert.equal(launcher.isDestroyed(), false, 'the creation window has its own lifecycle');
  } finally {if (window && !window.isDestroyed()) window.destroy(); launcher.destroy()}

  // A non-empty target must explain itself in the active locale and never leak
  // the raw absolute path or the internal error code used by the Host.
  const occupied = join(directory, 'Occupied'); mkdirSync(occupied, {recursive: true}); writeFileSync(join(occupied, 'keep.txt'), 'keep');
  const createWindow = await createGuideWindow(electron, {repository, locale: 'en', hidden: true, mode: 'create',
    defaultDirectory: directory, recent: {list: () => []}, chooseDirectory: async () => {chooserCalls++; return directory}, open: async () => {}});
  try {
    createWindow.showInactive();
    await waitFor(createWindow, "document.querySelector('.createWindow .setting') && !document.querySelector('.createWindow section[aria-busy=\"true\"]')");
    assert.equal(await createWindow.webContents.executeJavaScript(`document.querySelector('.createWindow') !== null`), true);
    assert.equal(await createWindow.webContents.executeJavaScript(`document.querySelector('.recent') === null`), true);
    assert.equal(chooserCalls, 1);
    await createWindow.webContents.executeJavaScript(`(() => {const input = document.querySelector('input[aria-label="Project name"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, 'Occupied'); input.dispatchEvent(new Event('input', {bubbles:true}))})()`);
    await waitFor(createWindow, "!document.querySelector('.createContent > footer button:last-child').disabled");
    await createWindow.webContents.executeJavaScript(`document.querySelector('.createContent > footer button:last-child').click()`);
    await waitFor(createWindow, "document.querySelector('.createContent [role=alert]')?.textContent.length > 0");
    const occupiedMessage = await createWindow.webContents.executeJavaScript(`document.querySelector('.createContent [role=alert]').textContent`);
    assert.match(occupiedMessage, /non-empty folder with this name/);
    assert.equal(occupiedMessage.includes(occupied), false, 'the prompt must not leak the rejected absolute path');
    assert.equal(occupiedMessage.includes('project-target-exists'), false, 'the prompt must not show the raw error code');
    assert.equal(readFileSync(join(occupied, 'keep.txt'), 'utf8'), 'keep');
    writeFileSync(join(userData, 'guide-target-exists-en.png'), (await createWindow.webContents.capturePage()).toPNG());
    createWindow.setSize(420, 460);
    await waitFor(createWindow, 'window.innerWidth <= 420');
    // Let the narrowed layout settle before sampling; a real overflow never settles and still fails here.
    await waitFor(createWindow, "document.querySelector('.guideBody').scrollWidth <= document.querySelector('.guideBody').clientWidth");
    writeFileSync(join(userData, 'guide-target-exists-en-narrow.png'), (await createWindow.webContents.capturePage()).toPNG());
    await clickAndWaitForClose(createWindow, '.createContent > footer button:first-child');
  } finally {if (!createWindow.isDestroyed()) createWindow.destroy()}

  const zhCreate = await createGuideWindow(electron, {repository, locale: 'zh', hidden: true, mode: 'create',
    defaultDirectory: directory, recent: {list: () => []}, chooseDirectory: async () => directory, open: async () => {}});
  try {
    zhCreate.showInactive();
    await waitFor(zhCreate, "document.querySelector('input[aria-label=\"项目名称\"]') && !document.querySelector('.createWindow section[aria-busy=\"true\"]')");
    await zhCreate.webContents.executeJavaScript(`(() => {const input = document.querySelector('input[aria-label="项目名称"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, 'Occupied'); input.dispatchEvent(new Event('input', {bubbles:true}))})()`);
    await waitFor(zhCreate, "!document.querySelector('.createContent > footer button:last-child').disabled");
    await zhCreate.webContents.executeJavaScript(`document.querySelector('.createContent > footer button:last-child').click()`);
    await waitFor(zhCreate, "document.querySelector('.createContent [role=alert]')?.textContent.length > 0");
    const zhOccupiedMessage = await zhCreate.webContents.executeJavaScript(`document.querySelector('.createContent [role=alert]').textContent`);
    assert.match(zhOccupiedMessage, /同名文件夹/);
    assert.equal(zhOccupiedMessage.includes(occupied), false, 'the Chinese prompt must not leak the rejected absolute path');
    writeFileSync(join(userData, 'guide-target-exists-zh.png'), (await zhCreate.webContents.capturePage()).toPNG());
    await clickAndWaitForClose(zhCreate, '.createContent > footer button:first-child');
  } finally {if (!zhCreate.isDestroyed()) zhCreate.destroy()}

  let records = Array.from({length: 12}, (_, id) => ({title: `项目 ${id + 1}`, path: `/fixtures/很长的项目目录/${id}/project.agent-project`, available: id !== 0}));
  let recentOpenCalls = 0;
  const narrow = await createGuideWindow(electron, {repository, locale: 'zh', hidden: true,
    recent: {list: () => records, remove: path => {records = records.filter(item => item.path !== path)}}, open: async () => {recentOpenCalls++}});
  try {
    electron.nativeTheme.themeSource = 'light'; narrow.setSize(420, 460); narrow.showInactive();
    await waitFor(narrow, "document.querySelectorAll('.recentItem').length === 12 && !document.body.hasAttribute('data-ds-dark-theme')");
    assert.equal(await narrow.webContents.executeJavaScript(`document.querySelector('.recentProject').dataset.unavailable`), 'true');
    assert.equal(await narrow.webContents.executeJavaScript(`document.querySelector('.recentItem').disabled`), true);
    assert.match(await narrow.webContents.executeJavaScript(`window.projectGuide.invoke('recent', ${JSON.stringify(records[0].path)}).then(() => '', error => error.message)`), /unavailable/);
    assert.equal(recentOpenCalls, 0);
    const geometry = await narrow.webContents.executeJavaScript(`(() => {
      const body = document.querySelector('.guideBody'); const button = document.querySelector('.recentItem');
      const before = button.getBoundingClientRect(); body.scrollTop = body.scrollHeight;
      const after = button.getBoundingClientRect(); return {overflow: body.scrollHeight > body.clientHeight,
        horizontal: body.scrollWidth > body.clientWidth, left: before.left === after.left, width: before.width === after.width};
    })()`);
    assert.deepEqual(geometry, {overflow: true, horizontal: false, left: true, width: true});
    await narrow.webContents.executeJavaScript(`document.querySelector('.guideBody').scrollTop = 0; document.querySelector('input').focus()`);
    narrow.webContents.sendInputEvent({type: 'keyDown', keyCode: 'Tab'});
    narrow.webContents.sendInputEvent({type: 'keyUp', keyCode: 'Tab'});
    await waitFor(narrow, "document.activeElement === document.querySelector('.actions button')");
    const beforeFilter = await narrow.webContents.executeJavaScript(`(() => {const r = document.querySelector('.recentItem').getBoundingClientRect(); return {x:r.x,width:r.width}})()`);
    await narrow.webContents.executeJavaScript(`(() => {const input = document.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, '项目 12'); input.dispatchEvent(new Event('input', {bubbles:true}))})()`);
    await waitFor(narrow, "document.querySelectorAll('.recentItem').length === 1");
    assert.deepEqual(await narrow.webContents.executeJavaScript(`(() => {const r = document.querySelector('.recentItem').getBoundingClientRect(); return {x:r.x,width:r.width}})()`), beforeFilter);
    await narrow.webContents.executeJavaScript(`(() => {const input = document.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, ''); input.dispatchEvent(new Event('input', {bubbles:true}))})()`);
    await waitFor(narrow, "document.querySelectorAll('.recentItem').length === 12");
    writeFileSync(join(userData, 'guide-narrow-zh-light.png'), (await narrow.webContents.capturePage()).toPNG());
    await narrow.webContents.executeJavaScript(`document.querySelector('.recentMore').click()`);
    await waitFor(narrow, "document.querySelectorAll('[role=menuitem]').length === 2");
    assert.equal(await narrow.webContents.executeJavaScript(`document.querySelector('[role=menuitem]').getAttribute('aria-disabled') === 'true' || document.querySelector('[role=menuitem]').matches(':disabled')`), true);
    assert.match(await narrow.webContents.executeJavaScript(`document.querySelectorAll('[role=menuitem]')[1].textContent`), /最近项目/);
    await narrow.webContents.executeJavaScript(`document.querySelectorAll('[role=menuitem]')[1].click()`);
    await waitFor(narrow, "document.querySelectorAll('.recentItem').length === 11");
    assert.equal(records.some(item => item.title === '项目 1'), false);
  } finally {narrow.destroy()}

  const welcome = await createGuideWindow(electron, {repository, locale: 'zh', hidden: true,
    recent: {list: () => [{title: 'Agent Workbench', path: '~/work-space/agent-workbench/Agent Workbench.agent-project'},
      {title: '产品设计', path: '~/Projects/产品设计/产品设计.agent-project'}, {title: '研究笔记', path: '~/Projects/研究笔记/研究笔记.agent-project'}]}, open: async () => {}});
  try {
    electron.nativeTheme.themeSource = 'dark'; welcome.showInactive();
    await waitFor(welcome, "document.querySelectorAll('.recentItem').length === 3 && document.body.hasAttribute('data-ds-dark-theme')");
    writeFileSync(join(userData, 'welcome-zh-dark.png'), (await welcome.webContents.capturePage()).toPNG());
    electron.nativeTheme.themeSource = 'light';
    await waitFor(welcome, "!document.body.hasAttribute('data-ds-dark-theme')");
    writeFileSync(join(userData, 'welcome-zh-light.png'), (await welcome.webContents.capturePage()).toPNG());
  } finally {welcome.destroy()}
}

const importManifest = 'schemaVersion: 1\nid: imported-1\nname: Imported\nresources:\n  - id: root\n    name: Imported\n    type: local\n    path: .\nmemory: []\n';

/**
 * Opening a folder and importing a repository are welcome-window entry points: the folder
 * picker must also admit folders, and the import dialog must reach the project open flow
 * through the plugin's clone chain, leaving no staging behind.
 */
export async function checkRepositoryImport({electron, repository, userData}) {
  const fixtures = join(userData, 'import-fixtures');
  const folder = join(fixtures, 'Folder Project'); mkdirSync(folder, {recursive: true});
  writeFileSync(join(folder, 'Folder Project.agent-project'), importManifest);
  const empty = join(fixtures, 'Empty Project'); mkdirSync(empty, {recursive: true});
  const ambiguous = join(fixtures, 'Ambiguous'); mkdirSync(ambiguous, {recursive: true});
  writeFileSync(join(ambiguous, 'One.agent-project'), importManifest);
  writeFileSync(join(ambiguous, 'Two.agent-project'), importManifest);
  const destination = join(fixtures, 'Destination'); mkdirSync(destination, {recursive: true});
  const defaults = join(fixtures, 'Defaults'); mkdirSync(defaults, {recursive: true});
  const picked = join(fixtures, 'Picked'); mkdirSync(picked, {recursive: true});
  const opened = [], installed = [], picks = [];
  let options, released = false;
  // The pinned clone manager is exercised for real by the unit suite; here the dialog
  // needs a deterministic job so the progress UI, IPC and open path can be verified natively.
  const pool = {
    entries: new Map(),
    async start({id, name, url, branch}) {this.entries.set(id, {id, name, url, branch}); return {id, url, branch, status: 'cloning'}},
    async snapshot() {return [...this.entries.values()].map(entry => ({...entry,
      ...(released ? {status: 'completed', phase: 'checkout', percent: 100} : {status: 'cloning', phase: 'receiving', percent: 42})}))},
    async cancel(id) {this.entries.delete(id); return true},
    async remove(id) {this.entries.delete(id)},
    async retain() {},
    async authentication(value) {return value?.path === '/keys' ? {keys: []} : {requests: []}},
    async install(item, target) {const entry = this.entries.get(item.id); mkdirSync(target, {recursive: true});
      writeFileSync(join(target, `${entry.name}.agent-project`), importManifest); installed.push(target)},
    async dispose() {this.entries.clear()},
  };
  const launch = locale => createGuideWindow({...electron, dialog: {...electron.dialog,
    showOpenDialog: async (_window, value) => {options = value; return {canceled: false, filePaths: [picks.shift()]}}}},
    {repository, locale, hidden: true, recent: {list: () => []}, defaultDirectory: defaults,
      open: async target => {opened.push(target)}, createClonePool: async () => pool});
  const invokeAndSettle = (window, action, value) => {
    const closed = new Promise(resolve => window.once('closed', () => resolve('closed')));
    const answer = window.webContents.executeJavaScript(
      `window.projectGuide.invoke(${JSON.stringify(action)}, ${JSON.stringify(value)}).then(() => undefined, error => error.message)`).catch(() => 'closed');
    return Promise.race([answer, closed]);
  };
  const setDialogInput = (window, index, value) => window.webContents.executeJavaScript(
    `(() => {const input = document.querySelectorAll('[role=dialog] input')[${index}];
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', {bubbles: true}))})()`);
  const clickOpen = window => window.webContents.executeJavaScript(`document.querySelector('.actions button[data-guide-action=open]').click()`);
  const clickClone = window => window.webContents.executeJavaScript(`document.querySelector('.actions button[data-guide-action=clone]').click()`);
  const settled = promise => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Import did not open the project')), 15000))]);
  /** A successful open replies just before it destroys the window; the assertion must wait for that. */
  const destroyed = window => new Promise((resolve, reject) => {
    if (window.isDestroyed()) return resolve();
    const timer = setTimeout(() => reject(new Error('Guide window did not close')), 10000);
    window.once('closed', () => {clearTimeout(timer); resolve()});
  });

  // A folder with exactly one entry file opens like the file itself.
  picks.length = 0; picks.push(folder);
  let window = await launch('zh'); window.showInactive();
  await waitFor(window, "document.querySelector('.actions')");
  const folderOpened = destroyed(window);
  await settled(invokeAndSettle(window, 'open'));
  await folderOpened;
  assert.deepEqual(opened, [folder]);
  assert.deepEqual(options.properties, ['openFile', 'openDirectory']);

  // A folder without one explains itself in the window's own language instead of the plugin's.
  picks.length = 0; picks.push(empty);
  window = await launch('zh'); window.showInactive();
  await waitFor(window, "document.querySelector('.actions')");
  await clickOpen(window);
  await waitFor(window, "document.querySelector('.error')?.textContent.includes('不是 agent-project 项目')");
  window.destroy();

  // Only macOS can pick a file inside an ambiguous folder; the other platforms fall back to it.
  picks.length = 0; picks.push(ambiguous, join(ambiguous, 'One.agent-project'));
  window = await launch('en'); window.showInactive();
  await waitFor(window, "document.querySelector('.actions')");
  if (process.platform === 'darwin') {
    await clickOpen(window);
    await waitFor(window, "document.querySelector('.error')?.textContent.includes('several .agent-project files')");
    window.destroy();
  } else {
    const ambiguousOpened = destroyed(window);
    // The fallback folder picker reopens as a file picker and this click closes the window
    // itself. A window destroyed inside the call never answers executeJavaScript, so the
    // click promise must be raced against the close instead of awaited on its own
    // (clickAndWaitForClose above exists for exactly that reason).
    await Promise.race([ambiguousOpened, clickOpen(window)]);
    await ambiguousOpened;
    assert.equal(opened.at(-1), join(ambiguous, 'One.agent-project'));
  }

  // The import dialog validates its own form, prefills the folder name, and imports natively.
  window = await launch('zh'); window.showInactive();
  await waitFor(window, "document.querySelector('.actions')");
  const actionButtons = await window.webContents.executeJavaScript(
    `[...document.querySelectorAll('.actions button')].map(button => ({action: button.dataset.guideAction, text: button.textContent}))`);
  assert.deepEqual(actionButtons.map(item => item.action), ['clone', 'new', 'open']);
  assert.equal(actionButtons[0].text, '克隆仓库');
  assert.equal(actionButtons[1].text, '新建项目');
  assert.match(actionButtons[2].text, /^打开/);
  await clickClone(window);
  await waitFor(window, "Boolean(document.querySelector('[role=dialog]'))");
  assert.match(await window.webContents.executeJavaScript(`document.querySelector('[role=dialog]').textContent`), /从 Git 仓库克隆项目/);
  // Nothing was imported yet, so the dialog still starts from the window default.
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('[role=dialog] input')[2].value`), defaults);
  await window.webContents.executeJavaScript(`document.querySelector('[role=dialog] button[type=submit]').click()`);
  await waitFor(window, "Boolean(document.querySelector('[role=dialog] [role=alert]'))");
  await setDialogInput(window, 0, 'https://github.com/example/imported-project.git');
  await setDialogInput(window, 2, destination);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('[role=dialog] input')[3].value`), 'imported-project');
  assert.match(await window.webContents.executeJavaScript(`document.querySelector('[role=dialog] .projectPathPreview').textContent`), /imported-project$/);
  const imported = new Promise(resolve => window.once('closed', resolve));
  await window.webContents.executeJavaScript(`document.querySelector('[role=dialog] button[type=submit]').click()`).catch(() => {});
  // The clone runs through the plugin's job records, so the dialog must report its real phase.
  await waitFor(window, "document.querySelector('.cloneProgress')?.textContent.includes('42%')");
  assert.match(await window.webContents.executeJavaScript(`document.querySelector('.cloneProgress').textContent`), /接收对象/);
  released = true;
  await settled(imported);
  assert.deepEqual(installed, [join(destination, 'imported-project')]);
  assert.equal(opened.at(-1), join(destination, 'imported-project', 'imported-project.agent-project'));

  // The import directory survives the window: the next import starts where this one went,
  // and browsing remembers the picked folder before any clone is started.
  picks.length = 0; picks.push(picked);
  window = await launch('zh'); window.showInactive();
  await waitFor(window, "document.querySelector('.actions')");
  await clickClone(window);
  await waitFor(window, `Boolean(document.querySelector('[role=dialog]')) && document.querySelectorAll('[role=dialog] input')[2].value === ${JSON.stringify(destination)}`);
  await window.webContents.executeJavaScript(`document.querySelector('[role=dialog] .projectPathControl button').click()`);
  await waitFor(window, `document.querySelectorAll('[role=dialog] input')[2].value === ${JSON.stringify(picked)}`);
  window.webContents.sendInputEvent({type: 'keyDown', keyCode: 'Escape'});
  window.webContents.sendInputEvent({type: 'keyUp', keyCode: 'Escape'});
  await waitFor(window, "!document.querySelector('[role=dialog]')");
  await clickClone(window);
  await waitFor(window, `Boolean(document.querySelector('[role=dialog]')) && document.querySelectorAll('[role=dialog] input')[2].value === ${JSON.stringify(picked)}`);
  assert.deepEqual(installed, [join(destination, 'imported-project')]);
  window.destroy();

  // English, dark theme and Escape must behave like every other official dialog.
  window = await launch('en'); window.showInactive();
  await waitFor(window, "document.querySelector('.actions')");
  electron.nativeTheme.themeSource = 'dark';
  await clickClone(window);
  await waitFor(window, "document.querySelector('[role=dialog]') && document.body.hasAttribute('data-ds-dark-theme')");
  assert.match(await window.webContents.executeJavaScript(`document.querySelector('[role=dialog]').textContent`), /Clone Project from Git Repository/);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('[role=dialog] input')[2].value`), picked);
  writeFileSync(join(userData, 'import-en-dark.png'), (await window.webContents.capturePage()).toPNG());
  window.webContents.sendInputEvent({type: 'keyDown', keyCode: 'Escape'});
  window.webContents.sendInputEvent({type: 'keyUp', keyCode: 'Escape'});
  await waitFor(window, "!document.querySelector('[role=dialog]')");
  electron.nativeTheme.themeSource = 'light';
  await waitFor(window, "!document.body.hasAttribute('data-ds-dark-theme')");
  await clickClone(window);
  await waitFor(window, "Boolean(document.querySelector('[role=dialog]'))");
  writeFileSync(join(userData, 'import-en-light.png'), (await window.webContents.capturePage()).toPNG());
  // A compact window keeps the dialog inside the viewport and adds no horizontal scroll.
  window.setSize(420, 460);
  await waitFor(window, "innerWidth <= 420");
  assert.equal(await window.webContents.executeJavaScript(
    `document.querySelector('[role=dialog]').getBoundingClientRect().right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1`), true);
  writeFileSync(join(userData, 'import-narrow-en-light.png'), (await window.webContents.capturePage()).toPNG());
  window.destroy();
  console.log('Welcome folder opening, ambiguity copy and repository import passed.');
}
