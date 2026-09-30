import {randomUUID} from 'node:crypto';

/** 官方 settings-controller 的 HTTP RPC；只用于 Shell 共享外观偏好。 */
export function officialHostSettings(request) {
  const invoke = async (method, args) => {
    const rpcId = randomUUID();
    const response = await request(`/api/settings/${method}`, {method: 'POST', signal: AbortSignal.timeout(10000),
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({type: 'client-request', rpcId, method: `settings/${method}`, payload: {args}})});
    if (!response.ok) throw new Error('Official settings request failed');
    const data = await response.json();
    if (data?.type !== 'server-response' || data.rpcId !== rpcId || data.result?.ok !== true) {
      throw new Error('Official settings rejected the update');
    }
    return data.result.value;
  };
  const theme = async () => {
    const document = await invoke('describe', {});
    const entry = document.namespaces?.find(value => value.ns === 'ui-theme');
    if (!entry || !['light', 'dark', 'system'].includes(entry.value?.preference)) throw new Error('Official theme settings are unavailable');
    return entry;
  };
  return {
    async getTheme() {return (await theme()).value.preference},
    async setTheme(preference) {
      if (!['light', 'dark', 'system'].includes(preference)) throw new Error('Invalid theme preference');
      const current = await theme();
      if (current.value.preference !== preference) {
        await invoke('update', {ns: 'ui-theme', patch: {preference}, expectedRevision: current.revision});
      }
    },
  };
}
