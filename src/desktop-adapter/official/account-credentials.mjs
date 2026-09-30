/** The only official credential records shared by the Shell, pinned to Harness 0.2. */
export const ACCOUNT_GRANT = 'deepseek-account-platform/default';
export const ACCOUNT_DEVICE = 'deepseek-account-platform/device';
export const isAccountRecord = key => key === ACCOUNT_GRANT || key === ACCOUNT_DEVICE;

/**
 * Reuse the complete official file provider. References and all other records
 * retain the project's environment layering, storage, locking and lifecycle.
 * An independent Cordis scope owns the second provider so its events cannot
 * accidentally announce private project credentials in another Host.
 */
export function accountCredentialProvider({Context, Service, LocalCredentialProvider}, sharedPath) {
  if (!sharedPath) throw new Error('The Shell account store is required');
  return class ProjectAccountCredentials extends LocalCredentialProvider {
    accountStore;
    async* [Service.init]() {
      yield* super[Service.init]();
      const scope = new Context();
      const fiber = scope.plugin(LocalCredentialProvider, {path: sharedPath});
      yield () => fiber.dispose();
      await fiber;
      this.accountStore = scope.credentials;
      const stop = scope.on('credentials/record-updated', key => {
        if (!isAccountRecord(key)) return;
        this.notifyRecordUpdated(key);
        // Official account state watches the credential seam. Its local
        // sign-out event also owns cancellation of account-backed agent tasks.
        if (key === ACCOUNT_GRANT) void this.publishAccountRemoval().catch(() => {
          this.ctx.logger.warn('Shared DeepSeek account removal could not settle');
        });
      });
      yield stop;
    }
    async publishAccountRemoval() {
      if (await this.accountStore.readRecord(ACCOUNT_GRANT)) return;
      const account = this.ctx.get('deepseekAccount');
      if (account) {
        const state = await account.getState();
        if (state.attempt) await account.cancelSignIn(state.attempt.id);
      }
      this.ctx.emit('deepseek-account/signed-out');
    }
    readRecord(key) {return isAccountRecord(key) ? this.accountStore.readRecord(key) : super.readRecord(key)}
    describeRecord(key) {return isAccountRecord(key) ? this.accountStore.describeRecord(key) : super.describeRecord(key)}
    modifyRecord(key, mutate) {return isAccountRecord(key) ? this.accountStore.modifyRecord(key, mutate) : super.modifyRecord(key, mutate)}
    deleteRecord(key) {return isAccountRecord(key) ? this.accountStore.deleteRecord(key) : super.deleteRecord(key)}
    async listRecords() {
      return [...(await super.listRecords()).filter(row => !isAccountRecord(row.key)),
        ...(await this.accountStore.listRecords()).filter(row => isAccountRecord(row.key))];
    }
  };
}
