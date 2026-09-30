import {randomUUID} from 'node:crypto';

const activeAttempt = state => state.attempt && ['initializing', 'waiting-browser', 'exchanging', 'committing'].includes(state.attempt.phase);

/** Ask the official controller for task impact; a failed read must remain unknown in the official dialog. */
export async function hasRunningAccountTasks(request) {
  const method = 'account/hasRunningAccountTasks', rpcId = randomUUID();
  const response = await request('/api/' + method, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({type: 'client-request', rpcId, method, payload: {args: {}}})});
  const result = await response.json();
  if (!response.ok || result.rpcId !== rpcId || result.result?.ok !== true || typeof result.result.value !== 'boolean') {
    throw new Error('Account task status is unavailable');
  }
  return result.result.value;
}

/**
 * App-wide account actions around the unchanged official HTTP controller.
 * Login/logout are serialized across windows; official validation always runs
 * first. Task impact includes every open Host, so the official sign-out dialog
 * warns about account-backed work in another project too.
 */
export class SharedAccountSessions {
  clients = new Map();
  tail = Promise.resolve();
  connect(id, backend) {
    if (this.clients.has(id)) throw new Error('Account Host is already connected');
    const entry = {backend, closed: false};
    this.clients.set(id, entry);
    const peers = () => [...this.clients.values()].filter(other => other !== entry && !other.closed);
    return {
      forward: (request, forward) => {
        const method = new URL(request.url).pathname;
        if (request.method !== 'POST' || !['/api/account/startSignIn', '/api/account/signOut', '/api/account/hasRunningAccountTasks'].includes(method)) {
          return forward(request);
        }
        const run = async () => {
          if (entry.closed || request.signal.aborted) return new Response(null, {status: 410});
          const copy = request.clone();
          const response = await forward(request);
          if (!response.ok) return response;
          let envelope, input;
          try {envelope = await response.clone().json(); input = await copy.json()} catch {return response}
          if (envelope.type !== 'server-response' || envelope.rpcId !== input.rpcId || envelope.result?.ok !== true) return response;
          try {
            if (method.endsWith('/hasRunningAccountTasks')) {
              const values = await Promise.all(peers().map(peer => peer.backend.hasRunningTasks()));
              envelope.result.value = envelope.result.value || values.some(Boolean);
              await response.body?.cancel();
              return Response.json(envelope);
            }
            // A successful new attempt supersedes pending attempts in other windows.
            // For logout, settle all pending commits before the final shared removal.
            for (const peer of peers()) {
              const state = await peer.backend.account.state();
              if (activeAttempt(state)) await peer.backend.account.cancel(state.attempt.id);
            }
            if (method.endsWith('/signOut')) {
              const client = input.payload.args.client; // already admitted by the official controller
              for (const peer of peers()) await peer.backend.account.signOut(client);
              // A committing peer may have stored its grant while being cancelled.
              // Finish through the official operation again so that grant is revoked too.
              await backend.account.signOut(client);
            }
            return response;
          } catch {
            await response.body?.cancel();
            // No upstream diagnostic, credential, or authorization URL leaves this boundary.
            return new Response('Shared account action could not complete', {status: 503});
          }
        };
        const task = this.tail.then(run);
        this.tail = task.catch(() => {});
        return task;
      },
      dispose: async () => {
        entry.closed = true;
        this.clients.delete(id);
        await this.tail;
      },
    };
  }
}
