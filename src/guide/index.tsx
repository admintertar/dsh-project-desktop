import {useEffect, useRef, useState, type ComponentProps} from 'react';
import {createRoot} from 'react-dom/client';
import {Button, Input, Menu, Modal, IconEllipsisOutline16, IconFolderOpenOutline16, IconLinkOutline16, IconProjectAddOutline16, IconSearchOutline16, IconPlusOutline16,
  IconChevronLeftOutline14, IconChevronDownOutline14, IconWarningOutline16, IconTrashOutline16, IconBranchOutline16, IconEditOutline16, IconCloseOutline16, IconLoadingOutline16, Tag, Tooltip} from '@deepseek-ai/dsh-client-ui-primitives';
import './style.css';
import {createGuideLocale} from '../desktop-adapter/stable/guide-locale';
import {GuideResourceAuth, ProjectSelect, createGuideAuthController, guideResourceCopy, resourceErrorText} from '../desktop-adapter/stable/guide-resources-client';
import {RemoteRepositoryModal} from './RemoteRepositoryModal';
import {AddResourceModal} from './AddResourceModal';
import {CloneRepositoryModal} from './CloneRepositoryModal';
import {defaultResourceTarget, draftResourceTarget} from '../shared/resource-draft.mjs';
import {projectPathPreview} from '../shared/project-path.mjs';
import {PROJECT_COMPOSITIONS as templates, RESOURCE_ROLE_KEYS} from '../shared/project-templates.mjs';
import {useModalBoundary} from './useModalBoundary';
import {GuideFrame} from '../desktop-adapter/stable/GuideFrame';

