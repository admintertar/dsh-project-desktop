/** Isolate the pinned Electron window lifecycle from the full official build. */
import {spawnSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {createRequire} from 'node:module';
const directory = resolve('.cache/native-probe');
mkdirSync(directory, {recursive: true});
writeFileSync(join(directory, 'package.json'), JSON.stringify({type: 'module', main: 'main.mjs'}));
writeFileSync(join(directory, 'index.html'), '<!doctype html><title>Native lifecycle</title><main>Window probe</main>');
writeFileSync(join(directory, 'main.mjs'), `
import electron from 'electron';
import {appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const {app,BrowserWindow,nativeTheme,Menu,screen}=electron;
const note=value=>{console.log(value);appendFileSync(join(import.meta.dirname,'phases.log'),value+'\\n')};
app.setPath('userData',join(import.meta.dirname,'user-data'));
app.on('window-all-closed',()=>{});
void (async()=>{
await app.whenReady(); note('ready');
Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'File',submenu:[{label:'New Project'}]}]));
for(const locale of ['en','zh']){
 note('create '+locale); const window=new BrowserWindow({width:980,height:720,minWidth:420,minHeight:460,show:false,
  webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:'probe'}});
 note('created');await window.loadFile(join(import.meta.dirname,'index.html'));note('loaded');
 for(const theme of ['light','dark','system']){
  note('theme '+theme);nativeTheme.themeSource=theme;await delay(150);
  note('resize');window.setSize(420,460);await delay(200);note('resized');
  await window.webContents.executeJavaScript('document.body.innerText');note('read');
 }
 note('close');const closed=new Promise(resolve=>window.once('closed',resolve));window.close();await closed;note('closed');
}
note('system theme restored before closing windows');
const welcome=new BrowserWindow({show:false});await welcome.loadFile(join(import.meta.dirname,'index.html'));
welcome.show();note('passed');app.quit();
})().catch(error=>{note(String(error.stack));app.exit(1)});
`);
const env = {...process.env, ELECTRON_ENABLE_LOGGING: '1', ELECTRON_LOG_FILE: join(directory, 'chromium.log')};
delete env.ELECTRON_RUN_AS_NODE;
const executable = createRequire(join(directory, 'package.json'))('electron');
const result=spawnSync(executable,
  [directory],{env,stdio:'inherit',timeout:30000});
console.log('Native probe exit', result.status, result.signal, result.error?.message);
process.exitCode=result.status===0?0:1;
