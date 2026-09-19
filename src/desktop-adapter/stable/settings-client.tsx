import {useCallback, useState, useSyncExternalStore} from 'react';
import {Button, Menu, Modal, Switch, IconChevronDownOutline14} from '@deepseek-ai/dsh-client-ui-primitives';
import {createDesktopSettingsApi} from '../../../.upstream/desktop/dsh-plugin-desktop/src/client/desktop-settings-api.ts';
import {DesktopTerminalSettingsAction} from '../../../.upstream/desktop/dsh-plugin-desktop/src/client/DesktopTerminalSettingsAction.tsx';
import {en as desktopActionsEn, zh as desktopActionsZh} from '../../../.upstream/desktop/dsh-plugin-desktop/src/client/desktop-settings-locales.ts';
import {installDesktopSettingsStyles} from '../../../.upstream/desktop/dsh-plugin-desktop/src/client/desktop-settings-styles.ts';
import './settings.css';

const copy = {
  zh: {nav: '桌面', notifications: '启用桌面通知', notificationsBody: '项目在后台时，提醒你查看已完成或失败的操作。',
    safe: '安全模式', safeBody: '这是空白的临时诊断环境，未加载项目插件、配置和密钥。在这里的修改会在关闭后清理。使用“项目工具 → 退出安全模式”返回恢复界面。', continue: '继续诊断',
    notifyOnTurnCompletion: '会话回复完成', notifyOnTurnFailure: '会话回复失败', notifyOnJobCompletion: '后台任务完成', notifyOnJobFailure: '后台任务失败',
    material: desktopActionsZh.windowMaterial, materialBody: '设置窗口背景效果。更改后需重启当前项目窗口才能生效。',
    off: desktopActionsZh.windowMaterialOff, transparent: desktopActionsZh.windowMaterialTransparent, mica: desktopActionsZh.windowMaterialMica,
    log: '日志级别', logBody: '仅影响当前项目，保存后立即生效。', debug: '调试', info: '信息', warn: '警告', error: '错误',
    marketTitle: '插件市场', marketIntro: '为当前项目选择一个插件市场，一次只能启用一个。更改后重启当前项目生效。',
    marketDisabled: '关闭插件市场', marketDisabledBody: '不加载插件市场界面。',
    communityMarket: 'dsh-community-market', communityMarketBody: 'DSH Desktop 内置的开放插件市场，支持添加和选择自定义插件数据源。',
    beta: 'Beta', stableUnavailable: '当前 stable 运行时不可用', dshMarket: 'dsh-market', dshMarketBody: '社区热门的插件市场，数据来自 awesome-dsh-plugin。', selected: '已选择',
    restartBody: '设置已保存，请使用上方“重启”使改动生效。',
    open: '打开', unavailable: '设置暂时不可用。'},
  en: {nav: 'Desktop', notifications: 'Enable desktop notifications', notificationsBody: 'Get completion and failure notifications while this project is in the background.',
    safe: 'Safe Mode', safeBody: 'This is a blank, temporary diagnostic environment. Project plugins, configuration and credentials are not loaded. Changes here are removed on close. Use Project Tools → Exit Safe Mode to return to recovery.', continue: 'Continue diagnosis',
    notifyOnTurnCompletion: 'Conversation completed', notifyOnTurnFailure: 'Conversation failed', notifyOnJobCompletion: 'Background job completed', notifyOnJobFailure: 'Background job failed',
    material: desktopActionsEn.windowMaterial, materialBody: 'Set the window background effect. Restart this project window to apply changes.',
    off: desktopActionsEn.windowMaterialOff, transparent: desktopActionsEn.windowMaterialTransparent, mica: desktopActionsEn.windowMaterialMica,
    log: 'Log level', logBody: 'Applies immediately to this project.', debug: 'Debug', info: 'Info', warn: 'Warning', error: 'Error',
    marketTitle: 'Plugin market', marketIntro: 'Choose one plugin market for this project. Restart the project to apply changes.',
    marketDisabled: 'Turn off plugin market', marketDisabledBody: 'Do not load a plugin market interface.',
    communityMarket: 'dsh-community-market', communityMarketBody: 'The open plugin market built into DSH Desktop, with support for custom plugin data sources.',
    beta: 'Beta', stableUnavailable: 'Unavailable on the current stable runtime', dshMarket: 'dsh-market', dshMarketBody: 'A popular community plugin market powered by awesome-dsh-plugin.', selected: 'Selected',
    restartBody: 'Settings saved. Use Restart above to apply them.',
    open: 'Open', unavailable: 'Settings are temporarily unavailable.'},
};
function useScope(scope: any) {
  return useSyncExternalStore(useCallback((listener: any) => scope.subscribe(listener), [scope]), useCallback(() => scope.getSnapshot(), [scope])) as any;
}
function Row({title, body, children}: any) {
  return <div className="projectDesktopRow"><div><h3>{title}</h3>{body && <p>{body}</p>}</div>{children}</div>;
}
// Same menu composition as the official locale LanguageRow; only the row layout is ours.
function Select({value, options, disabled, onChange, label}: any) {
  const [open, setOpen] = useState(false);
  return <Menu open={open} onClose={() => setOpen(false)} items={options} selectedId={value} align="end" portal
    onSelect={id => {setOpen(false); onChange(id)}} anchor={<Button className="projectDesktopSelect" variant="outline" disabled={disabled} aria-label={label}
      aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>{options.find((item: any) => item.id === value)?.label ?? value}<IconChevronDownOutline14/></Button>}/>;
}
// Minimal adaptation of the pinned DesktopSettingsSection Choice used by the official Market selector.
function MarketChoice({title, body, badge, status, selected, disabled, onSelect}: any) {
  const actionable = !disabled && !selected;
  const choose = () => {if (actionable) onSelect()};
  return <div role="radio" className="projectMarketChoice" data-selected={selected ? 'true' : undefined}
    data-actionable={actionable ? 'true' : undefined} aria-checked={selected} aria-disabled={disabled ? 'true' : undefined}
    tabIndex={disabled ? -1 : 0} onClick={choose} onKeyDown={event => {
      if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault(); choose();
    }}><span className="projectMarketCopy"><span className="projectMarketTitle">{title}
      {badge && <span className="projectMarketBadge">{badge}</span>}{status && <span className="projectMarketBadge">{status}</span>}
    </span><span className="projectMarketBody">{body}</span></span></div>;
}
function Settings({t, shell, notifications, market, environment}: any) {
  const desktop = useScope(shell), notices = useScope(notifications), marketState = useScope(market);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [restart, setRestart] = useState(false);
  async function run(action: () => Promise<any>) {setBusy(true); setError(''); try {await action()} catch (error) {setError(String((error as Error).message))} finally {setBusy(false)}}
  const change = (field: string, value: any) => run(async () => {await shell.set(field, value); if (field !== 'logLevel') setRestart(true)});
  const fields = ['enabled', 'notifyOnTurnCompletion', 'notifyOnTurnFailure', 'notifyOnJobCompletion', 'notifyOnJobFailure'];
  const writable = desktop.status === 'ready' && desktop.writable && !busy;
  const marketWritable = marketState.status === 'ready' && marketState.writable && !busy && !environment.safeMode;
  const selectedMarket = marketState.value?.provider ?? 'dsh-market';
  const selectMarket = (provider: string) => run(async () => {await market.set('provider', provider); setRestart(true)});
  return <section className="projectDesktopSettings">
    {environment.safeMode && <Row title={t('safe')} body={t('safeBody')}/>}
    {fields.map(field => <Row key={field} title={t(field === 'enabled' ? 'notifications' : field)} body={field === 'enabled' ? t('notificationsBody') : undefined}>
      <Switch className="projectDesktopSwitch" label={t(field === 'enabled' ? 'notifications' : field)} checked={Boolean(notices.value?.[field])}
        disabled={environment.safeMode || busy || notices.status !== 'ready' || !notices.writable || (field !== 'enabled' && !notices.value?.enabled)}
        onChange={value => {void run(() => notifications.set(field, value))}}/></Row>)}
    {environment.platform !== 'linux' && <Row title={t('material')} body={t('materialBody')}><Select label={t('material')} disabled={!writable}
      value={desktop.value?.[environment.platform === 'darwin' ? 'macosMaterial' : 'windowsMaterial'] ?? 'off'}
      options={['off', ...(environment.platform === 'darwin' ? ['transparent'] : environment.micaSupported ? ['mica'] : [])].map(id => ({id, label: t(id)}))}
      onChange={(value: string) => change(environment.platform === 'darwin' ? 'macosMaterial' : 'windowsMaterial', value)}/></Row>}
    <Row title={t('log')} body={t('logBody')}><Select label={t('log')} disabled={!writable} value={desktop.value?.logLevel ?? 'info'}
      options={['debug', 'info', 'warn', 'error'].map(id => ({id, label: t(id)}))} onChange={(value: string) => change('logLevel', value)}/></Row>
    <section className="projectMarketGroup" aria-labelledby="project-market-title">
      <div><h3 id="project-market-title">{t('marketTitle')}</h3><p>{t('marketIntro')}</p></div>
      <div className="projectMarketList" role="radiogroup" aria-labelledby="project-market-title">
        <MarketChoice title={t('marketDisabled')} body={t('marketDisabledBody')} selected={selectedMarket === 'disabled'}
          disabled={!marketWritable} status={selectedMarket === 'disabled' ? t('selected') : undefined} onSelect={() => selectMarket('disabled')}/>
        <MarketChoice title={t('communityMarket')} body={t('communityMarketBody')} badge={t('beta')} status={t('stableUnavailable')} disabled/>
        <MarketChoice title={t('dshMarket')} body={t('dshMarketBody')} selected={selectedMarket === 'dsh-market'}
          disabled={!marketWritable} status={selectedMarket === 'dsh-market' ? t('selected') : undefined} onSelect={() => selectMarket('dsh-market')}/>
      </div>
    </section>
    {restart && <p className="projectDesktopRestartNotice" role="status">{t('restartBody')}</p>}
    {error && <p role="alert">{error}</p>}
    {desktop.status === 'unavailable' && <p role="status">{t('unavailable')}</p>}
  </section>;
}
export function applyProjectSettings(ctx: any, environment: any) {
  environment = {...environment, safeMode: new URLSearchParams(window.location.search).get('projectSafeMode') === '1'};
  ctx.effect(() => ctx.locale.register('project.desktop', copy), 'project-desktop: settings copy');
  const t = ctx.locale.bind('project.desktop');
  if (environment.safeMode) ctx.effect(() => ctx.slots.register({name: 'shell.overlay', id: 'project-safe-mode', inject: () => ({t})}, SafeModeNotice), 'project-desktop: safe mode notice');
  const shell = ctx.settingsScope.bind({namespace: 'dsh-desktop'});
  const notifications = ctx.settingsScope.bind({namespace: 'dsh-desktop-notifications'});
  const market = ctx.settingsScope.bind({namespace: 'dsh-project-market'});
  const api = createDesktopSettingsApi();
  // Reuse the pinned Desktop action component so busy/error states, menu
  // dismissal, keyboard handling and restart order stay aligned with upstream.
  ctx.effect(() => ctx.locale.register('desktop.settings', {zh: desktopActionsZh, en: desktopActionsEn}), 'project-desktop: native action copy');
  ctx.effect(() => installDesktopSettingsStyles(), 'project-desktop: native action styles');
  ctx.slots.inject('settings.action', () => ctx.slots.register({name: 'settings.action', id: 'project-desktop-native-actions', order: 1,
    locale: 'desktop.settings', inject: () => ({api})}, DesktopTerminalSettingsAction));
  // SettingsRoot in pinned ui-settings-general maps the official `desktop` id to its monitor icon.
  // Our shell replaces desktop-shell, so it owns this section without a competing registration.
  ctx.slots.inject('settings.section', () => ctx.slots.register({name: 'settings.section', id: 'desktop', order: 100,
    locale: 'project.desktop', label: () => t('nav'), inject: () => ({shell, notifications, market, environment})}, Settings));
}

function SafeModeNotice({t}: any) {
  const [open, setOpen] = useState(true);
  return <Modal open={open} title={t('safe')} description={t('safeBody')} closeLabel={t('continue')} onClose={() => setOpen(false)}
    footer={<Button variant="primary" onClick={() => setOpen(false)}>{t('continue')}</Button>}/>;
}
