import {useEffect, useId, useRef, useState} from 'react';
import {Button, IconLoadingOutline16, Input} from '@deepseek-ai/dsh-client-ui-primitives';
import {ProjectScrollableModal, ProjectSettingRow} from '../desktop-adapter/stable/guide-resources-client';
import {repositoryFolderName, validRepositoryName, validResourceBranch, validResourceUrl} from '../shared/remote-resource.mjs';
import {projectPathPreview} from '../shared/project-path.mjs';

type ImportPhase = 'idle' | 'cloning' | 'installing';
type ImportErrors = {url?: string; branch?: string; name?: string; directory?: string};

/**
 * Import one existing agent-project repository. The clone runs in the Shell through the
 * plugin's own clone manager, so progress, cancellation and private-remote credentials
 * match the creation guide; a repository without a project entry is rolled back.
 */
export function CloneRepositoryModal({t, rt, clones, invoke, errorText, defaultDirectory, platform, onClose}: any) {
  const id = useId();
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [directory, setDirectory] = useState(defaultDirectory ?? '');
  const [name, setName] = useState('');
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [jobId, setJobId] = useState<string>();
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState<ImportErrors>({});
  const [picking, setPicking] = useState(false);
  const named = useRef(false), completing = useRef(false);
  const busy = phase !== 'idle';
  const clone = jobId ? clones.find((item: any) => item.id === jobId) : undefined;
  useEffect(() => {
    if (!jobId || !clone) return;
    if (clone.status === 'completed') {
      if (completing.current) return;
      completing.current = true;
      setPhase('installing');
      // The Shell opens the project itself, so this window closes on success.
      invoke('import-finish', {id: jobId}).catch((e: Error) => {
        completing.current = false; setJobId(undefined); setPhase('idle'); setError(errorText(e.message));
      });
      return;
    }
    if (['failed', 'cancelled', 'interrupted'].includes(clone.status)) {
      completing.current = false; setJobId(undefined); setPhase('idle');
      setError(clone.status === 'cancelled' ? rt('resourceCancelled') : errorText(clone.error ?? 'clone-failed'));
    }
  }, [clone?.status, clone?.error, jobId]);
  const close = () => {
    if (jobId) void invoke('import-cancel', {id: jobId}).catch(() => {});
    onClose();
  };
  const cancelClone = async () => {
    const pending = jobId;
    try {await invoke('import-cancel', {id: pending})}
    catch (e) {setError(errorText((e as Error).message))}
    completing.current = false; setJobId(undefined); setPhase('idle');
  };
  const pickDirectory = async () => {
    setPicking(true); setError('');
    // The Shell owns the last import directory, so the chooser reopens where the user last cloned.
    try {const next = await invoke('browse-import-directory'); if (next) setDirectory(next)}
    catch (e) {setError(errorText((e as Error).message))}
    finally {setPicking(false)}
  };
  const submit = async () => {
    if (busy) return;
    const value = {url: url.trim(), branch: branch.trim(), directory: directory.trim(), name: name.trim()};
    const next: ImportErrors = {
      url: !value.url ? t.remoteUrlRequired : !validResourceUrl(value.url) ? t.remoteUrlInvalid : undefined,
      branch: !validResourceBranch(value.branch) ? t.remoteBranchInvalid : undefined,
      name: !validRepositoryName(value.name) ? t.cloneNameInvalid : undefined,
      directory: !value.directory ? t.cloneDirectoryRequired : undefined,
    };
    setInvalid(next); setError('');
    if (next.url || next.branch || next.name || next.directory) return;
    setPhase('cloning');
    try {setJobId((await invoke('import-start', value)).id)}
    catch (e) {setPhase('idle'); setError(errorText((e as Error).message))}
  };
  const phaseLabel = clone?.phase === 'receiving' ? rt('resourceReceiving')
    : clone?.phase === 'resolving' ? rt('resourceResolving') : clone?.phase === 'checkout' ? rt('resourceCheckout') : t.clonePreparing;
  return <ProjectScrollableModal open title={t.cloneTitle} closeLabel={busy ? t.cloneCancel : t.cancel} onClose={close}
    footer={<><Button variant="outline" disabled={picking} onClick={() => {void (busy ? cancelClone() : Promise.resolve(close()))}}>{busy ? t.cloneCancel : t.cancel}</Button>
      <Button variant="primary" type="submit" form={id} disabled={busy || picking}>{t.cloneStart}</Button></>}>
    <form id={id} className="project-capability-form cloneRepositoryForm" noValidate onSubmit={event => {event.preventDefault(); void submit()}}>
      <fieldset disabled={busy}>
        <ProjectSettingRow title={t.remoteUrl} description={t.cloneUrlHint} htmlFor={`${id}-url`} layout="input">
          <div className="remoteRepositoryField"><Input id={`${id}-url`} aria-label={t.remoteUrl} autoFocus value={url} maxLength={4096}
            placeholder={t.remoteUrlPlaceholder} spellCheck={false} autoComplete="off" aria-invalid={Boolean(invalid.url)}
            aria-describedby={invalid.url ? `${id}-url-error` : undefined}
            onChange={event => {const next = event.target.value; setUrl(next); setError(''); setInvalid(current => ({...current, url: undefined}));
              if (!named.current) setName(repositoryFolderName(next));}}/>
            {invalid.url && <p className="project-error" role="alert" id={`${id}-url-error`}>{invalid.url}</p>}</div>
        </ProjectSettingRow>
        <ProjectSettingRow title={t.remoteBranch} description={t.remoteBranchHint} htmlFor={`${id}-branch`} layout="input">
          <div className="remoteRepositoryField"><Input id={`${id}-branch`} aria-label={t.remoteBranch} value={branch} maxLength={255}
            placeholder={t.defaultBranch} spellCheck={false} autoComplete="off" aria-invalid={Boolean(invalid.branch)}
            aria-describedby={invalid.branch ? `${id}-branch-error` : undefined}
            onChange={event => {setBranch(event.target.value); setError(''); setInvalid(current => ({...current, branch: undefined}))}}/>
            {invalid.branch && <p className="project-error" role="alert" id={`${id}-branch-error`}>{invalid.branch}</p>}</div>
        </ProjectSettingRow>
        <ProjectSettingRow title={t.cloneDirectory} description={t.cloneDirectoryHint} htmlFor={`${id}-directory`} layout="input">
          <div className="remoteRepositoryField"><div className="projectPathControl">
            <Input id={`${id}-directory`} aria-label={t.cloneDirectory} value={directory} spellCheck={false} aria-invalid={Boolean(invalid.directory)}
              aria-describedby={invalid.directory ? `${id}-directory-error` : undefined}
              onChange={event => {setDirectory(event.target.value); setError(''); setInvalid(current => ({...current, directory: undefined}))}}/>
            <Button variant="outline" type="button" disabled={busy || picking} onClick={() => void pickDirectory()}>{t.browse}</Button></div>
            {invalid.directory && <p className="project-error" role="alert" id={`${id}-directory-error`}>{invalid.directory}</p>}</div>
        </ProjectSettingRow>
        <ProjectSettingRow title={t.cloneName} description={t.cloneNameHint} htmlFor={`${id}-name`} layout="input">
          <div className="remoteRepositoryField"><Input id={`${id}-name`} aria-label={t.cloneName} value={name} maxLength={160} spellCheck={false}
            autoComplete="off" aria-invalid={Boolean(invalid.name)} aria-describedby={invalid.name ? `${id}-name-error` : undefined}
            onChange={event => {named.current = true; setName(event.target.value); setError(''); setInvalid(current => ({...current, name: undefined}))}}/>
            {invalid.name && <p className="project-error" role="alert" id={`${id}-name-error`}>{invalid.name}</p>}</div>
        </ProjectSettingRow>
        <p className="projectPathPreview">{projectPathPreview(directory, name, platform)}</p>
        {clone && !['failed', 'cancelled', 'interrupted'].includes(clone.status) && <p className="cloneProgress" role="status">
          <IconLoadingOutline16 className="guideLoadingIcon"/><span>{phase === 'installing' ? t.cloneInstalling
            : `${phaseLabel}${typeof clone.percent === 'number' ? ` ${clone.percent}%` : ''}`}</span></p>}
      </fieldset>
      {error && <p className="project-error" role="alert">{error}</p>}
    </form>
  </ProjectScrollableModal>;
}
