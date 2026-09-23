import electron from 'electron';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {parse as parseYaml, stringify as stringifyYaml} from 'yaml';
import {createProjectFromPlan} from '../src/app/project-bootstrap.mjs';
import {openNativeProject} from '../src/desktop-adapter/native.mjs';
import {projectStatePath} from '../src/app/project-state.mjs';
import {repository} from '../src/desktop-adapter/paths.mjs';

/**
 * Native acceptance for the plugin scrollbar idle fade: a real Host, Renderer,
 * theme and scrolling engine, with every assertion read from the live DOM.
 * Run with DSH_PROJECT_PLUGIN_SOURCE pointing at the plugin worktree.
 */
const runtime = join(repository, '.runtime');
mkdirSync(runtime, {recursive: true});
const userData = mkdtempSync(join(runtime, 'scrollbar-probe-'));
electron.app.setPath('userData', userData);
electron.app.on('window-all-closed', () => {});

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
/** A crashed Renderer never settles executeJavaScript, so every read is bounded. */
const evaluate = (window, code) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Renderer evaluation timed out: ${String(code).slice(0, 140)}`)), 20000);
  window.webContents.executeJavaScript(code).then(
    value => {clearTimeout(timer); resolve(value);},
    error => {clearTimeout(timer); reject(error);});
});
const alphaOf = value => {
  if (value === 'transparent') return 0;
  const rgba = /rgba?\(([^)]+)\)/.exec(value);
  if (rgba !== null) {
    const parts = rgba[1].split(/[,\s/]+/).filter(Boolean);
    return parts.length >= 4 ? Number(parts[3]) : 1;
  }
  // Chromium reports color-mix results as `color(srgb r g b / a)`, or without the alpha part.
  const color = /color\([^)]*\/\s*([\d.]+)\s*\)/.exec(value);
  if (color !== null) return Number(color[1]);
  return value.startsWith('color(') ? 1 : Number.NaN;
};

async function waitFor(window, expression, label, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (!await evaluate(window, `Boolean(${expression})`)) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${label}: ${expression}\n${String(await evaluate(window, 'document.body.innerText')).slice(0, 1500)}`);
    }
    await delay(80);
  }
}

const frames = (window, count = 2) => evaluate(window,
  `new Promise(resolve => {const done = () => resolve(true); let left = ${count};
    const step = () => (--left <= 0 ? done() : requestAnimationFrame(step));
    requestAnimationFrame(step);
    // An occluded window can pause rAF even with throttling disabled; never hang on a frame.
    setTimeout(done, 400);})`);

const SNAPSHOT = selector => `(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (element === null) return null;
  const style = getComputedStyle(element);
  const box = element.getBoundingClientRect();
  return {
    scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
    scrollLeft: element.scrollLeft, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
    offsetWidth: element.offsetWidth, offsetHeight: element.offsetHeight,
    gutter: element.offsetWidth - element.clientWidth, gutterHeight: element.offsetHeight - element.clientHeight,
    gutterStyle: style.scrollbarGutter, boxLeft: box.left, boxWidth: box.width, boxTop: box.top, boxHeight: box.height,
    alpha: Number(style.getPropertyValue('--project-scrollbar-alpha')),
    scrolling: element.hasAttribute('data-project-scrolling'),
    thumb: getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor,
    overflowY: style.overflowY, overflowX: style.overflowX,
  };
})()`;

const surface = (window, selector) => evaluate(window, SNAPSHOT(selector));

/** Panel switches and restored scroll positions can leave a mark briefly. */
async function settleIdle(window, selector) {
  const expression = `document.querySelector(${JSON.stringify(selector)})?.hasAttribute('data-project-scrolling') ?? false`;
  const deadline = Date.now() + 2500;
  while (await evaluate(window, expression)) {
    if (Date.now() > deadline) break;
    await delay(100);
  }
  await frames(window);
  // The 180ms fade must finish before an idle sample, or it reads a mid-transition alpha.
  await delay(260);
}

const report = {userData, checked: [], skipped: [], failures: [], notes: []};

