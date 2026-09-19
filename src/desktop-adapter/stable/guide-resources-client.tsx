import {ResourceAuthDialog} from '../../../.upstream/project/src/client/ResourceAuthDialog.tsx';
import {ResourceAuthController} from '../../../.upstream/project/src/client/resource-auth-controller.ts';
import {styles} from '../../../.upstream/project/src/client/styles.ts';
import {en, zh} from '../../../.upstream/project/src/locales.ts';
export {ProjectScrollableModal, ProjectSettingRow, ProjectSelect, ProjectSettingsCard} from '../../../.upstream/project/src/client/ProjectControls.tsx';
export {resourceErrorText} from '../../../.upstream/project/src/client/resource-ui.ts';
export const guideResourceCopy = {en, zh};
export function createGuideAuthController(invoke: (action: string, value?: unknown) => Promise<unknown>) {
  return new ResourceAuthController(async (input, init = {}) => {
    const path = String(input).replace('/api/project/resources/auth', '');
    init.signal?.throwIfAborted();
    try {
      const result = await invoke('resource-auth', {path, method: init.method ?? 'GET',
        ...(init.body ? {body: JSON.parse(String(init.body))} : {})});
      return Response.json(result);
    } catch (error) {return Response.json({error: (error as Error).message}, {status: 422});}
  });
}
export function GuideResourceAuth({controller, t}: {controller: ResourceAuthController; t: any}) {
  return <><style>{styles}</style><ResourceAuthDialog controller={controller} t={t}/></>;
}
