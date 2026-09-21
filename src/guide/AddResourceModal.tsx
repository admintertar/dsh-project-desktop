import {useEffect, useId, useRef, useState} from 'react';
import {Button, Input} from '@deepseek-ai/dsh-client-ui-primitives';
import {ProjectScrollableModal, ProjectSelect, ProjectSettingRow, ProjectSettingsCard, resourceErrorText} from '../desktop-adapter/stable/guide-resources-client';
import {validResourceBranch, validResourceUrl} from '../shared/remote-resource.mjs';
import {defaultResourceTarget, resourceTargetsOverlap, suggestedResourceName, validResourceName, validResourceTarget} from '../shared/resource-draft.mjs';

/** Pre-project composition of the ResourcesPanel add flow; the Shell owns the unsaved draft. */
export function AddResourceModal({resources, t, pickDirectory, onSave, onClose}: any) {
  const id = useId();
  const [source, setSource] = useState<'local' | 'git'>('local');
  const [name, setName] = useState(''), [url, setUrl] = useState(''), [path, setPath] = useState(''), [branch, setBranch] = useState('');
  const [type, setType] = useState<'local' | 'git'>('local');
  const [inspection, setInspection] = useState<any>();
  const [selecting, setSelecting] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const named = useRef(false), targeted = useRef(false), generation = useRef(0);
  useEffect(() => () => {generation.current++}, []);
  const close = () => {if (!saving) {generation.current++; onClose()}};
  const pick = async () => {
    const current = ++generation.current; setSelecting(true); setError('');
    try {
      const next = await pickDirectory();
      if (!next || current !== generation.current) return;
      setInspection(next);
      // The picked directory decides the type; the Host already reports whether it is a Git working tree.
      setType(next.git ? 'git' : 'local');
      if (!named.current) setName(next.name);
    } catch (e) {if (current === generation.current) setError((e as Error).message)}
    finally {if (current === generation.current) setSelecting(false)}
  };
  const duplicate = inspection && resources.some((item: any) => item.mode === 'link' && item.path === inspection.path);
  const submit = async () => {
    if (saving || selecting) return;
    const value = {name: name.trim(), url: url.trim(), path: path.trim().replaceAll('\\', '/'), branch: branch.trim()};
    let invalid = !validResourceName(value.name) ? 'resource-config-invalid' : '';
    if (!invalid && source === 'git') {
      if (!validResourceUrl(value.url)) invalid = 'resource-url-invalid';
      else if (!validResourceTarget(value.path)) invalid = 'resource-target-invalid';
      else if (resources.some((item: any) => item.mode !== 'link' && resourceTargetsOverlap(item.path, value.path))) invalid = 'target-exists';
      else if (!validResourceBranch(value.branch)) invalid = 'resource-branch-invalid';
    }
    if (!invalid && source === 'local') {
      if (!inspection) invalid = 'resource-unavailable';
      else if (duplicate) invalid = 'resource-duplicate';
      else if (type === 'git' && !inspection.git) invalid = 'resource-git-invalid';
    }
    if (invalid) {setError(invalid); return}
    setSaving(true); setError('');
    try {
      await onSave(source === 'git' ? {...value, mode: 'remote'}
        : {mode: 'link', name: value.name, path: inspection.path, type, url: type === 'git' ? inspection.git?.url : ''});
      onClose();
    } catch (e) {setError((e as Error).message); setSaving(false)}
  };
  return <ProjectScrollableModal open title={t('addResource')} closeLabel={t('close')} onClose={close}
    footer={<><Button variant="outline" disabled={saving} onClick={close}>{t('cancel')}</Button>
      <Button variant="primary" type="submit" form={id} disabled={saving || selecting || (source === 'local' && (!inspection || duplicate))}>
        {t(saving ? 'saving' : source === 'git' ? 'resourceClone' : 'save')}</Button></>}>
    <form id={id} className="project-capability-form addResourceForm" onSubmit={event => {event.preventDefault(); void submit()}}>
      <fieldset disabled={saving}>
        <ProjectSettingRow title={t('resourceSource')}><ProjectSelect label={t('resourceSource')} value={source} disabled={saving}
          options={[{value: 'local', label: t('resourceLocal')}, {value: 'git', label: t('resourceGit')}]}
          onChange={value => {generation.current++; setSelecting(false); setSource(value); setError('')}}/></ProjectSettingRow>
        {source === 'local' && <>
          <ProjectSettingRow title={t('resourceDirectory')} description={t('resourceReferenceBody')} layout="stacked">
            <div className="project-resource-directory-field">
              <div className="project-resource-directory"><code>{inspection?.path ?? t('resourceUnbound')}</code>
                <Button variant="outline" disabled={selecting} onClick={() => void pick()}>{t(selecting ? 'loading' : 'resourceChoose')}</Button></div>
              {duplicate && <div className="project-resource-notes">
                <p className="project-error" role="alert">{t('resourceErrorDuplicate')}</p>
              </div>}
            </div>
          </ProjectSettingRow>
          {inspection?.git && <ProjectSettingRow title={t('resourceKind')} description={t('resourceDetected')}>
            <ProjectSelect label={t('resourceKind')} value={type} disabled={saving}
              options={[{value: 'local', label: t('resourceLocal')}, {value: 'git', label: t('resourceGit')}]}
              onChange={value => {setType(value); setError('')}}/>
          </ProjectSettingRow>}
        </>}
        <ProjectSettingRow title={t('resourceName')} htmlFor={`${id}-name`} layout="input">
          <Input id={`${id}-name`} aria-label={t('resourceName')} required maxLength={160} value={name}
            onChange={event => {named.current = true; setName(event.target.value); setError('')}}/>
        </ProjectSettingRow>
        {source === 'git' && <>
          <ProjectSettingRow title={t('resourceUrl')} description={t('resourceUrlBody')} htmlFor={`${id}-url`} layout="input">
            <Input id={`${id}-url`} aria-label={t('resourceUrl')} required maxLength={4096} value={url} spellCheck={false} autoComplete="off"
              onChange={event => {
                const next = event.target.value, suggested = suggestedResourceName(next); setUrl(next); setError('');
                if (!named.current) setName(suggested);
                if (!targeted.current) setPath(suggested ? defaultResourceTarget(suggested) : '');
              }}/>
          </ProjectSettingRow>
          <ProjectSettingRow title={t('resourceTarget')} description={t('resourceTargetBody')} htmlFor={`${id}-path`} layout="input">
            <Input id={`${id}-path`} aria-label={t('resourceTarget')} required maxLength={8000} value={path} spellCheck={false}
              onChange={event => {targeted.current = true; setPath(event.target.value); setError('')}}/>
          </ProjectSettingRow>
          <ProjectSettingsCard title={t('resourceAdvanced')} description={t('resourceAdvancedBody')} disabled={saving}>
            <ProjectSettingRow title={t('resourceBranch')} description={t('resourceBranchBody')} htmlFor={`${id}-branch`} layout="input">
              <Input id={`${id}-branch`} aria-label={t('resourceBranch')} maxLength={255} value={branch}
                onChange={event => {setBranch(event.target.value); setError('')}}/>
            </ProjectSettingRow>
          </ProjectSettingsCard>
        </>}
      </fieldset>
      {error && <p className="project-error" role="alert">{resourceErrorText(error, t)}</p>}
    </form>
  </ProjectScrollableModal>;
}
