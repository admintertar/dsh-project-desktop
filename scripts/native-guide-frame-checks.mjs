import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createGuideWindow} from '../src/windows/guide-window.mjs';

const evaluate = (window, script) => window.webContents.executeJavaScript(script);
async function wait(window, condition) {
  const deadline = Date.now() + 10000;
  while (true) {
    if (await evaluate(window, condition)) {
      await delay(450);
      // Programmatic scrolling may dispatch its scroll event after the first
      // sample. Recheck after layout settles instead of returning stale state.
      if (await evaluate(window, condition)) return;
    }
    if (Date.now() > deadline) throw new Error('Guide frame timeout: ' + condition);
    await delay(40);
  }
}
const sidebarWidth = window => evaluate(window, 'Math.round(document.querySelector(".dshDesktopSidebarSurface").getBoundingClientRect().width)');
const savedWidths = userData => JSON.parse(readFileSync(join(userData, 'guide-window-state.json'), 'utf8')).sidebarWidths;
const dividerColor = window => evaluate(window, 'getComputedStyle(document.querySelector(".guideResizeHandle"),"::after").backgroundColor');
async function drag(window, x) {
  const start = Math.round(await sidebarWidth(window));
  window.focus();
  window.webContents.focus();
  // Inputs always receive Chromium's focus-visible state. Moving focus from one
  // to the separator used to leave the keyboard stripe visible throughout a drag.
  await evaluate(window, 'document.querySelector("input").focus()');
  await wait(window, 'document.hasFocus() && document.activeElement === document.querySelector("input")');
  assert.equal(await evaluate(window, `document.elementFromPoint(${start},240)?.classList.contains('guideResizeHandle')`), true);
  window.webContents.sendInputEvent({type: 'mouseDown', x: start, y: 240, button: 'left', clickCount: 1});
  await delay(60);
  assert.equal(await dividerColor(window), 'rgba(0, 0, 0, 0)');
  window.webContents.sendInputEvent({type: 'mouseMove', x, y: 240, modifiers: ['leftButtonDown']});
  await delay(60);
  assert.equal(await dividerColor(window), 'rgba(0, 0, 0, 0)');
  window.webContents.sendInputEvent({type: 'mouseUp', x, y: 240, button: 'left', clickCount: 1});
  await delay(450);
  assert.equal(await dividerColor(window), 'rgba(0, 0, 0, 0)');
}
async function key(window, keyCode) {
  await evaluate(window, 'document.querySelector(".guideResizeHandle").focus()');
  keyCode = {ArrowLeft: 'Left', ArrowRight: 'Right'}[keyCode] ?? keyCode;
  window.webContents.sendInputEvent({type: 'keyDown', keyCode});
  window.webContents.sendInputEvent({type: 'keyUp', keyCode});
  await delay(450);
}

async function checkAutoHideScrollbar(window) {
  await evaluate(window, 'document.querySelector(".guideBody").scrollTop=0');
  const idle = `(() => {const body=document.querySelector('.guideBody');return !body.dataset.guideScrolling && Number(getComputedStyle(body).getPropertyValue('--guide-scrollbar-alpha'))===0})()`;
  await wait(window, idle);
  const measure = () => evaluate(window, `(() => {
    const body=document.querySelector('.guideBody'),r=body.getBoundingClientRect(),canvas=document.createElement('canvas');
    canvas.width=canvas.height=1; const context=canvas.getContext('2d');
    context.fillStyle=getComputedStyle(body,'::-webkit-scrollbar-thumb').backgroundColor;context.fillRect(0,0,1,1);
    return {x:r.x,y:r.y,width:body.clientWidth,gutter:body.offsetWidth-body.clientWidth,alpha:context.getImageData(0,0,1,1).data[3]};
  })()`);
  const before = await measure(); assert.equal(before.alpha, 0);
  window.webContents.sendInputEvent({type:'mouseWheel',x:Math.round(before.x+30),y:Math.round(before.y+30),deltaX:0,deltaY:-120});
  await wait(window, 'document.querySelector(".guideBody").scrollTop>0 && Boolean(document.querySelector(".guideBody").dataset.guideScrolling)');
  const scrolling = await measure(); assert.ok(scrolling.alpha > 0);
  assert.deepEqual({...scrolling,alpha:0}, before);
  await wait(window, idle);
  assert.deepEqual(await measure(), before);
}