const copy = {
  zh: {title: '项目', body: '会话、资料、记忆和任务，都从这里开始。', resizeSidebar: '调整侧栏宽度',
    opening: '打开中…', creating: '创建中…', openingRecent: '正在打开…', preparing: '正在准备新项目…', checkUpdates: '检查更新', checkingUpdates: '正在检查更新…', downloading: '正在下载',
    creatingDetail: '正在创建项目文件和本地仓库…', openingDetail: '正在打开项目窗口…',
    roleBackend: '服务端', roleWeb: 'Web 前端', roleMiniapp: '小程序', roleApp: '移动端', roleAdmin: '管理后台', roleDesktop: '桌面端',
    linkResource: '关联资源', resourceSource: '资源来源', sourceRemote: '远程仓库', sourceLocal: '本地文件夹', unlinkResource: '取消关联', editRemote: '编辑仓库地址和分支', editLocal: '更换本地文件夹',
    remoteBranch: '分支', remoteBranchHint: '留空使用仓库的默认分支。', defaultBranch: '默认分支', saveAndClone: '保存并克隆', saving: '正在保存…', unlinkRemote: '取消关联',
    remoteUrlHint: '支持 HTTPS 或 SSH，需要时会提示认证。', remoteUrlRequired: '请输入仓库地址。', remoteUrlInvalid: '请输入不含密码或令牌的 HTTPS 或 SSH 仓库地址。', remoteBranchInvalid: '请输入有效分支名，不可包含空格、.. 或 ~ ^ : ? * [ \\ 等字符。',
    cloneReady: '克隆完成', clonePending: '正在准备克隆…', cloneWaiting: '等待克隆完成后即可创建项目。',
    choose: '选择项目文件夹…', open: '打开已有项目…', recent: '最近项目', create: '创建并打开', existing: '打开项目', addResource: '添加资源', removeResource: '移除资源',
    projectName: '项目名称', projectPath: '项目路径', template: '项目组合', fullstack: 'Web 应用', admin: '管理系统', miniapp: '小程序项目', app: '移动应用', desktop: '桌面应用', emptyTemplate: '空项目', resources: '资源', resourceName: '资源名称', emptyResource: '将新建本地 Git 仓库', localResource: '关联本地文件', remoteResource: '关联远程仓库', linkLocal: '关联本地文件', linkRemote: '关联远程仓库', remoteUrl: 'Git 仓库地址', remoteUrlPlaceholder: 'https://github.com/org/repository.git', renameResource: '双击修改资源名称',
    folder: '项目文件夹', file: '项目文件', back: '重新选择', retry: '重试', resourceHint: '未关联的资源将在创建项目时初始化为独立的本地 Git 仓库；也可关联远程仓库或本地文件夹。',
    hint: '项目会创建在这个路径下，项目名称作为项目文件夹名。', browse: '浏览…', cancel: '取消',
    search: '搜索项目', new: '新建项目', openShort: '打开', openRecent: '打开项目', recentActions: '项目操作', removeRecent: '从最近项目中移除', empty: '开始你的第一个项目', noMatches: '没有找到匹配的项目',
    footer: '退出应用时保留打开的项目，下次启动时自动恢复。', recovery: '需要处理的项目', retryOpen: '重试打开',
    locate: '重新定位', forget: '不再自动打开',
    details: '查看详情', pending: '项目尚未打开，可以重试或重新定位项目文件。',
    interrupted: '上次在启动这个项目时退出了。请手动重试，避免反复启动失败。',
    unreadable: '上次的窗口记录无法读取，原文件已保留。可以从最近项目重新打开。', historyUnreadable: '最近项目记录无法读取，原文件已保留。你仍然可以打开项目文件。', backProjects: '返回项目', sameConfig: '当前配置与检查点一致。',
    clone: '克隆仓库', cloneTitle: '从 Git 仓库克隆项目', cloneStart: '克隆并打开', cloneCancel: '取消克隆', clonePreparing: '正在准备克隆…', cloneInstalling: '正在校验项目…', cloneFailed: '克隆失败。',
    cloneUrlHint: '支持 HTTPS 或 SSH。克隆完成后会检测仓库里的 .agent-project 项目文件。', cloneDirectory: '本地目录', cloneDirectoryHint: '仓库会克隆到这个目录下新建的文件夹里。', cloneDirectoryRequired: '请选择本地目录。',
    cloneName: '文件夹名称', cloneNameHint: '克隆后项目文件夹的名称，可直接修改。', cloneNameInvalid: '请输入合法的文件夹名称：不能包含 / 或 \\，也不能以 .agent-project 结尾。', cloneTargetExists: '这个目录下已有同名文件夹，请更改文件夹名称或本地目录。',
    notAProject: '这个文件夹不是 agent-project 项目：没有找到 .agent-project 项目文件。', multipleProjects: '这个文件夹里有多个 .agent-project 项目文件，请直接选择其中一个打开。',
    cloneNotAProject: '这个仓库不是 agent-project 项目：没有找到 .agent-project 项目文件，刚才克隆的内容已删除。', cloneAmbiguous: '这个仓库包含多个 .agent-project 项目文件，无法自动确定打开哪一个。克隆的内容已保留在 {path}。',
    projectTargetExists: '这个位置已有同名文件夹且不为空。请更换项目名称或路径，或改用「打开已有项目」。'},
  en: {title: 'Projects', body: 'A home for your conversations, resources, memory and tasks.', resizeSidebar: 'Resize sidebar',
    opening: 'Opening…', creating: 'Creating…', openingRecent: 'Opening…', preparing: 'Preparing a new project…', checkUpdates: 'Check for updates', checkingUpdates: 'Checking for updates…', downloading: 'Downloading',
    creatingDetail: 'Creating project files and local repositories…', openingDetail: 'Opening the project window…',
    roleBackend: 'Backend', roleWeb: 'Web frontend', roleMiniapp: 'Mini program', roleApp: 'Mobile app', roleAdmin: 'Admin panel', roleDesktop: 'Desktop app',
    linkResource: 'Link resource', resourceSource: 'Resource source', sourceRemote: 'Remote repository', sourceLocal: 'Local folder', unlinkResource: 'Unlink resource', editRemote: 'Edit repository URL and branch', editLocal: 'Change local folder',
    remoteBranch: 'Branch', remoteBranchHint: 'Leave empty to use the repository’s default branch.', defaultBranch: 'Default branch', saveAndClone: 'Save and clone', saving: 'Saving…', unlinkRemote: 'Unlink repository',
    remoteUrlHint: 'HTTPS or SSH. Authentication is requested when needed.', remoteUrlRequired: 'Enter a repository URL.', remoteUrlInvalid: 'Enter an HTTPS or SSH repository URL without a password or token.', remoteBranchInvalid: 'Enter a valid branch name without spaces, .. or ~ ^ : ? * [ \\ characters.',
    cloneReady: 'Clone complete', clonePending: 'Preparing clone…', cloneWaiting: 'Finish cloning resources before creating the project.',
    choose: 'Choose project folder…', open: 'Open existing project…', recent: 'Recent projects', create: 'Create and open', existing: 'Open project', addResource: 'Add resource', removeResource: 'Remove resource',
    projectName: 'Project name', projectPath: 'Project path', template: 'Project composition', fullstack: 'Web application', admin: 'Admin system', miniapp: 'Mini-program project', app: 'Mobile application', desktop: 'Desktop application', emptyTemplate: 'Empty project', resources: 'Resources', resourceName: 'Resource name', emptyResource: 'Will create a local Git repository', localResource: 'Link local files', remoteResource: 'Link remote repository', linkLocal: 'Link local files', linkRemote: 'Link remote repository', remoteUrl: 'Git repository URL', remoteUrlPlaceholder: 'https://github.com/org/repository.git', renameResource: 'Double-click to rename resource',
    folder: 'Project folder', file: 'Project file', back: 'Choose again', retry: 'Retry', resourceHint: 'Unlinked resources become independent local Git repositories when the project is created. You can also link a remote repository or local folder.',
    hint: 'The project is created under this path, using the project name as its folder.', browse: 'Browse…', cancel: 'Cancel',
    search: 'Search projects', new: 'New Project', openShort: 'Open', openRecent: 'Open project', recentActions: 'Project actions', removeRecent: 'Remove from Recent Projects', empty: 'Start your first project', noMatches: 'No matching projects',
    footer: 'Open projects are remembered when you quit and restored on your next launch.', recovery: 'Projects needing attention', retryOpen: 'Retry opening',
    locate: 'Locate project', forget: 'Stop opening automatically',
    details: 'Show details', pending: 'This project is not open. Retry or locate the project file.',
    interrupted: 'The app exited while this project was starting. Retry manually to avoid a repeated startup failure.',
    unreadable: 'The last window record could not be read. The original file was preserved. Reopen a recent project to continue.', historyUnreadable: 'Recent history could not be read. The original file was preserved. You can still open project files.', backProjects: 'Back to projects', sameConfig: 'The current settings match this checkpoint.',
    clone: 'Clone Repository', cloneTitle: 'Clone Project from Git Repository', cloneStart: 'Clone and open', cloneCancel: 'Cancel clone', clonePreparing: 'Preparing the clone…', cloneInstalling: 'Verifying the project…', cloneFailed: 'The clone failed.',
    cloneUrlHint: 'HTTPS or SSH. The clone is accepted only when it contains an .agent-project file.', cloneDirectory: 'Local directory', cloneDirectoryHint: 'The repository is cloned into a new folder under this directory.', cloneDirectoryRequired: 'Choose a local directory.',
    cloneName: 'Folder name', cloneNameHint: 'Name of the project folder the clone creates; edit it if you like.', cloneNameInvalid: 'Enter a valid folder name without / or \\ and without the .agent-project suffix.', cloneTargetExists: 'A folder with this name already exists there. Change the folder name or the local directory.',
    notAProject: 'This folder is not an agent-project: no .agent-project file was found.', multipleProjects: 'This folder contains several .agent-project files. Open one of them directly.',
    cloneNotAProject: 'This repository is not an agent-project: no .agent-project file was found, so the clone was removed.', cloneAmbiguous: 'This repository contains several .agent-project files, so none can be chosen automatically. The clone was kept at {path}.',
    projectTargetExists: 'A non-empty folder with this name already exists. Change the name or path, or open the existing project.'},
};
const api = (window as any).projectGuide;
const localeService = createGuideLocale(copy);
localeService.register('project-guide-resources', guideResourceCopy);
/** Stable Host error codes become actionable, localized guide copy instead of a raw message. */
const guideErrorKeys: Record<string, string> = {'project-target-exists': 'projectTargetExists', 'project-not-found': 'notAProject',
  'project-ambiguous': 'multipleProjects', 'repository-name-invalid': 'cloneNameInvalid', 'repository-directory-invalid': 'cloneDirectoryRequired',
  'repository-target-exists': 'cloneTargetExists', 'repository-not-project': 'cloneNotAProject', 'repository-ambiguous': 'cloneAmbiguous'};