async function checkSurface(window, selector, label) {
  const entry = {selector, label};
  report.checked.push(entry);
  await settleIdle(window, selector);
  const before = await surface(window, selector);
  if (before === null) {
    entry.status = 'missing';
    report.skipped.push({selector, label, reason: 'missing'});
    return;
  }
  const vertical = before.scrollHeight > before.clientHeight + 1;
  const horizontal = before.scrollWidth > before.clientWidth + 1;
  if (!vertical && !horizontal) {
    entry.status = 'not-overflowing';
    report.skipped.push({selector, label, reason: 'not-overflowing'});
    return;
  }
  const fail = message => {
    entry.status = 'failed';
    entry.message = message;
    report.failures.push({selector, label, message});
  };
  // Idle: transparent thumb, no scrolling mark, stable gutter already reserved.
  if (before.scrolling !== false) return fail(`idle mark present: ${before.scrolling}`);
  if (before.alpha !== 0) return fail(`idle alpha ${before.alpha}, expected 0`);
  if (alphaOf(before.thumb) !== 0) return fail(`idle thumb not transparent: ${before.thumb}`);
  if (before.gutterStyle !== 'stable') return fail(`gutter is ${before.gutterStyle}, expected stable`);
  // A card border adds to the reserved width, so assert that the 8px scrollbar is reserved.
  if (vertical && before.gutter < 8) return fail(`vertical gutter ${before.gutter}px does not reserve the 8px scrollbar`);
  if (horizontal && before.gutterHeight < 8) return fail(`horizontal gutter ${before.gutterHeight}px does not reserve the 8px scrollbar`);

  // Scroll: the mark and the thumb appear immediately, and the layout does not move.
  // Reset first, because a programmatic scroll to the current offset dispatches no event.
  const targetTop = vertical ? Math.min(120, Math.max(1, before.scrollHeight - before.clientHeight)) : 0;
  const targetLeft = horizontal ? Math.min(120, Math.max(1, before.scrollWidth - before.clientWidth)) : 0;
  await evaluate(window, `(() => {const element = document.querySelector(${JSON.stringify(selector)});
    element.scrollTop = 0; element.scrollLeft = 0;})()`);
  await frames(window, 1);
  await evaluate(window, `(() => {const element = document.querySelector(${JSON.stringify(selector)});
    element.scrollTop = ${targetTop}; element.scrollLeft = ${targetLeft};})()`);
  await frames(window);
  const during = await surface(window, selector);
  if (during.scrolling !== true) return fail('scrolling mark missing while scrolling');
  entry.markedWhileScrolling = await evaluate(window, `document.querySelectorAll('[data-project-scrolling]').length`);
  if (during.alpha !== 1) return fail(`scrolling alpha ${during.alpha}, expected 1`);
  if (!(alphaOf(during.thumb) > 0)) return fail(`scrolling thumb not visible: ${during.thumb}`);
  for (const [key, expected] of [['clientWidth', before.clientWidth], ['offsetWidth', before.offsetWidth],
    ['gutter', before.gutter], ['boxWidth', before.boxWidth], ['boxLeft', before.boxLeft],
    ['clientHeight', before.clientHeight], ['boxHeight', before.boxHeight], ['boxTop', before.boxTop]]) {
    if (Math.abs(during[key] - expected) > 0.5) return fail(`${key} moved while scrolling: ${during[key]} vs ${expected}`);
  }
  entry.visibleThumb = during.thumb;

  // Idle again: the 180ms fade ends transparent, still without moving the layout.
  await delay(1100);
  const after = await surface(window, selector);
  if (after.scrolling !== false) return fail('scrolling mark stayed after the idle delay');
  if (after.alpha !== 0) return fail(`faded alpha ${after.alpha}, expected 0`);
  if (alphaOf(after.thumb) !== 0) return fail(`faded thumb not transparent: ${after.thumb}`);
  for (const [key, expected] of [['clientWidth', before.clientWidth], ['gutter', before.gutter], ['boxWidth', before.boxWidth], ['boxLeft', before.boxLeft]]) {
    if (Math.abs(after[key] - expected) > 0.5) return fail(`${key} moved after fading: ${after[key]} vs ${expected}`);
  }
  entry.status = 'passed';
  entry.geometry = {gutter: before.gutter, clientWidth: before.clientWidth, boxLeft: before.boxLeft};
}

