import {useId, useState} from 'react';
import {Button, Input} from '@deepseek-ai/dsh-client-ui-primitives';
import {ProjectScrollableModal, ProjectSettingRow, resourceErrorText} from '../desktop-adapter/stable/guide-resources-client';
import {validResourceBranch, validResourceUrl} from '../shared/remote-resource.mjs';

export function RemoteRepositoryModal({item, t, rt, onSave, onClose, onUnlink}: any) {
  const id = useId();
  const [url, setUrl] = useState(item.url ?? '');
  const [branch, setBranch] = useState(item.branch ?? '');
  const [errors, setErrors] = useState<{url?: string; branch?: string; request?: string}>({});
  const [saving, setSaving] = useState(false);
  const close = () => {if (!saving) onClose()};
  return <ProjectScrollableModal open title={t.linkRemote} closeLabel={t.cancel} onClose={close}
    footer={<>{item.mode === 'remote' && <Button className="remoteUnlink" disabled={saving} onClick={() => {onUnlink(); onClose()}}>{t.unlinkRemote}</Button>}
      <Button variant="outline" disabled={saving} onClick={close}>{t.cancel}</Button>
      <Button variant="primary" type="submit" form={id} disabled={saving}>{saving ? t.saving : t.saveAndClone}</Button></>}>
    <form id={id} className="project-capability-form remoteRepositoryForm" noValidate onSubmit={async event => {
      event.preventDefault(); if (saving) return;
      const remote = {url: url.trim(), branch: branch.trim()};
      const next = {url: !remote.url ? t.remoteUrlRequired : !validResourceUrl(remote.url) ? t.remoteUrlInvalid : undefined,
        branch: !validResourceBranch(remote.branch) ? t.remoteBranchInvalid : undefined};
      setErrors(next);
      if (next.url || next.branch) {document.getElementById(`${id}-${next.url ? 'url' : 'branch'}`)?.focus(); return;}
      setSaving(true);
      try {await onSave(remote); onClose()}
      catch (error) {setErrors({request: resourceErrorText((error as Error).message, rt)}); setSaving(false)}
    }}>
      <fieldset disabled={saving}>
        <ProjectSettingRow title={t.remoteUrl} description={t.remoteUrlHint} htmlFor={`${id}-url`} layout="input">
          <div className="remoteRepositoryField"><Input id={`${id}-url`} aria-label={t.remoteUrl} autoFocus value={url} maxLength={4096}
            placeholder={t.remoteUrlPlaceholder} spellCheck={false} autoComplete="off" aria-invalid={Boolean(errors.url)}
            aria-describedby={errors.url ? `${id}-url-error` : `${id}-url-description`}
            onChange={event => {setUrl(event.target.value); setErrors(current => ({...current, url: undefined, request: undefined}))}}/>
            {errors.url && <p className="project-error" role="alert" id={`${id}-url-error`}>{errors.url}</p>}</div>
        </ProjectSettingRow>
        <ProjectSettingRow title={t.remoteBranch} description={t.remoteBranchHint} htmlFor={`${id}-branch`} layout="input">
          <div className="remoteRepositoryField"><Input id={`${id}-branch`} aria-label={t.remoteBranch} value={branch} maxLength={255}
            placeholder={t.defaultBranch} spellCheck={false} autoComplete="off" aria-invalid={Boolean(errors.branch)}
            aria-describedby={errors.branch ? `${id}-branch-error` : `${id}-branch-description`}
            onChange={event => {setBranch(event.target.value); setErrors(current => ({...current, branch: undefined, request: undefined}))}}/>
            {errors.branch && <p className="project-error" role="alert" id={`${id}-branch-error`}>{errors.branch}</p>}</div>
        </ProjectSettingRow>
      </fieldset>
      {errors.request && <p className="project-error" role="alert">{errors.request}</p>}
    </form>
  </ProjectScrollableModal>;
}