function guideErrorText(message: string, t: Record<string, string>): string {
  const separator = message.indexOf(':');
  const key = guideErrorKeys[separator === -1 ? message : message.slice(0, separator)];
  if (!key) return message;
  // Only `repository-ambiguous` carries a path, so the placeholder is inert elsewhere.
  return separator === -1 ? t[key] : t[key].replace('{path}', message.slice(separator + 1));
}
function makeResources(name: string, templateId: string) {
  const template = templates.find(item => item.id === templateId) ?? templates[0];
  return template.roles.map(role => ({id: role, role, name: `${name}-${role}`, path: defaultResourceTarget(`${name}-${role}`), url: '', mode: 'empty', customName: false}));
}
function nextResourceId(items: any[]) {
  let number = 1;
  while (items.some(item => item.id === `resource-${number}`)) number += 1;
  return `resource-${number}`;
}
type GuidePhase = 'creating' | 'opening';
type GuideOperation = {id: string; action: string; target?: string; phase?: GuidePhase};

// The pinned official Button has no loading prop. Compose its exported loading
// icon and reserve all label widths while retaining official button interaction.
function GuideActionButton({label, phase, allowCreate = false, t, ...props}: Omit<ComponentProps<typeof Button>, 'children' | 'icon'> & {
  label: string; phase?: GuidePhase; allowCreate?: boolean; t: Record<string, string>;
}) {
  const labels = [{id: 'idle', text: label}, ...(allowCreate ? [{id: 'creating', text: t.creating}] : []), {id: 'opening', text: t.opening}];
  return <Button {...props} aria-busy={Boolean(phase)} aria-label={phase ? t[phase] : label}>
    <span className="guideActionLabel">{labels.map(item => <span key={item.id} aria-hidden={item.id !== (phase ?? 'idle')}
      style={{visibility: item.id === (phase ?? 'idle') ? 'visible' : 'hidden'}}>
      {item.id !== 'idle' && <IconLoadingOutline16 className="guideLoadingIcon"/>}{item.text}
    </span>)}</span>
  </Button>;
}

