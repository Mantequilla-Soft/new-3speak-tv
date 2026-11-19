// 🤖 Automations: client for /api/automations (server/automations.cjs).
//
// Like the importer, the server only answers for a login it can PROVE (butrauth
// session, wallet session cookie, HiveSigner token): a workflow posts as the
// creator. Wallet logins whose session cookie has lapsed get a 401; re-mint it
// once and retry (lib/youtubeImport.js does the same).

import { getCurrentProvider, Providers } from '../hive-api/aioha';

const API = import.meta.env.VITE_THREESPEAK_API || '/api';

function headers(json) {
  const h = json ? { 'Content-Type': 'application/json' } : {};
  if (getCurrentProvider() === Providers.HiveSigner) {
    const tok = localStorage.getItem('hivesignerToken');
    if (tok) h.Authorization = `Bearer ${tok}`;
  }
  return h;
}

async function call(path, { method = 'GET', body } = {}) {
  const send = () => fetch(`${API}/automations${path}`, {
    method,
    headers: headers(body !== undefined),
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let res = await send();
  if (res.status === 401) {
    try {
      const { establishWalletSession } = await import('../hive-api/aioha');
      if (await establishWalletSession()) res = await send();
    } catch { /* keep the 401 */ }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = data?.errorCode || null;
    err.stepId = data?.stepId || null;
    err.property = data?.property || null;
    err.canSkip = data?.canSkip === true;
    throw err;
  }
  return data;
}

/** → { catalog, workflows, grant, intervalMin, maxWorkflows } */
export const getAutomations = () => call('');
export const createAutomation = (body) => call('', { method: 'POST', body });
export const updateAutomation = (id, body) => call(`/${encodeURIComponent(id)}`, { method: 'PUT', body });
export const deleteAutomation = (id) => call(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const getAutomationRuns = (id) => call(`/${encodeURIComponent(id)}/runs`);
/** A dry run of a definition (saved or not) on the newest matching post. */
export const testAutomation = (definition) => call('/test', { method: 'POST', body: { definition } });
/** Tester accounts without Pro: skip the Pro check for this account, or take that back. */
export const skipProCheck = () => call('/skip-pro', { method: 'POST', body: {} });
export const restoreProCheck = () => call('/skip-pro', { method: 'DELETE' });
