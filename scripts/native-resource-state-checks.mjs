import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {createServer as createHttpsServer} from 'node:https';
import {dirname, join} from 'node:path';
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
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
  // The project root itself is a Git working tree. The overview's project-repository block is the
  // only surface that manages it, and the resource list must keep excluding it.
  const projectGit = args => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: 'pipe'}).trim();
  projectGit(['init', '-b', 'main']);
  projectGit(['config', 'user.name', 'Fixture']);
  projectGit(['config', 'user.email', 'fixture@example.invalid']);
  projectGit(['add', '-A']);
  projectGit(['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'project fixture']);
  projectGit(['remote', 'add', 'origin', 'https://example.invalid/project.git']);
  // A real upstream makes "ahead" computable, so the push action is exercised rather than absent.
  // The host creates the project root before this fixture runs, so take the branch it is actually on:
  // `git init -b main` above only takes effect for a fresh directory (CI uses the default `master`).
  const rootBranch = projectGit(['symbolic-ref', '--short', 'HEAD']);
  projectGit(['update-ref', `refs/remotes/origin/${rootBranch}`, projectGit(['rev-parse', 'HEAD'])]);
  projectGit(['config', `branch.${rootBranch}.remote`, 'origin']);
  projectGit(['config', `branch.${rootBranch}.merge`, `refs/heads/${rootBranch}`]);
  // Project assets the review must find: a new task, a new Skill, an MCP declaration and a changed file.
  // A non-ASCII directory name proves Git's C-quoting never reaches the review.
  mkdirSync(join(root, 'tasks', '中文验收样例'), {recursive: true});
  writeFileSync(join(root, 'tasks', '中文验收样例', 'task.md'),
    '---\nschemaVersion: 3\ndirectory: 中文验收样例\nid: task-00000000-0000-4000-8000-000000000000\n'
    + 'title: Native review fixture\nobjective: Prove the project change review groups assets.\nstatus: active\n'
    + 'createdAt: 2026-01-01T00:00:00.000Z\nupdatedAt: 2026-01-01T00:00:00.000Z\n'
    + 'archived: false\nartifacts: []\nreferences: []\nentries: []\noperations: {}\n---\n\n# Native review fixture\n');
  // The task asset owns its whole directory: the record and one attachment arrive as one card.
  mkdirSync(join(root, 'tasks', '中文验收样例', 'artifacts'), {recursive: true});
  writeFileSync(join(root, 'tasks', '中文验收样例', 'artifacts', 'evidence.md'), '# evidence\n');
  mkdirSync(join(root, 'skills', 'review-fixture'), {recursive: true});
  writeFileSync(join(root, 'skills', 'review-fixture', 'SKILL.md'),
    '---\nname: review-fixture\ndescription: Review fixture skill\n---\nUse this skill.\n');
  // Declare the Skill up front: otherwise the Skill service rewrites this index while the project
  // is open, which adds a second "Skills" card and made position-based lookup flaky (Windows CI).
  writeFileSync(join(root, 'skills', 'index.yaml'),
    'schemaVersion: 1\nskills:\n  review-fixture:\n    enabled: true\n');
  // Disabled, so the MCP runtime never starts a process during the check. Every declaration owns a
  // file of its own, which is what lets the review commit one server without dragging the others.
  mkdirSync(join(root, 'mcp', 'servers'), {recursive: true});
  for (const name of ['review-fixture', 'review-second', 'review-own']) {
    writeFileSync(join(root, 'mcp', 'servers', `${name}.yaml`),
      `id: ${name}\nserverName: ${name}\nenabled: false\ntoolCallTimeoutMs: 30000\n`
      + 'transport: stdio\ncommand: node\nargs: []\n');
  }
  writeFileSync(join(root, 'AGENT.md'), '# review fixture\n');
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
  /**
   * The overview reviews project assets, not repository files: a changed task, Skill, memory
   * document or MCP declaration becomes a row the user decides to commit. Live DOM, never pixels.
   */
  const assertProjectChanges = async (locale, theme, width) => {
    const copy = locale === 'zh'
      ? {section: '项目资产', task: '任务', skill: '技能', mcp: 'MCP', file: '其他文件', clear: '清空', commit: '提交所选'}
      : {section: 'Project assets', task: 'Tasks', skill: 'Skills', mcp: 'MCP', file: 'Other files', clear: 'Clear', commit: 'Commit'};
    const section = `[...document.querySelectorAll('.project-panel section')].find(item => item.querySelector('h2')?.textContent === ${JSON.stringify(copy.section)})`;
    const group = kind => `[...(${section}?.querySelectorAll('.project-change-group') ?? [])].find(item => item.querySelector('h3')?.textContent === ${JSON.stringify(kind)})`;
    const row = kind => `${group(kind)}?.querySelector('.project-change-card')`;
    // Look a card up by its asset name: a group can hold more than one card, so position is not identity.
    const cardNamed = (kind, name) => `[...(${group(kind)}?.querySelectorAll('.project-change-card') ?? [])]
      .find(card => card.querySelector('.project-change-name')?.textContent === ${JSON.stringify(name)})`;
    // One diagnostic line per pass: which overview sections rendered at all.
    console.log('overview sections:', await evaluate(window,
      `JSON.stringify([...document.querySelectorAll('.project-panel section')].map(item => item.querySelector('h2')?.textContent ?? '(no h2)'))`));
    await wait(window, `Boolean(${group(copy.task)}?.querySelector('.project-change-card'))`);
    // Each kind is its own group, and a task is named by its record title, not its directory.
    const task = cardNamed(copy.task, 'Native review fixture');
    assert.equal(await evaluate(window, `Boolean(${task})`), true);
    // The directory arrives decoded: no octal escapes and no surrounding quotes.
    assert.equal(await evaluate(window, `${task}?.querySelector('.project-change-path')?.textContent`), 'tasks/中文验收样例');
    // One asset can own several files; the card says how many it would commit.
    assert.equal(await evaluate(window, `${task}?.textContent.includes(${JSON.stringify(locale === 'zh' ? '2 个文件' : '2 files')})`), true);
    assert.equal(await evaluate(window, `Boolean(${cardNamed(copy.skill, 'review-fixture')})`), true);
    // Every declaration is its own card: two share the legacy file, one owns a file of its own.
    for (const name of ['review-fixture', 'review-second', 'review-own']) {
      assert.equal(await evaluate(window, `Boolean(${cardNamed(copy.mcp, name)})`), true, `missing MCP card ${name}`);
    }
    assert.equal(await evaluate(window, `Boolean(${row(copy.file)})`), true);
    // Project assets are selected by default; unrecognized files are not.
    assert.equal(await evaluate(window, `Boolean(${task}?.querySelector('input[type=checkbox]')?.checked)`), true);
    assert.equal(await evaluate(window, `Boolean(${row(copy.file)}?.querySelector('input[type=checkbox]')?.checked)`), false);
    // Branch and sync state share the title's line whenever the panel is wide enough; a narrow panel
    // legitimately wraps them below it. Font sizes differ, so compare vertical spans, not tops.
    if (width >= 700) {
      const heading = await evaluate(window, `(() => {const item=${section};
        const box=selector => {const node=item.querySelector(selector); if (!node) return undefined; const r=node.getBoundingClientRect();
          return {top: Math.round(r.top), bottom: Math.round(r.bottom)};};
        return {title: box('.project-change-title h2'), branch: box('.project-change-title .project-resource-branch'),
          tag: box('.project-change-title [data-tone]')};})()`);
      const center = box => Math.round((box.top + box.bottom) / 2);
      assert.equal(Math.abs(center(heading.title) - center(heading.branch)) <= 3, true,
        `branch not vertically centred with the title: ${JSON.stringify(heading)}`);
      assert.equal(Math.abs(center(heading.title) - center(heading.tag)) <= 3, true,
        `sync state not vertically centred with the title: ${JSON.stringify(heading)}`);
    }
    // The section refresh mirrors the panel header's refresh control, icon included.
    assert.equal(await evaluate(window, `Boolean(document.querySelector('.project-panel-actions button svg'))`), true);
    assert.equal(await evaluate(window, `Boolean(${section}.querySelector('.project-card-top button svg'))`), true);
    // Pushing is a repository action: the section itself offers checking and details only.
    const pushLabel = locale === 'zh' ? '推送' : 'Push';
    assert.equal(await evaluate(window, `[...(${section}?.querySelectorAll('button') ?? [])]
      .some(item => item.textContent.trim().startsWith(${JSON.stringify(pushLabel)}))`), false);
    // The repository state is the entry point: it opens the details, where the actions live.
    await evaluate(window, `${section}.querySelector('.project-change-repository')?.click()`);
    await wait(window, `Boolean(document.querySelector('.project-resource-details'))`);
    // Actions live in the dialog footer, so read the whole dialog rather than its body region.
    const dialog = `[...document.querySelectorAll('[role=dialog]')].find(item => item.querySelector('.project-resource-details'))`;
    // The check control may already be reporting progress from the previous pass, so match its stem.
    const repoCopy = locale === 'zh' ? ['检查', '目录'] : ['Check', 'Directory'];
    const dialogText = String(await evaluate(window, `${dialog}?.textContent ?? '(no dialog found)'`));
    for (const label of repoCopy) {
      assert.equal(dialogText.includes(label), true, `repository details missing ${label}: ${dialogText}`);
    }
    // A click must reach the Host: the repository route has to receive the action.
    if (locale === 'en' && theme === 'light' && width === 1180) {
      await evaluate(window, `(() => {window.__repoActions = []; const original = window.fetch;
        window.fetch = (input, init) => {const url = String(typeof input === 'string' ? input : input?.url ?? '');
          if (url.includes('/api/project/repository')) {try {window.__repoActions.push(JSON.parse(String(init?.body ?? '{}')).action);} catch {}}
          return original(input, init);};})()`);
      await evaluate(window, `[...(${dialog}?.querySelectorAll('button') ?? [])]
        .find(item => item.textContent.trim() === 'Check for updates')?.click()`);
      await wait(window, `window.__repoActions?.includes('check') === true`);
    }
    await evaluate(window, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await wait(window, `!document.querySelector('.project-resource-details')`);
    writeFileSync(join(userData, `project-changes-${locale}-${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG());
    // The block never widens the window, at either width. Measure the existing Resources block too:
    // both sections share the overview's layout, so a narrow-window squeeze is not this block's.
    const layout = await evaluate(window, `(() => {
      const section=${section};
      const resources=[...document.querySelectorAll('.project-panel section')].find(item => item.querySelector('h2')?.textContent === ${JSON.stringify(locale === 'zh' ? '资源' : 'Resources')});
      const rows=[...section.querySelectorAll('.project-change-card')].map(item => item.getBoundingClientRect());
      const measure=item => item ? {scrollWidth: item.scrollWidth, clientWidth: item.clientWidth} : null;
      return {bodyOverflow: document.body.scrollWidth > innerWidth, innerWidth,
        rowLeft: Math.round(Math.min(...rows.map(item => item.left))), rowRight: Math.round(Math.max(...rows.map(item => item.right))),
        changes: measure(section), resources: measure(resources)};})()`);
    assert.equal(layout.bodyOverflow, false, `project changes overflow ${locale}/${theme}/${width}: ${JSON.stringify(layout)}`);
    assert.equal(layout.rowLeft >= -1 && layout.rowRight <= layout.innerWidth + 1, true,
      `project change rows outside the viewport ${locale}/${theme}/${width}: ${JSON.stringify(layout)}`);
    measurements.push({locale, theme, width, changes: layout});
    // Run the selection and the commit once, on the last pass, so earlier passes still see every asset.
    if (locale === 'zh' && theme === 'dark' && width === 420) await assertProjectCommit();
  };
  /** Select one asset, watch the message follow the selection, commit it and verify Git and the review. */
  const assertProjectCommit = async () => {
    const copy = {section: '项目资产', task: '任务', skill: '技能', clear: '清空', commit: '提交所选'};
    window.setSize(1180, 820); await frame(window);
    const section = `[...document.querySelectorAll('.project-panel section')].find(item => item.querySelector('h2')?.textContent === ${JSON.stringify(copy.section)})`;
    const group = kind => `[...(${section}?.querySelectorAll('.project-change-group') ?? [])].find(item => item.querySelector('h3')?.textContent === ${JSON.stringify(kind)})`;
    // Asset name is the identity: a group may hold more than one card (e.g. the Skill index).
    const cardNamed = (kind, name) => `[...(${group(kind)}?.querySelectorAll('.project-change-card') ?? [])]
      .find(card => card.querySelector('.project-change-name')?.textContent === ${JSON.stringify(name)})`;
    const toggleNamed = (kind, name) => `${cardNamed(kind, name)}?.querySelector('input[type=checkbox]')`;
    const submit = `[...(${section}?.querySelectorAll('button') ?? [])].find(item => item.textContent.trim().startsWith(${JSON.stringify(copy.commit)}))`;
    const plan = `(${submit}?.getAttribute('aria-description') ?? '').split('\\n').filter(Boolean)`;
    // Clear, then select the task: the plan follows the selection.
    await evaluate(window, `[...(${section}?.querySelectorAll('button') ?? [])].find(item => item.textContent.trim() === ${JSON.stringify(copy.clear)})?.click()`);
    await frame(window);
    // Toolbar must be usable even while the automatic check is in flight.
    await wait(window, `[...(${section}?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent.trim() === ${JSON.stringify(copy.clear)})?.disabled === false`);
    assert.equal(await evaluate(window, `${submit}?.disabled`), true);
    // Refreshing the snapshot must not re-tick what the user just cleared.
    await evaluate(window, `[...(${section}?.querySelectorAll('.project-card-top > button') ?? [])][0]?.click()`);
    await frame(window);
    await wait(window, `Boolean(${section}?.querySelector('.project-change-card'))`);
    assert.equal(await evaluate(window, `${submit}?.disabled`), true);
    await evaluate(window, `${toggleNamed(copy.task, 'Native review fixture')}.click()`);
    await frame(window);
    // The adaptation keeps native keyboard semantics: focus the checkbox and press Space twice.
    await evaluate(window, `${toggleNamed(copy.task, 'Native review fixture')}.focus()`);
    window.focus(); await frame(window);
    const press = () => {
      window.webContents.sendInputEvent({type: 'keyDown', keyCode: 'Space'});
      window.webContents.sendInputEvent({type: 'char', keyCode: ' '});
      window.webContents.sendInputEvent({type: 'keyUp', keyCode: 'Space'});
    };
    press(); await frame(window);
    assert.equal(await evaluate(window, `${toggleNamed(copy.task, 'Native review fixture')}.checked`), false);
    // One real Space already proved the keyboard semantics; restore the selection with a click,
    // because a second synthetic key press is occasionally dropped by the hidden window.
    await evaluate(window, `${toggleNamed(copy.task, 'Native review fixture')}.click()`);
    await frame(window);
    assert.equal(await evaluate(window, `${toggleNamed(copy.task, 'Native review fixture')}.checked`), true);
    assert.deepEqual(await evaluate(window, plan), ['feat(task): 收录「Native review fixture」']);
    // A second asset joins the plan: two assets, two commits, not one mixed changeset.
    await evaluate(window, `${toggleNamed(copy.skill, 'review-fixture')}.click()`);
    await frame(window);
    assert.deepEqual(await evaluate(window, plan),
      ['feat(task): 收录「Native review fixture」', 'feat(skills): 新增技能 review-fixture']);
    writeFileSync(join(userData, 'project-changes-selection.png'), (await window.webContents.capturePage()).toPNG());
    // The plan appears from the submit button's tooltip; the window must be visible to receive hover.
    window.show(); window.focus(); await frame(window);
    const submitBox = await evaluate(window, `(() => {const r=${submit}.getBoundingClientRect();
      return {x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2)};})()`);
    window.webContents.sendInputEvent({type: 'mouseMove', x: submitBox.x, y: submitBox.y});
    await wait(window, `document.body.textContent.includes('feat(skills): 新增技能 review-fixture')`);
    writeFileSync(join(userData, 'project-changes-plan-tooltip.png'), (await window.webContents.capturePage()).toPNG());
    await evaluate(window, `${submit}?.click()`);
    // Both assets leave the review; the unselected MCP and file changes stay.
    // The committed assets leave the review; other cards in the same group may remain.
    await wait(window, `!${cardNamed(copy.task, 'Native review fixture')}`);
    await wait(window, `!${cardNamed(copy.skill, 'review-fixture')}`);
    assert.deepEqual(projectGit(['log', '-2', '--pretty=%s']).split('\n'),
      ['feat(skills): 新增技能 review-fixture', 'feat(task): 收录「Native review fixture」']);
    const latest = projectGit(['-c', 'core.quotePath=false', 'show', '--name-only', '--pretty=format:', 'HEAD']).split('\n').filter(Boolean);
    const earlier = projectGit(['-c', 'core.quotePath=false', 'show', '--name-only', '--pretty=format:', 'HEAD~1']).split('\n').filter(Boolean);
    assert.equal(latest.length > 0 && latest.every(name => name.startsWith('skills/')), true, `skill commit contents: ${JSON.stringify(latest)}`);
    assert.equal(earlier.length > 0 && earlier.every(name => name.startsWith('tasks/')), true, `task commit contents: ${JSON.stringify(earlier)}`);
    assert.equal(projectGit(['status', '--porcelain']).includes('AGENT.md'), true);
    // Two local commits now sit ahead of the upstream; pushing is offered in the details, not here.
    assert.equal(projectGit(['rev-list', '--count', '@{u}..HEAD']).trim(), '2');
    assert.equal(await evaluate(window, `[...(${section}?.querySelectorAll('button') ?? [])]
      .some(item => item.textContent.trim().startsWith('推送'))`), false);
    writeFileSync(join(userData, 'project-changes-after-commit.png'), (await window.webContents.capturePage()).toPNG());
  };
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
      // The project repository lives on the overview, so check it there before the resource pass.
      await click(window, locale === 'zh' ? '项目概览' : 'Project overview');
      await wait(window, `document.querySelector('.project-panel h1')?.textContent === 'Resource states'`);
      await assertProjectChanges(locale, theme, 1180);
      window.setSize(420, 820); await frame(window);
      await wait(window, `Math.abs(innerWidth - 420) <= 2`);
      await assertProjectChanges(locale, theme, 420);
      window.setSize(1180, 820); await frame(window);
      await click(window, labels.resources);
      await wait(window, `document.querySelector('.project-panel h1')?.textContent === ${JSON.stringify(labels.resources)}`);
      await wait(window, `document.querySelectorAll('.project-resource-card').length === 2`);
      assert.deepEqual(await evaluate(window, `[...document.querySelectorAll('.project-resource-sync-label')].map(item => item.textContent)`), [labels.state, labels.state]);
      assert.equal(await evaluate(window, `[...document.querySelectorAll('.project-resource-sync-label [data-tone]')].every(item => item.dataset.tone === 'neutral')`), true);
      assert.equal(await evaluate(window, `[...document.querySelectorAll('.project-resource-card button')].some(item => item.getAttribute('aria-label')?.startsWith(${JSON.stringify(labels.check)}))`), false);
      assert.equal(await evaluate(window, `document.querySelectorAll('.project-resource-card[aria-label="Resource states"]').length`), 0);
      for (const width of [1180, 420]) {
        window.setSize(width, 820); await frame(window);
        await wait(window, `Math.abs(innerWidth - ${width}) <= 2`);
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
    // Associating a resource remote never touches the project root's own remote.
    assert.equal(git(['remote'], root), 'origin');
    assert.equal(projectGit(['remote', 'get-url', 'origin']), 'https://example.invalid/project.git');
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
    await wait(window, `Math.abs(innerWidth - 420) <= 2`);
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

    // --- Project repository update: new remote commits are applied from the overview's details ---
    // The overview's project-repository block is the only surface that manages the project root, so
    // its details dialog has to offer the same update a resource card does, under the same rules.
    projectGit(['add', '-A']);
    projectGit(['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'project fixture assets']);
    assert.equal(projectGit(['status', '--porcelain']), '');
    // The loopback Git server already running for the backend resource also serves the project root.
    projectGit(['config', 'http.sslVerify', 'false']);
    const projectRemote = join(remoteRoot, 'project.git');
    execFileSync('git', ['init', '--bare', '--quiet', projectRemote], {stdio: 'pipe'});
    execFileSync('git', ['--git-dir', projectRemote, 'config', 'http.receivepack', 'true'], {stdio: 'pipe'});
    projectGit(['remote', 'set-url', 'origin', `https://127.0.0.1:${remoteServer.address().port}/project.git`]);
    // Seed the remote over the local path: pushing to loopback HTTPS would wait for a credential helper.
    projectGit(['push', '--quiet', '--', projectRemote, `${rootBranch}:${rootBranch}`]);
    /** One new remote commit that rewrites one file, built directly in the bare repository. */
    const advanceProjectRemote = (message, path, content) => {
      const env = {...process.env, GIT_DIR: projectRemote, GIT_INDEX_FILE: join(userData, `project-remote-index-${message.replace(/\W+/g, '-')}`)};
      const blob = execFileSync('git', ['--git-dir', projectRemote, 'hash-object', '-w', '--stdin'], {input: content, encoding: 'utf8'}).trim();
      execFileSync('git', ['read-tree', `${rootBranch}^{tree}`], {env});
      execFileSync('git', ['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`], {env});
      const tree = execFileSync('git', ['write-tree'], {env, encoding: 'utf8'}).trim();
      const parent = execFileSync('git', ['rev-parse', rootBranch], {env, encoding: 'utf8'}).trim();
      const commit = execFileSync('git', ['-c', 'user.name=Remote', '-c', 'user.email=remote@example.invalid',
        'commit-tree', tree, '-p', parent, '-m', message], {env, encoding: 'utf8'}).trim();
      execFileSync('git', ['update-ref', `refs/heads/${rootBranch}`, commit], {env});
    };
    /** Commit the project's own work so the branch has commits the remote does not have. */
    const commitProjectLocally = (message, path, content) => {
      writeFileSync(join(root, path), content);
      projectGit(['add', '-A']);
      projectGit(['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', message]);
    };
    const assetsSection = locale => `[...document.querySelectorAll('.project-panel section')]
      .find(item => item.querySelector('h2')?.textContent === ${JSON.stringify(locale === 'zh' ? '项目资产' : 'Project assets')})`;
    const repoState = locale => `${assetsSection(locale)}?.querySelector('.project-change-title [data-tone]')?.textContent`;
    const openRepositoryDetails = async locale => {
      await evaluate(window, `${assetsSection(locale)}?.querySelector('.project-change-repository')?.click()`);
      await wait(window, `Boolean(document.querySelector('.project-resource-details'))`);
    };
    const closeRepositoryDetails = async () => {
      await evaluate(window, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
      await wait(window, `!document.querySelector('.project-resource-details')`);
    };
    /** The control reports its own progress, so wait for the idle label before clicking it. */
    const clickRepositoryCheck = async label => {
      await wait(window, `Boolean(${dialogButton(label)})`);
      await evaluate(window, `${dialogButton(label)}.click()`);
      await frame(window);
    };
    const repositoryText = `document.querySelector('.project-resource-details')?.textContent ?? ''`;
    // The overview owns the project repository; the resource pass left the sidebar on Resources,
    // and the narrow-window pass above collapsed the navigation, so restore the wide layout first.
    window.setSize(1180, 820); await frame(window);
    await wait(window, `Math.abs(innerWidth - 1180) <= 2`);
    await click(window, '项目概览');
    await wait(window, `Boolean(${assetsSection('zh')})`);
    await openRepositoryDetails('zh');
    // A successful check against the real remote is what makes the comparison readable at all.
    await clickRepositoryCheck('检查更新');
    await wait(window, `${repoState('zh')} === '已是最新'`);
    advanceProjectRemote('remote update', 'AGENT.md', '# updated by the remote\n');
    await clickRepositoryCheck('检查更新');
    await wait(window, `${repoState('zh')} === '有 1 个新提交'`);
    // The state the user reported: new commits on the remote now come with the action that applies them.
    assert.equal(await evaluate(window, `Boolean(${dialogButton('更新资源')})`), true, 'the overview offers no update for a behind project repository');
    assert.equal(await evaluate(window, `${dialogButton('更新资源')}.disabled`), false);
    await evaluate(window, `${dialogButton('更新资源')}.click()`);
    await wait(window, `${repoState('zh')} === '已是最新'`);
    await waitGit(() => readFileSync(join(root, 'AGENT.md'), 'utf8'), '# updated by the remote\n');
    await closeRepositoryDetails();
    // A dirty working tree keeps the action visible but disabled, and the dialog says why.
    await project.host.updateShellSettings('locale', {preference: 'en'});
    await wait(window, `Boolean(${assetsSection('en')})`);
    advanceProjectRemote('remote update two', 'AGENT.md', '# updated by the remote again\n');
    writeFileSync(join(root, 'uncommitted-fixture.txt'), 'local change\n');
    await openRepositoryDetails('en');
    await clickRepositoryCheck('Check for updates');
    await wait(window, `${repoState('en')}?.includes('new commits') === true`);
    assert.equal(await evaluate(window, `Boolean(${dialogButton('Update resource')})`), true);
    assert.equal(await evaluate(window, `${dialogButton('Update resource')}.disabled`), true, 'local changes must block the fast-forward');
    assert.equal(String(await evaluate(window, repositoryText)).includes('Commit or otherwise handle local changes'), true);
    // The extra footer action must not push the dialog past a narrow window.
    window.setSize(420, 820); await frame(window);
    await wait(window, `Math.abs(innerWidth - 420) <= 2`);
    assert.equal(await evaluate(window, `(() => {const dialog=document.querySelector('[role=dialog]');
      return dialog.scrollWidth > dialog.clientWidth || document.body.scrollWidth > innerWidth;})()`), false);
    writeFileSync(join(userData, 'project-assets-update-blocked.png'), (await window.webContents.capturePage()).toPNG());
    window.setSize(1180, 820); await frame(window);
    rmSync(join(root, 'uncommitted-fixture.txt'));
    await clickRepositoryCheck('Check for updates');
    await wait(window, `${dialogButton('Update resource')}?.disabled === false`);
    await evaluate(window, `${dialogButton('Update resource')}.click()`);
    await wait(window, `${repoState('en')} === 'Up to date'`);
    await waitGit(() => readFileSync(join(root, 'AGENT.md'), 'utf8'), '# updated by the remote again\n');
    writeFileSync(join(userData, 'project-assets-updated.png'), (await window.webContents.capturePage()).toPNG());
    await closeRepositoryDetails();
    await project.host.updateShellSettings('locale', {preference: 'zh'});
    await wait(window, `document.body.textContent.includes('项目资产')`);

    // --- A diverged project repository: merge it when it is clean, hand a conflict to a conversation ---
    // Both sides gain a commit, but in different files, so the merge needs no decision at all.
    await openRepositoryDetails('zh');
    commitProjectLocally('chore(project): local only', 'local-only.txt', 'local work\n');
    advanceProjectRemote('remote only', 'remote-only.txt', 'remote work\n');
    await clickRepositoryCheck('检查更新');
    await wait(window, `${repoState('zh')} === '分支已分叉'`);
    assert.equal(await evaluate(window, `${dialogButton('更新资源')}?.disabled`), false, 'a diverged branch must offer the merge');
    const divergedHead = projectGit(['rev-parse', 'HEAD']);
    await evaluate(window, `${dialogButton('更新资源')}.click()`);
    // A clean merge completes in place: the panel stays open and the branch is ahead, not diverged.
    await wait(window, `${repoState('zh')} === '本地领先 2 个提交'`);
    await waitGit(() => projectGit(['rev-parse', 'HEAD^2']), projectGit(['rev-parse', 'origin/' + rootBranch]));
    assert.notEqual(projectGit(['rev-parse', 'HEAD']), divergedHead);
    assert.equal(projectGit(['rev-parse', 'HEAD^1']), divergedHead);
    assert.equal(readFileSync(join(root, 'local-only.txt'), 'utf8'), 'local work\n');
    assert.equal(readFileSync(join(root, 'remote-only.txt'), 'utf8'), 'remote work\n');
    assert.equal(projectGit(['status', '--porcelain']), '');
    assert.equal(await evaluate(window, `Boolean(${assetsSection('zh')})`), true, 'a clean merge must not open a conversation');
    writeFileSync(join(userData, 'project-assets-merged.png'), (await window.webContents.capturePage()).toPNG());
    await closeRepositoryDetails();

    // Now both sides rewrite the same file: the update must change nothing and open a prepared conversation.
    await openRepositoryDetails('zh');
    commitProjectLocally('docs(project): local line', 'AGENT.md', '# local line\n');
    advanceProjectRemote('remote line', 'AGENT.md', '# remote line\n');
    await clickRepositoryCheck('检查更新');
    await wait(window, `${repoState('zh')} === '分支已分叉'`);
    const conflictHead = projectGit(['rev-parse', 'HEAD']);
    await evaluate(window, `${dialogButton('更新资源')}.click()`);
    // The conflicting paths become the draft of a brand-new session the panel opens for the user.
    await wait(window, `Boolean(document.querySelector('[contenteditable=true]'))`);
    const conflictDraft = String(await evaluate(window, `document.querySelector('[contenteditable=true]')?.innerText ?? ''`));
    assert.equal(conflictDraft.includes('AGENT.md'), true, `the prepared draft must name the conflicting file: ${conflictDraft}`);
    assert.equal(conflictDraft.includes(root), true, 'the prepared draft must name the project root');
    assert.equal(conflictDraft.includes(projectGit(['rev-parse', '--abbrev-ref', 'HEAD'])), true,
      'the prepared draft must name the branch');
    writeFileSync(join(userData, 'project-assets-conflict.png'), (await window.webContents.capturePage()).toPNG());
    // Nothing was applied: same HEAD, no merge in progress, and the conflict never reaches the worktree.
    assert.equal(projectGit(['rev-parse', 'HEAD']), conflictHead);
    assert.equal(existsSync(join(root, '.git', 'MERGE_HEAD')), false);
    assert.equal(projectGit(['status', '--porcelain']), '');
    assert.equal(readFileSync(join(root, 'AGENT.md'), 'utf8'), '# local line\n');

    // The overview is where the resource pass below expects to start.
    window.setSize(1180, 820); await frame(window);
    await click(window, '资源');
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
      await wait(window, `Math.abs(innerWidth - 1180) <= 2`);
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