function RecentProjectRow({item, busy, opening, t, onOpen, onRemove}: any) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {if (busy) setMenuOpen(false)}, [busy]);
  const unavailable = item.available === false;
  return <article className="recentProject" aria-busy={opening} data-menu-open={menuOpen ? 'true' : undefined} data-unavailable={unavailable ? 'true' : undefined}>
    <Button className="recentItem" variant="toolbar" disabled={busy || unavailable} icon={<IconFolderOpenOutline16/>} onClick={() => {if (!unavailable) onOpen()}}>
      <span>{item.title}<small>{item.path}</small></span>
    </Button>
    <div className="recentTrailing" data-opening={opening || undefined}>
    <span className="recentOpening" aria-hidden={!opening}><IconLoadingOutline16 className="guideLoadingIcon"/>{t.openingRecent}</span>
    <Menu open={menuOpen} onClose={() => setMenuOpen(false)} align="end" portal dense items={[
      {id: 'open', label: t.openRecent, icon: <IconFolderOpenOutline16/>, disabled: unavailable},
      {type: 'separator', id: 'recent-project-separator'},
      {id: 'remove', label: t.removeRecent, icon: <IconTrashOutline16/>, danger: true},
    ]} onSelect={id => {setMenuOpen(false); if (id === 'open' && !unavailable) onOpen(); if (id === 'remove') onRemove();}}
      anchor={<button type="button" className="recentMore" aria-label={`${t.recentActions}: ${item.title}`} aria-expanded={menuOpen}
        disabled={busy} onClick={() => setMenuOpen(value => !value)}><IconEllipsisOutline16/></button>}/>
    </div>
  </article>;
}
function ResourceDraftCard({item, busy, t, rt, clone, onRename, onEditRemote, onPickLocal, onUnlink, onCancelClone, onRemove}: any) {
  const [editing, setEditing] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const sourceControl = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(item.name);
  const finishRename = () => {
    const next = name.trim();
    if (next) onRename(next); else setName(item.name);
    setEditing(false);
  };
  useEffect(() => {if (!editing) setName(item.name)}, [item.name, editing]);
  useEffect(() => {if (busy) setSourceOpen(false)}, [busy]);
  const sourceLabel = item.mode === 'remote' ? t.sourceRemote : item.mode === 'link' ? t.sourceLocal : t.linkResource;
  const roleKey = RESOURCE_ROLE_KEYS[item.role as keyof typeof RESOURCE_ROLE_KEYS];
  const cloning = clone && ['cloning', 'cancelling'].includes(clone.status);
  const status = item.mode === 'remote' ? !clone ? t.clonePending : clone.status === 'completed' ? t.cloneReady
    : rt(({cloning: 'resourceCloning', cancelling: 'resourceCancelling', cancelled: 'resourceCancelled', failed: 'resourceCloneFailed',
      pending: 'resourcePending', interrupted: 'resourceInterrupted'} as any)[clone.status] ?? 'resourceCloning')
    : item.mode === 'link' ? t.localResource : t.emptyResource;
  return <article className="resourceDraft">
    <div className="resourceDraftBody">
      <div className="resourceDraftTitleRow">
        <div className="resourceDraftIdentity">{editing
          ? <Input className="resourceDraftNameInput" aria-label={t.resourceName} autoFocus value={name} disabled={busy}
            onChange={event => setName(event.target.value)} onBlur={finishRename} onKeyDown={event => {
              if (event.key === 'Enter') {event.preventDefault(); finishRename()}
              if (event.key === 'Escape') {event.preventDefault(); setName(item.name); setEditing(false)}
            }}/>
          : <Tooltip label={`${item.name} · ${t.renameResource}`} side="top"><span className="resourceDraftNameAnchor"><Button size="sm" className="resourceDraftName" disabled={busy}
            onDoubleClick={() => {setName(item.name); setEditing(true)}} onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); setName(item.name); setEditing(true)}
            }}><strong>{item.name}</strong></Button></span></Tooltip>}
        </div>
        {roleKey && <Tag className="resourceDraftRole" tone="neutral">{t[roleKey]}</Tag>}
      </div>
      <div className="resourceDraftSourceControl" ref={sourceControl}>
        {/* Same Menu/chevron composition as the official LanguageRow, using the compact ghost Button. */}
        <Menu open={sourceOpen} onClose={() => setSourceOpen(false)} portal dense autoFocus selectedId={item.mode} items={[
          {id: 'remote', label: t.sourceRemote, icon: <IconLinkOutline16/>},
          {id: 'link', label: t.sourceLocal, icon: <IconFolderOpenOutline16/>},
          ...(item.mode === 'empty' ? [] : [{type: 'separator' as const, id: 'source-separator'},
            {id: 'unlink', label: t.unlinkResource, icon: <IconCloseOutline16/>}]),
        ]} onSelect={id => {
          setSourceOpen(false);
          const opener = sourceControl.current?.querySelector('button');
          opener?.focus();
          if (id === 'remote') onEditRemote(opener);
          if (id === 'link') onPickLocal();
          if (id === 'unlink') onUnlink();
        }} anchor={<Button size="sm" className="resourceDraftSource" disabled={busy}
          icon={item.mode === 'link' ? <IconFolderOpenOutline16/> : <IconLinkOutline16/>}
          aria-label={`${t.resourceSource}: ${sourceLabel} · ${item.name}`} aria-haspopup="menu" aria-expanded={sourceOpen}
          onClick={() => setSourceOpen(open => !open)} onKeyDown={event => {
            if (event.key === 'ArrowDown') {event.preventDefault(); setSourceOpen(true)}
          }}>{sourceLabel}<IconChevronDownOutline14/></Button>}/>
      </div>
      {item.mode === 'remote' && <div className="resourceDraftRemote"><div><IconLinkOutline16/><span className="resourceDraftRemoteValue">{item.url}</span>
        <Tooltip label={t.editRemote} side="top"><span className="resourceDraftEdit"><Button size="sm" disabled={busy}
          icon={<IconEditOutline16/>} aria-label={`${t.editRemote}: ${item.name}`} onClick={event => onEditRemote(event.currentTarget)}/></span></Tooltip></div>
        <div><IconBranchOutline16/><span className="resourceDraftRemoteValue">{item.branch || t.defaultBranch}</span></div>
        {clone?.error && <p className="project-error" role="alert">{resourceErrorText(clone.error, rt)}</p>}</div>}
      <div className="resourceDraftPath"><IconFolderOpenOutline16/><span>{item.path}</span>
        {item.mode === 'link' && <Tooltip label={t.editLocal} side="top"><span className="resourceDraftEdit"><Button size="sm" disabled={busy}
          icon={<IconEditOutline16/>} aria-label={`${t.editLocal}: ${item.name}`} onClick={onPickLocal}/></span></Tooltip>}
      </div>
    </div>
    <footer className="resourceDraftFooter"><span className="resourceDraftStatus" role="status">{status}
      {cloning && clone.phase && ` · ${rt(clone.phase === 'receiving' ? 'resourceReceiving' : clone.phase === 'resolving' ? 'resourceResolving' : 'resourceCheckout')} ${clone.percent ?? 0}%`}</span>
      <div className="resourceDraftActions">
        {cloning && <Button size="sm" disabled={busy || clone.status === 'cancelling'} onClick={onCancelClone}>{t.cancel}</Button>}
        <Tooltip label={t.removeResource} side="top"><span className="resourceDraftRemove"><Button size="sm" icon={<IconTrashOutline16/>}
          aria-label={`${t.removeResource}: ${item.name}`} disabled={busy} onClick={onRemove}/></span></Tooltip>
      </div>
    </footer>
  </article>;
}
function ProjectPathField({directory, projectName, busy, t, platform, onChange, onBrowse}: any) {
  return <div className="setting projectPathSetting"><div><h2>{t.projectPath}</h2>
    <div className="projectPathControl"><Input aria-label={t.projectPath} value={directory} disabled={busy}
      onChange={event => onChange(event.target.value)}/><Button variant="outline" disabled={busy} onClick={onBrowse}>{t.browse}</Button></div>
    <p className="projectPathPreview">{projectPathPreview(directory, projectName || 'project', platform)}</p>
  </div></div>;
}
function Guide() {
  const rememberModalOpener = useModalBoundary();
  const createOnly = new URLSearchParams(location.search).get('mode') === 'create';
  const [locale, setLocale] = useState<'zh' | 'en'>('en');
  const [recent, setRecent] = useState<Array<{path: string; title: string; available: boolean}>>([]);
  const [failures, setFailures] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [warning, setWarning] = useState('');
  const [version, setVersion] = useState('');
  const [updates, setUpdates] = useState<{label: string; busy: boolean; phase?: string; progress?: {percent?: number}}>();
  const [frameState, setFrameState] = useState<any>();
  const [details, setDetails] = useState<string>();
  const [selection, setSelection] = useState<any>();
  const [cloningRepository, setCloningRepository] = useState(false);
  const [templateId, setTemplateId] = useState('fullstack');
  const [projectName, setProjectName] = useState('');
  const [draftResources, setDraftResources] = useState<any[]>([]);
  const [remoteDraft, setRemoteDraft] = useState<any>();
  const [addingResource, setAddingResource] = useState<string>();
  const [clones, setClones] = useState<any[]>([]);
  const [auth] = useState(() => createGuideAuthController(api.invoke));
  const [operation, setOperation] = useState<GuideOperation>();
  const operationId = useRef<string>();
  const busy = Boolean(operation);
  const [progressId, setProgressId] = useState<string>();
  const [error, setError] = useState('');
  const runRef = useRef(run);
  runRef.current = run;
  localeService.setLocale(locale);
  const translate = localeService.bind('project-desktop-guide');
  const rt = localeService.bind('project-guide-resources');
  const t = Object.fromEntries(Object.keys(copy.en).map(key => [key, translate(key)]));
  /** Guide-owned codes first, then the plugin's resource codes; unknown codes stay verbatim. */
  const describeError = (message: string) => {const text = guideErrorText(message, t); return text === message ? resourceErrorText(message, rt) : text;};
  async function refresh() {const state = await api.invoke('state');
    setLocale(state.locale); setRecent(state.recent); setFailures(state.failures ?? []); setWarning(state.warning ?? ''); setVersion(state.version);
    setUpdates(state.updates);
    setFrameState({chrome: state.chrome, sidebarWidth: state.sidebarWidth, defaultDirectory: state.defaultDirectory,
      importDirectory: state.importDirectory});
    document.documentElement.lang = state.locale;
  }
  useEffect(() => {
    const update = () => {void refresh().catch((e: Error) => setError(e.message))}; update();
    const offState = api.onStateChanged(update);
    const offCommand = api.onCommand((action: string) => {void runRef.current(action)});
    const offProgress = api.onProgress((progress: {id: string; phase: GuidePhase}) => {
      if (progress.id !== operationId.current || !['creating', 'opening'].includes(progress.phase)) return;
      setOperation(current => current?.id === progress.id ? {...current, phase: progress.phase} : current);
    });
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {document.body.toggleAttribute('data-ds-dark-theme', media.matches); document.documentElement.style.colorScheme = media.matches ? 'dark' : 'light'};
    apply(); media.addEventListener('change', apply); return () => {offState(); offCommand(); offProgress(); media.removeEventListener('change', apply)};
  }, []);
  useEffect(() => {
    setProgressId(undefined);
    if (!operation?.phase) return;
    const timer = setTimeout(() => setProgressId(operation.id), 1000);
    return () => clearTimeout(timer);
  }, [operation?.id, Boolean(operation?.phase)]);
  const progressText = operation?.id === progressId && operation?.phase ? t[`${operation.phase}Detail`] : '';
  const actionPhase = (action: string, target?: string) => operation?.action === action
    && (target === undefined || operation.target === target) ? operation.phase : undefined;
  useEffect(() => {if (createOnly) void runRef.current('new')}, [createOnly]);
  useEffect(() => {
    let closed = false, loading = false;
    const update = async () => {
      if (loading) return; loading = true;
      try {const items = await api.invoke('clone-state'); if (!closed) setClones(items)}
      catch { /* A closed window no longer has a draft. */ }
      finally {loading = false}
    };
    const timer = setInterval(update, 500);
    return () => {closed = true; clearInterval(timer); auth.dispose()};
  }, [auth]);
  const remoteIds = JSON.stringify(draftResources.filter(item => item.mode === 'remote').map(item => item.id));
  useEffect(() => {
    if (selection && !selection.existing) void api.invoke('clone-retain', {ids: JSON.parse(remoteIds)}).catch((e: Error) => setError(e.message));
  }, [remoteIds, selection?.existing]);
  async function run(action: string, value?: any) {
    // Lock synchronously too: native menu commands and rapid clicks may arrive
    // before React renders the disabled controls.
    if (operationId.current) return;
    const id = crypto.randomUUID(); operationId.current = id;
    setOperation({id, action, target: typeof value === 'string' ? value : value?.path,
      phase: ['recent', 'retry'].includes(action) ? 'opening' : action === 'confirm' ? selection?.existing ? 'opening' : 'creating' : undefined});
    setError('');
    try {
      const result = await api.invoke(action, value, id);
      if ((action === 'new' || action === 'choose') && result && typeof result === 'object') {
        const name = action === 'new' ? '' : result.name ?? '';
        setSelection(result); setProjectName(name); setTemplateId('fullstack'); setDraftResources(makeResources(name || 'project', 'fullstack'));
      }
      if (action === 'browse-location' && result) setSelection((current: any) => current ? {...current, directory: result} : current);
      if (action === 'pick-resource' && result && value && typeof value.id === 'string') {
        setDraftResources(items => items.map(item => item.id === value.id ? {...item, mode: 'link', path: result, type: undefined, url: '', branch: ''} : item));
      }
      if (action === 'remove-recent' && Array.isArray(result)) setRecent(result);
      if (['forget', 'retry', 'relocate'].includes(action)) await refresh();
    }
    catch (e) {setError(guideErrorText((e as Error).message, t))} finally {operationId.current = undefined; setOperation(undefined)}
  }
  const filtered = recent.filter(item => `${item.title} ${item.path}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selectTemplate = (id: string) => {setTemplateId(id); setDraftResources(makeResources(projectName || selection?.name || 'project', id))};
  const addResource = (event: React.MouseEvent<HTMLButtonElement>) => {
    rememberModalOpener(event.currentTarget); setAddingResource(nextResourceId(draftResources));
  };
  const removeResource = (index: number) => setDraftResources(items => items.filter((_item, currentIndex) => currentIndex !== index));
  const unlinkResource = (id: string) => setDraftResources(items => items.map(item => item.id === id
    ? {...item, mode: 'empty', path: draftResourceTarget(item), type: undefined, url: '', branch: ''} : item));
  const updateProjectName = (name: string) => {
    setProjectName(name); setDraftResources(items => items.map(item => !item.customName
      ? {...item, name: `${name || 'project'}-${item.id}`, ...(item.mode === 'link' || item.customPath ? {} : {path: defaultResourceTarget(`${name || 'project'}-${item.id}`)})} : item));
  };
  const resourceCards = draftResources.map((item, index) => <ResourceDraftCard key={item.id} item={item} busy={busy} t={t} rt={rt}
    clone={clones.find(clone => clone.id === item.id && clone.url === item.url && clone.branch === (item.branch ?? ''))}
    onRename={(name: string) => setDraftResources(items => items.map((current, currentIndex) => currentIndex === index
      ? {...current, name, ...(current.mode === 'link' || current.customPath ? {} : {path: defaultResourceTarget(name)}), customName: true} : current))}
    onEditRemote={(opener: HTMLElement) => {rememberModalOpener(opener); setRemoteDraft(item)}}
    onPickLocal={() => void run('pick-resource', {id: item.id})}
    onUnlink={() => unlinkResource(item.id)}
    onCancelClone={() => void api.invoke('clone-cancel', {id: item.id}).catch((e: Error) => setError(e.message))}
    onRemove={() => removeResource(index)}/>);
  const resourcesReady = draftResources.every(item => item.mode !== 'remote' || clones.some(clone => clone.id === item.id
    && clone.url === item.url && clone.branch === (item.branch ?? '') && clone.status === 'completed'));
  const reset = () => {void api.invoke('clone-retain', {ids: []}).catch(() => {}); setSelection(undefined); setError(''); setDraftResources([])};
  const dialogs = <><GuideResourceAuth controller={auth} t={rt}/>{cloningRepository && <CloneRepositoryModal t={t} rt={rt} clones={clones} invoke={api.invoke}
    errorText={describeError} defaultDirectory={frameState?.importDirectory ?? frameState?.defaultDirectory} platform={frameState?.chrome?.platform}
    onClose={() => setCloningRepository(false)}/>}{addingResource && <AddResourceModal resources={draftResources} t={rt}
    pickDirectory={() => api.invoke('pick-resource', {id: addingResource, inspect: true})} onClose={() => setAddingResource(undefined)}
    onSave={async (resource: any) => {
      const id = addingResource;
      if (resource.mode === 'remote') {
        const operation = await api.invoke('clone-start', {id, name: resource.name, url: resource.url, branch: resource.branch});
        setClones(items => [...items.filter(item => item.id !== id), operation]);
      }
      setDraftResources(items => [...items, {...resource, id, role: 'resource', manual: true, customName: true, customPath: true}]);
    }}/>} {remoteDraft && <RemoteRepositoryModal item={remoteDraft} t={t} rt={rt}
    onClose={() => setRemoteDraft(undefined)} onSave={async (remote: any) => {
      const operation = await api.invoke('clone-start', {id: remoteDraft.id, name: remoteDraft.name, ...remote});
      setClones(items => [...items.filter(item => item.id !== operation.id), operation]);
      setDraftResources(items => items.map(item => item.id === remoteDraft.id ? {...item, ...remote, type: undefined, mode: 'remote', path: draftResourceTarget(item)} : item));
    }} onUnlink={() => unlinkResource(remoteDraft.id)}/>}</>;
  if (!frameState) return null;
  const frameProps = {chrome: frameState.chrome, initialWidth: frameState.sidebarWidth, resizeLabel: t.resizeSidebar,
    onWidthChange: (width: number) => {void api.invoke('sidebar-width', width).catch((e: Error) => setError(e.message))}, overlay: dialogs};
  if (createOnly) return <GuideFrame {...frameProps} defaultWidth={190} className="createWindow" sidebar={
    <div className="createNav"><h1>{t.new}</h1><nav className="templateList" aria-label={t.template}><h2>{t.template}</h2>
      {templates.map(item => <Button key={item.id} className="templateItem" data-template-id={item.id} variant="toolbar"
        aria-pressed={templateId === item.id} disabled={busy} onClick={() => selectTemplate(item.id)}><span className="templateItemLabel">{t[item.key]}</span></Button>)}
    </nav><div className="createTemplateSelect"><h2>{t.template}</h2><ProjectSelect label={t.template} value={templateId}
      disabled={busy} options={templates.map(item => ({value: item.id, label: t[item.key]}))} onChange={selectTemplate}/></div></div>}>
    <div className="createContent">
    <header className="toolbar"><h1>{t[templates.find(item => item.id === templateId)!.key]}</h1></header>
    <section className="guideBody" aria-busy={busy}>
      {!selection ? <p role="status">{t.preparing}</p> : selection.existing ? <div className="setting"><div><h2>{t.folder}</h2><p>{selection.directory}</p></div></div> : <>
        <div className="setting"><div><h2>{t.projectName}</h2><Input aria-label={t.projectName} autoFocus disabled={busy} value={projectName} onChange={event => updateProjectName(event.target.value)} /></div></div>
        <ProjectPathField directory={selection.directory} projectName={projectName} busy={busy} t={t} platform={frameState.chrome.platform}
          onChange={(directory: string) => setSelection((current: any) => current ? {...current, directory} : current)} onBrowse={() => run('browse-location')}/>
        <section className="resourceEditor" aria-labelledby="create-resources-title"><div className="resourceEditorHeading"><div><h2 id="create-resources-title">{t.resources}</h2><p>{t.resourceHint}</p></div><Button variant="outline" icon={<IconPlusOutline16 />} disabled={busy} onClick={addResource}>{t.addResource}</Button></div>
          {draftResources.length > 0 && <div className="resourceGrid">{resourceCards}</div>}
        </section>
      </>}
      {error && <p className="error" role="alert">{error}</p>}
      {!resourcesReady && <p>{t.cloneWaiting}</p>}
    </section>
    <footer><Button disabled={busy} onClick={() => run('cancel')}>{t.cancel}</Button>
      <p className="guideProgress" role="status" title={progressText}>{progressText}</p>
      <GuideActionButton variant="primary" label={t.create} phase={actionPhase('confirm')} allowCreate t={t}
        disabled={busy || !projectName.trim() || !selection?.directory.trim() || !resourcesReady || Boolean(selection?.existing)}
        onClick={() => run('confirm', {name: projectName, location: selection.directory, templateId, resources: draftResources})}/></footer>
    </div>
  </GuideFrame>;
  return <GuideFrame {...frameProps} className="welcome" sidebar={
    <div className="welcomeNav"><div className="brand"><IconProjectAddOutline16 size={42}/><div><strong>DSH Project</strong><small>Desktop · {version}</small></div></div>
      <Button className="projectNav" variant="toolbar" icon={<IconFolderOpenOutline16/>} disabled={busy} onClick={reset} aria-current="page">{t.title}</Button>
      {selection && !selection.existing && <div className="templateList"><h2>{t.template}</h2>{templates.map(item => <Button key={item.id} className="templateItem" data-template-id={item.id} variant="toolbar" aria-pressed={templateId === item.id} disabled={busy} onClick={() => selectTemplate(item.id)}><span className="templateItemLabel">{t[item.key]}</span></Button>)}</div>}
      <p className="navCaption">{t.body}</p></div>}>
    <div className="welcomeContent">
      <header className="toolbar">{selection ? <><Button icon={<IconChevronLeftOutline14/>} disabled={busy} onClick={reset}>{t.backProjects}</Button><h1>{t.new}</h1></>
        : <><div className="search"><Input icon={<IconSearchOutline16/>} placeholder={t.search} aria-label={t.search} value={query}
          onChange={event => setQuery(event.target.value)}/></div><div className="actions">
          <Button variant="outline" data-guide-action="clone" icon={<IconBranchOutline16/>} disabled={busy}
            onClick={event => {
              rememberModalOpener(event.currentTarget);
              // Read the remembered import directory before the dialog mounts its default.
              void refresh().catch(() => {}).then(() => setCloningRepository(true));
            }}>{t.clone}</Button>
          <Button variant="outline" data-guide-action="new" icon={<IconPlusOutline16/>} disabled={busy} onClick={() => run('new')}>{t.new}</Button>
          <GuideActionButton variant="outline" data-guide-action="open" label={t.openShort} phase={actionPhase('open')} t={t} disabled={busy} onClick={() => run('open')}/></div></>}</header>
      <section className="guideBody" aria-busy={busy}>
      {warning && <p role="status">{warning === 'history-unreadable' ? t.historyUnreadable : t.unreadable}</p>}
      {selection ? <>{selection.existing ? <><div className="setting"><div><h2>{t.folder}</h2><p>{selection.directory}</p></div>
        <Button variant="outline" disabled={busy} onClick={() => run('choose')}>{t.back}</Button></div>
        <div className="setting"><div><h2>{t.file}</h2><p>{selection.filename}</p><p>{t.hint}</p></div></div></> : <>
        <div className="setting"><div><h2>{t.projectName}</h2><Input aria-label={t.projectName} disabled={busy} value={projectName} onChange={event => updateProjectName(event.target.value)} /></div></div>
        <ProjectPathField directory={selection.directory} projectName={projectName} busy={busy} t={t} platform={frameState.chrome.platform}
          onChange={(directory: string) => setSelection((current: any) => current ? {...current, directory} : current)} onBrowse={() => run('browse-location')}/>
        <section className="resourceEditor"><div className="resourceEditorHeading"><div><h2>{t.resources}</h2><p>{t.resourceHint}</p></div><Button variant="outline" icon={<IconPlusOutline16 />} disabled={busy} onClick={addResource}>{t.addResource}</Button></div>
          {draftResources.length > 0 && <div className="resourceGrid">{resourceCards}</div>}
        </section>
        </>}</>
        : <>{failures.length > 0 && <section className="failures"><h2><IconWarningOutline16/> {t.recovery}</h2>{failures.map(item =>
          <article className="failure" key={item.path}><h3>{item.title}</h3><p className="path">{item.path}</p>
            <p>{item.error === 'startup-interrupted' ? t.interrupted : t.pending}</p>
            <div className="actions"><GuideActionButton variant="outline" label={t.retryOpen} phase={actionPhase('retry', item.path)} t={t} disabled={busy} onClick={() => run('retry', {path: item.path})}/>
              <GuideActionButton label={t.locate} phase={actionPhase('relocate', item.path)} t={t} disabled={busy} onClick={() => run('relocate', {path: item.path})}/>
              <Button disabled={busy} onClick={() => run('forget', {path: item.path})}>{t.forget}</Button>
              {item.error && item.error !== 'startup-interrupted' && <Button aria-expanded={details === item.path} onClick={() => setDetails(details === item.path ? undefined : item.path)}>{t.details}</Button>}</div>
            {details === item.path && <pre className="errorDetail">{item.error}</pre>}
          </article>)}</section>}
        <section className="recent"><h1>{t.recent}</h1>{filtered.map(item => <RecentProjectRow key={item.path} item={item} busy={busy} opening={actionPhase('recent', item.path) === 'opening'} t={t}
          onOpen={() => run('recent', item.path)} onRemove={() => run('remove-recent', item.path)}/>)}
          {!filtered.length && <div className="empty"><IconFolderOpenOutline16 size={32}/><h2>{recent.length ? t.noMatches : t.empty}</h2><p>{recent.length ? query : t.body}</p></div>}</section></>}
      {error && <p className="error" role="alert">{error}</p>}
      </section>
      <footer>{selection ? <><Button disabled={busy} onClick={reset}>{t.cancel}</Button>
        <p className="guideProgress" role="status" title={progressText}>{progressText}</p>
        <GuideActionButton variant="primary" label={selection.existing ? t.existing : t.create} phase={actionPhase('confirm')}
          allowCreate={!selection.existing} t={t} disabled={busy || (!selection.existing && (!projectName.trim() || !selection.directory.trim() || !resourcesReady))}
          onClick={() => run('confirm', {name: projectName, location: selection.directory, templateId, resources: draftResources})}/></>
        : <><p className="guideWelcomeHint" role="status">{progressText || t.footer}</p>
          {updates && <Button variant="outline" data-check-updates disabled={updates.busy} title={updates.label}
            onClick={() => {void api.invoke('check-for-updates').catch((e: Error) => setError(e.message))}}>{updates.phase === 'downloading'
              ? (updates.progress?.percent === undefined ? t.downloading : `${t.downloading} ${updates.progress.percent}%`)
              : updates.busy ? t.checkingUpdates : t.checkUpdates}</Button>}</>}</footer>
    </div>
  </GuideFrame>;
}
createRoot(document.getElementById('root')!).render(<Guide/>);
