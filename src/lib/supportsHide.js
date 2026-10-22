/**
 * A creator hiding (or unhiding) a tip they received, so it stops showing on
 * their profile: Received list, supporter chips, totals, and the tipper's Given.
 *
 * The checker (3speakchecks/routes/supports.js, POST /supports/hide) only takes
 * it with a signature from the creator's posting authority. Signing follows the
 * comment pins (lib/commentPins.js): @threespeak signs under the grant most
 * creators already gave it (the only option at all for HiveSigner and Butter
 * Auth), and a wallet that can sign does it itself when that grant is missing.
 */
import {
  signMessageWithAioha,
  getCurrentProvider,
  isManteAuthLogin,
  establishWalletSession,
  KeyTypes,
  Providers,
} from '../hive-api/aioha';
import { CHECKER_URL } from '../utils/config';
import { t } from '../i18n';

const THREESPEAK_API = import.meta.env.VITE_THREESPEAK_API || '/api';

// Must match hideMessage() in 3speakchecks/routes/supports.js exactly.
const hideMessage = (author, trxId, action, timestamp) =>
  ['3speak-supports', action, author, trxId, String(timestamp)].join('|');

const SIGN_CAPABLE_PROVIDERS = new Set([Providers.Keychain, Providers.HiveAuth, Providers.PeakVault, Providers.Ledger]);
const canSignLocally = () => !isManteAuthLogin() && SIGN_CAPABLE_PROVIDERS.has(getCurrentProvider());

async function signViaThreespeak(account, trxId, hidden) {
  const provider = getCurrentProvider();
  const isWallet = !!provider && provider !== Providers.HiveSigner && !isManteAuthLogin();
  const doPost = async () => {
    const headers = { 'Content-Type': 'application/json' };
    if (provider === Providers.HiveSigner) {
      const token = localStorage.getItem('hivesignerToken');
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const r = await fetch(`${THREESPEAK_API}/supports/hide-signature`, {
      method: 'POST', headers, credentials: 'include',
      body: JSON.stringify({ trx_id: trxId, hidden, username: account }),
    });
    return { r, d: await r.json().catch(() => ({})) };
  };
  let { r, d } = await doPost();
  const forSomeoneElse = () => !!d?.username && String(d.username).toLowerCase() !== String(account).toLowerCase();
  // The body names `account`, and the API signs for it whenever this browser
  // holds ANY verified session for it, even next to a ButrAuth cookie for
  // another account. Only "no session for this account at all" is worth a wallet
  // login; doing one for anything else asked for a login on every click.
  if (isWallet && r.status === 401 && d?.reason === 'not_signed_in_as' && await establishWalletSession(account)) {
    ({ r, d } = await doPost());
  }
  if (!r.ok || !d.signature) throw new Error(d.error || t('profile.supports.hideFailed'));
  if (forSomeoneElse()) throw new Error(t('profile.supports.hideFailed'));
  return { signature: d.signature, timestamp: d.timestamp };
}

async function signLocally(account, trxId, hidden) {
  const timestamp = Date.now();
  const res = await signMessageWithAioha(
    hideMessage(account, trxId, hidden ? 'hide' : 'unhide', timestamp),
    KeyTypes.Posting,
    t('profile.supports.hideWalletPrompt'),
  );
  if (!res?.success || !res.result) throw new Error(t('profile.supports.hideFailed'));
  return { signature: res.result, timestamp };
}

/** Hide (or unhide) one tip `author` received. Resolves to the new state. */
export async function setSupportHidden({ author, trxId, hidden }) {
  let signed;
  try {
    signed = await signViaThreespeak(author, trxId, hidden);
  } catch (err) {
    if (!canSignLocally()) throw err;
    signed = await signLocally(author, trxId, hidden);
  }
  const r = await fetch(`${CHECKER_URL}/supports/hide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ author, trx_id: trxId, hidden, ...signed }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.success) throw new Error(d.error || t('profile.supports.hideFailed'));
  return d.hidden === true;
}