/** Real BrowserWindows: native frame options plus interactive layout and persisted UI state. */
export async function checkGuideFrame({electron, repository, userData}) {
  const evidence = [];
  for (const mode of ['welcome', 'create']) {
    let records = Array.from({length: 16}, (_, id) => ({title: `Project ${id + 1}`, path: `/fixtures/project-${id}/demo.agent-project`}));
    let locale = 'en';
    const options = {repository, locale, getLocale: () => locale, mode, hidden: true,
      recent: {list: () => records}, defaultDirectory: join(userData, 'fixtures'), open: async () => {}};
    const window = await createGuideWindow(electron, options);
    try {
      // Keep physical cursor movement from cancelling Electron's injected pointer capture.
      // sendInputEvent still exercises native Chromium hit testing and pointer events.
      window.setIgnoreMouseEvents(true);
      window.show();
      const expected = mode === 'create' ? [980, 720] : [900, 640];
      assert.deepEqual(window.getSize(), expected);
      await wait(window, 'Boolean(document.querySelector(".guideResizeHandle"))');
      const defaultWidth = mode === 'create' ? 190 : 187;
      assert.equal(await sidebarWidth(window), defaultWidth);
      assert.equal(await evaluate(window, 'document.body.dataset.dshDesktopMode'), 'advanced');
      assert.equal(await evaluate(window, 'getComputedStyle(document.querySelector(".dshDesktopConversationSurface")).backgroundColor === "rgba(0, 0, 0, 0)"'), false);
      if (process.platform === 'darwin') {
        assert.deepEqual(window.getWindowButtonPosition(), {x: 16, y: 16});
        // Electron's getter returns RGB, omitting the constructor's alpha channel.
        assert.equal(window.getBackgroundColor(), '#000000');
        assert.equal(await evaluate(window, 'document.body.dataset.dshDesktopMaterial'), 'transparent');
        assert.equal(await evaluate(window, 'getComputedStyle(document.querySelector(".dshDesktopSidebarSurface")).backgroundColor'), 'rgba(0, 0, 0, 0)');
        assert.equal(await evaluate(window, 'getComputedStyle(document.querySelector(".dshDesktopMacCaptionRow")).getPropertyValue("-webkit-app-region")'), 'drag');
      }
      await drag(window, 240); assert.equal(await sidebarWidth(window), 240);
      assert.equal(savedWidths(userData)[mode], 240);
      window.webContents.sendInputEvent({type: 'mouseDown', x: 240, y: 240, button: 'left', clickCount: 2});
      window.webContents.sendInputEvent({type: 'mouseUp', x: 240, y: 240, button: 'left', clickCount: 2});
      await delay(450);
      assert.equal(await sidebarWidth(window), defaultWidth);
      assert.equal(savedWidths(userData)[mode], defaultWidth);
      await drag(window, 80); assert.equal(await sidebarWidth(window), 176);
      await drag(window, expected[0] - 20); assert.equal(await sidebarWidth(window), 280);
      await key(window, 'Home'); assert.equal(await sidebarWidth(window), 176);
      assert.notEqual(await dividerColor(window), 'rgba(0, 0, 0, 0)');
      await key(window, 'ArrowRight'); assert.equal(await sidebarWidth(window), 192);
      await key(window, 'End'); assert.equal(await sidebarWidth(window), 280);
      await drag(window, mode === 'welcome' ? 200 : 213);
      for (const language of ['en', 'zh']) for (const theme of ['light', 'dark']) {
        locale = language; electron.nativeTheme.themeSource = theme;
        window.webContents.send('project-desktop:state-changed');
        await wait(window, `document.documentElement.lang === ${JSON.stringify(language)} && document.body.hasAttribute('data-ds-dark-theme') === ${theme === 'dark'}`);
        await evaluate(window, 'document.activeElement.blur()');
        window.webContents.sendInputEvent({type: 'mouseMove', x: await sidebarWidth(window), y: 240});
        await delay(60);
        assert.equal(await dividerColor(window), 'rgba(0, 0, 0, 0)');
        await drag(window, mode === 'welcome' ? 200 : 213);
        for (const size of [expected, [700, 560], [600, 560], [576, 560], [420, 460]]) {
          window.setSize(...size);
          await wait(window, `Math.abs(innerWidth - ${size[0]}) <= 2 && Boolean(document.querySelector('[data-guide-compact]')) === (innerWidth < 576)`);
          const geometry = await evaluate(window, `(() => {
            const body=document.querySelector('.guideBody'),content=document.querySelector('.dshDesktopConversationSurface'),
              footer=document.querySelector('.${mode === 'create' ? 'createContent' : 'welcomeContent'}>footer'),
              r=footer.getBoundingClientRect(), b=body.getBoundingClientRect(), outer=footer.parentElement,
              padding=getComputedStyle(outer), bodyStyle=getComputedStyle(body), gap=parseFloat(bodyStyle.paddingRight),
              header=outer.querySelector('.toolbar'), toolbar=header.getBoundingClientRect(),
              add=outer.querySelector('.resourceEditorHeading>button'), browse=outer.querySelector('.projectPathControl>button');
            body.scrollTop=body.scrollHeight;
            return {horizontal:document.documentElement.scrollWidth>innerWidth||body.scrollWidth>body.clientWidth,
              footerVisible:r.bottom<=innerHeight&&r.top>=0,bodyHeight:body.clientHeight,contentWidth:content.clientWidth,
              gutter:bodyStyle.scrollbarGutter,contentBottomPadding:padding.paddingBottom,
              equalPadding:padding.paddingLeft===padding.paddingRight,
              bodyAligned:Math.abs(b.x-r.x)<0.1&&Math.abs(b.x+body.clientWidth-gap-r.right)<0.1,
              headerHidden:getComputedStyle(header).display==='none',
              headerAligned:Math.abs(toolbar.x-r.x)<0.1&&Math.abs(toolbar.right-r.right)<0.1,
              gutterOutside:Math.abs(b.right-r.right-(body.offsetWidth-body.clientWidth)-gap)<0.1,
              scrollbarGap:gap,scrollbarOuterGap:outer.getBoundingClientRect().right-b.right,
              rightInset:outer.getBoundingClientRect().right-r.right,
              footerPadding:getComputedStyle(footer).padding,footerHeight:r.height,
              resourceButtonMatchesBrowse:add&&browse?['height','fontSize','lineHeight','borderRadius','padding'].every(key=>getComputedStyle(add)[key]===getComputedStyle(browse)[key]):null,
              sidebarOverflow:document.querySelector('.dshDesktopUpstreamSidebar').scrollWidth>document.querySelector('.dshDesktopUpstreamSidebar').clientWidth,
              labelOverflow:[...document.querySelectorAll('.templateItemLabel')].some(label=>label.scrollWidth>label.clientWidth),
              compact:Boolean(document.querySelector('[data-guide-compact]'))};
          })()`);
          assert.equal(geometry.horizontal, false); assert.equal(geometry.footerVisible, true);
          assert.equal(geometry.equalPadding, true); assert.equal(geometry.bodyAligned, true);
          assert.equal(geometry.headerHidden, mode === 'create' && geometry.compact);
          if (!geometry.headerHidden) assert.equal(geometry.headerAligned, true);
          assert.equal(geometry.gutterOutside, true); assert.equal(geometry.scrollbarGap, 8);
          assert.equal(geometry.scrollbarOuterGap, 8); assert.equal(geometry.rightInset, 24);
          assert.equal(geometry.footerPadding, '0px'); assert.equal(geometry.footerHeight, 65);
          assert.equal(geometry.contentBottomPadding, '0px');
          if (mode === 'create') assert.equal(geometry.resourceButtonMatchesBrowse, true);
          assert.equal(geometry.sidebarOverflow, false); assert.equal(geometry.labelOverflow, false);
          assert.ok(geometry.bodyHeight > 70); assert.equal(geometry.gutter, 'stable');
          if (!geometry.compact) assert.ok(geometry.contentWidth >= 400);
          if (mode === 'create' && geometry.compact) assert.equal(await evaluate(window, 'getComputedStyle(document.querySelector(".createTemplateSelect")).display'), 'flex');
          if (size[0] === 700) await checkAutoHideScrollbar(window);
          await evaluate(window, 'document.querySelector(".guideBody").scrollTop=0');
          writeFileSync(join(userData, `${mode}-frame-${language}-${theme}-${size[0]}.png`), (await window.webContents.capturePage()).toPNG());
          evidence.push({mode, language, theme, size, geometry});
        }
        window.setSize(...expected);
        await wait(window, '!document.querySelector("[data-guide-compact]")');
        assert.equal(await sidebarWidth(window), mode === 'welcome' ? 200 : 213);
      }
      if (mode === 'welcome') {
        const measure = () => evaluate(window, '(() => {const r=document.querySelector(".recentItem").getBoundingClientRect();return {x:r.x,width:r.width}})()');
        const before = await measure(); records = records.slice(0, 1);
        window.webContents.send('project-desktop:state-changed');
        await wait(window, 'document.querySelectorAll(".recentItem").length===1');
        assert.deepEqual(await measure(), before);
      } else {
        window.setSize(700, 720);
        await wait(window, 'Math.abs(innerWidth - 700) <= 2');
        const measure = () => evaluate(window, `(() => {
          const field=document.querySelector('.projectPathControl').getBoundingClientRect(), body=document.querySelector('.guideBody');
          return {x:field.x,width:field.width,overflow:body.scrollHeight>body.clientHeight};
        })()`);
        const before = await measure(); assert.equal(before.overflow, true);
        await evaluate(window, 'document.querySelector(".templateItem[data-template-id=empty]").click()');
        await wait(window, 'document.querySelectorAll(".resourceDraft").length===0');
        const after = await measure(); assert.equal(after.overflow, false);
        assert.deepEqual({x:after.x,width:after.width}, {x:before.x,width:before.width});
        await evaluate(window, 'document.querySelector(".templateItem[data-template-id=fullstack]").click()');
        await wait(window, 'document.querySelectorAll(".resourceDraft").length===2');
        assert.deepEqual(await measure(), before);
      }
    } finally {window.destroy()}
    const reopened = await createGuideWindow(electron, options);
    try {
      reopened.show(); await wait(reopened, 'Boolean(document.querySelector(".guideResizeHandle"))');
      assert.equal(await sidebarWidth(reopened), mode === 'welcome' ? 200 : 213);
    } finally {reopened.destroy()}
  }
  assert.deepEqual(savedWidths(userData), {welcome: 200, create: 213});
  // Existing local preferences shrink once, retaining the difference between windows.
  writeFileSync(join(userData, 'guide-window-state.json'), JSON.stringify({version: 1, sidebarWidths: {welcome: 300, create: 320}}));
  for (const mode of ['welcome', 'create', 'welcome']) {
    const window = await createGuideWindow(electron, {repository, mode, locale: 'en', hidden: true,
      recent: {list: () => []}, defaultDirectory: join(userData, 'fixtures'), open: async () => {}});
    try {
      window.show(); await wait(window, 'Boolean(document.querySelector(".guideResizeHandle"))');
      assert.equal(await sidebarWidth(window), mode === 'welcome' ? 200 : 213);
    } finally {window.destroy()}
  }
  assert.equal(JSON.parse(readFileSync(join(userData, 'guide-window-state.json'), 'utf8')).version, 2);
  assert.deepEqual(savedWidths(userData), {welcome: 200, create: 213});
  writeFileSync(join(userData, 'guide-frame-layout.json'), JSON.stringify(evidence, null, 2));
  console.log('Guide frame geometry, native chrome, resizing and persistence passed.');
}
