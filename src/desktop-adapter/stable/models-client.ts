// Composition adapted from the pinned ui-settings-models/src/client/index.ts.
// All page, store, schema and provider implementations are imported unchanged.
import {ModelsSection} from '../../../.upstream/harness-guide/packages/client/ui-settings-models/src/client/ModelsSection.tsx';
import {ModelsSettingsStore} from '../../../.upstream/harness-guide/packages/client/ui-settings-models/src/client/store.ts';
import {createModelsOperations} from '../../../.upstream/harness-guide/packages/client/ui-settings-models/src/client/operations.ts';
import {createSettingsSchemaOperations} from '../../../.upstream/harness-guide/packages/client/ui-settings-models/src/client/schema-operations.ts';
import {en, zh} from '../../../.upstream/harness-guide/packages/client/ui-settings-models/src/client/locales.ts';
export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'remote.llm', 'remote.settings', 'settingsScope', 'settingsSchema'];
export function apply(ctx: any) {
  ctx.effect(() => ctx.locale.register('settings.models', {en, zh}), 'project-desktop: official model copy');
  const schema = createSettingsSchemaOperations(ctx.settingsSchema);
  const operations = createModelsOperations(ctx);
  const controller = new ModelsSettingsStore(ctx, schema, ctx.settingsScope.describe());
  const t = ctx.locale.bind('settings.models');
  ctx.effect(() => {
    const refresh = () => {if (controller.store.getSnapshot().status !== 'idle') void controller.load()};
    const disposers = [ctx.remote.$on('settings/document-updated', refresh),
      ctx.remote.$on('credentials/reference-updated', refresh), ctx.remote.$on('llm/adapters-updated', refresh),
      ctx.on('connection/reset', refresh)];
    return () => disposers.forEach(dispose => dispose());
  }, 'project-desktop: official model invalidation');
  ctx.slots.inject('settings.section', () => ctx.slots.register({name: 'settings.section', id: 'models', order: 10,
    label: () => t('nav'), inject: () => ({controller, hooks: {snapshot: controller.store}, operations, schema, t}),
    children: {'settings.models.provider-card': {kind: 'keyed', scope: 'root'}, 'settings.models.footer': {kind: 'list', scope: 'root'}},
  }, ModelsSection));
}