async function clickPanel(window, labels) {
  const result = await evaluate(window, `(() => {
    const wanted = ${JSON.stringify(Array.isArray(labels) ? labels : [labels])};
    const buttons = [...document.querySelectorAll('button')];
    const named = item => (item.getAttribute('aria-label') ?? item.textContent ?? '').trim();
    const target = buttons.find(item => wanted.includes(named(item)));
    if (target === undefined) return JSON.stringify([...new Set(buttons.map(named).filter(Boolean))].slice(0, 60));
    target.click();
    return 'ok';
  })()`);
  if (result !== 'ok') throw new Error(`Panel "${labels}" not found. Buttons: ${result}`);
  await frames(window);
}

async function writeShot(window, name) {
  writeFileSync(join(userData, name), (await window.webContents.capturePage()).toPNG());
}

void (async () => {
  let code = 0;
  try {
    await electron.app.whenReady();
    const manifest = await createProjectFromPlan({location: userData, name: 'Scrollbar probe', templateId: 'fullstack'});
    const root = dirname(manifest);
    const plan = {schemaVersion: 3, status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      archived: false, artifacts: [], references: [], entries: [], operations: {}};
    for (let index = 1; index <= 14; index += 1) {
      const directory = `fixture-${String(index).padStart(2, '0')}`;
      const id = `task-00000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`;
      mkdirSync(join(root, 'tasks', directory), {recursive: true});
      writeFileSync(join(root, 'tasks', directory, 'task.md'), `---
schemaVersion: 3
directory: ${directory}
id: ${id}
title: Fixture task ${index}
objective: A fixture task long enough to overflow the roster and the detail pane.
status: ${plan.status}
createdAt: ${plan.createdAt}
updatedAt: ${plan.updatedAt}
archived: false
artifacts: []
references: []
entries: []
operations: {}
---

# Fixture task ${index}

${Array.from({length: 12}, (_, line) => `Paragraph ${line + 1}: the detail pane renders this body so the surface overflows.`).join('\n\n')}
`);
    }
    // A real task record with a long history, copied so the detail pane has entries too.
    const source = process.env.DSH_SCROLLBAR_TASKS_SOURCE;
    if (source) {
      for (const name of ['Agent 长任务空转等待与过度思考的治理']) {
        cpSync(join(source, name), join(root, 'tasks', name), {recursive: true});
      }
    }
    // Extra resources make the page panel itself overflow, so `.project-panel` is covered too.
    for (let index = 1; index <= 8; index += 1) {
      const directory = join(root, 'resources', `fixture-resource-${String(index).padStart(2, '0')}`);
      mkdirSync(directory, {recursive: true});
      writeFileSync(join(directory, 'README.md'), `# Fixture resource ${index}\n`);
    }
    // Declared memory documents give the memory page enough height to overflow as well.
    const manifestData = parseYaml(readFileSync(manifest, 'utf8'));
    manifestData.memory = [];
    for (let index = 1; index <= 4; index += 1) {
      const relative = `memory/fixture-memory-${index}.md`;
      mkdirSync(join(root, 'memory'), {recursive: true});
      writeFileSync(join(root, relative), `# Fixture memory ${index}\n\n${Array.from({length: 24},
        (_, line) => `Paragraph ${line + 1} of fixture memory ${index}.`).join('\n\n')}\n`);
      manifestData.memory.push({id: `fixture-memory-${index}`, name: `Fixture memory ${index}`, path: relative});
    }
    writeFileSync(manifest, stringifyYaml(manifestData));

    const project = await openNativeProject(electron, {...projectStatePath(userData, manifest), projectRoot: root,
      title: 'Scrollbar probe', locale: 'en', hidden: true, onError: console.error,
      connectTheme: host => host.setTheme('light'), close() {}, restart() {}, recover() {}});
    const window = project.window;
    window.setSize(1280, 460);
    window.showInactive();
    await waitFor(window, `document.querySelector('.project-panel')`, 'the project panel');

    // The sidebar Session list is a plugin surface too; a fresh project may not overflow it.
    await checkSurface(window, '.project-session-list', 'sidebar session list');

    await clickPanel(window, ['Tasks', '任务']);
    await waitFor(window, `document.querySelector('.project-tasks .project-task-choice')`, 'the task roster');
    await checkSurface(window, '.project-tasks .project-capability-list', 'task roster');
    await evaluate(window, `document.querySelector('.project-tasks .project-task-choice').click()`);
    await waitFor(window, `document.querySelector('.project-tasks .project-task-detail .project-task-section, .project-tasks .project-task-detail h2')`, 'the task detail');
    await frames(window, 3);
    await checkSurface(window, '.project-tasks .project-task-detail', 'task detail');
    await writeShot(window, 'tasks-idle.png');

    // A page panel outside Tasks proves the same rule covers the other plugin pages.
    await clickPanel(window, ['Resources', '资源']);
    await waitFor(window, `document.querySelector('.project-panel .project-capability-card, .project-panel .project-resource-card, .project-panel h1')`, 'the resources panel');
    await frames(window, 2);
    await checkSurface(window, '.project-panel', 'resources page');
    // The long settings dialog reuses the official Modal body; open a resource's details.
    const openedDetails = await evaluate(window, `(() => {
      const button = [...document.querySelectorAll('button')].find(item => {
        const name = item.getAttribute('aria-label') ?? '';
        return name.startsWith('资源详情') || name.startsWith('Resource details');
      });
      if (button === undefined) return false;
      button.click();
      return true;
    })()`);
    if (openedDetails) {
      await waitFor(window, `document.querySelector('.project-settings-dialog-content')`, 'the resource details dialog');
      await frames(window, 3);
      await checkSurface(window, '.project-settings-dialog-content>div:last-child', 'settings dialog body');
      await writeShot(window, 'dialog-idle.png');
      await evaluate(window, `document.querySelector('[role=dialog] button[aria-label]')?.click()`);
      await frames(window, 3);
    } else {
      report.notes.push('resource details trigger not found; the settings dialog body stays uncovered');
    }

    await clickPanel(window, ['Tools', '工具']);
    await waitFor(window, `document.querySelector('.project-panel h1')`, 'the tools panel');
    await frames(window, 2);
    await checkSurface(window, '.project-panel', 'tools page');

    await clickPanel(window, ['Memory', '记忆']);
    await waitFor(window, `document.querySelector('.project-panel h1')`, 'the memory panel');
    await frames(window, 2);
    await checkSurface(window, '.project-panel', 'memory page');

    // An official chat surface must keep the always-visible official scrollbar.
    report.officialScrollingMarks = await evaluate(window,
      `[...document.querySelectorAll('[data-project-scrolling]')].length`);

    // Theme switch keeps the fade, with the thumb taking its colour from the theme.
    await clickPanel(window, ['Tasks', '任务']);
    await waitFor(window, `document.querySelector('.project-tasks .project-capability-list')`, 'the task roster again');
    await project.host.setTheme('dark');
    await delay(400);
    await frames(window, 2);
    await checkSurface(window, '.project-tasks .project-capability-list', 'task roster (dark theme)');
    await writeShot(window, 'tasks-dark-idle.png');

    // Reduced motion drops the fade: the alpha rule switches directly instead of transitioning.
    window.webContents.debugger.attach('1.3');
    try {
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',
        {features: [{name: 'prefers-reduced-motion', value: 'reduce'}]});
      await frames(window, 2);
      const duration = await evaluate(window,
        `getComputedStyle(document.querySelector('.project-tasks .project-capability-list')).transitionDuration`);
      report.reducedMotion = {transitionDuration: duration};
      if (duration !== '0s') {
        report.failures.push({selector: '.project-tasks .project-capability-list', label: 'reduced motion',
          message: `transitionDuration ${duration}, expected 0s`});
      }
    } finally {
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {features: []}).catch(() => {});
      window.webContents.debugger.detach();
    }

    // Narrow window: the task page keeps one pane, and that pane still fades its scrollbar.
    window.setSize(760, 460);
    await delay(400);
    await frames(window, 3);
    await checkSurface(window, '.project-tasks .project-capability-list', 'task roster (narrow)');
    await checkSurface(window, '.project-tasks .project-task-detail', 'task detail (narrow)');
    await writeShot(window, 'tasks-narrow-idle.png');

    report.result = report.failures.length === 0 ? 'passed' : 'failed';
  } catch (error) {
    report.result = 'error';
    report.error = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(error);
    code = 1;
  } finally {
    writeFileSync(join(userData, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({userData, result: report.result, checked: report.checked.map(item => `${item.label}: ${item.status}`),
      skipped: report.skipped, failures: report.failures}, null, 2));
    if (report.result === 'failed') code = 1;
    electron.app.exit(code);
  }
})();
