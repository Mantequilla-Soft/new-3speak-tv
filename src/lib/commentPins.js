/**
 * A video's author pinning comments to the top of their own video's thread.
 *
 * The checker (3speakchecks/routes/commentPins.js) stores the pins on the video
 * row as `pinned_comments` and only with a signature from the author's posting
 * authority. Signing follows the caption edits (lib/captionEdit.js): @threespeak
 * signs under the grant most authors already gave it (the only option at all for
 * HiveSigner and Butter Auth), and a wallet that can sign does it itself when
 * that grant is missing.
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

// Must match pinMessage() in 3speakchecks/routes/commentPins.js exactly.
const pinMessage = (author, permlink, comment, action, timestamp) =>
  ['3speak-comments', action, author, permlink, comment, String(timestamp)].join('|');

const SIGN_CAPABLE_PROVIDERS = new Set([Providers.Keychain, Providers.HiveAuth, Providers.PeakVault, Providers.Ledger]);
const canSignLocally = () => !isManteAuthLogin() && SIGN_CAPABLE_PROVIDERS.has(getCurrentProvider());

async function signViaThreespeak(account, permlink, comment, pinned) {
  const provider = getCurrentProvider();
  const isWallet = !!provider && provider !== Providers.HiveSigner && !isManteAuthLogin();
  const doPost = async () => {
    const headers = { 'Content-Type': 'application/json' };
    if (provider === Providers.HiveSigner) {
      const token = localStorage.getItem('hivesignerToken');
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const r = await fetch(`${THREESPEAK_API}/comments/pin-signature`, {
      method: 'POST', headers, credentials: 'include',
      body: JSON.stringify({ permlink, comment, pinned, username: account }),
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
  if (!r.ok || !d.signature) throw new Error(d.error || t('comments.section.pinFailed'));
  if (forSomeoneElse()) throw new Error(t('comments.section.pinFailed'));
  return { signature: d.signature, timestamp: d.timestamp };
}

async function signLocally(account, permlink, comment, pinned) {
  const timestamp = Date.now();
  const res = await signMessageWithAioha(
    pinMessage(account, permlink, comment, pinned ? 'pin' : 'unpin', timestamp),
    KeyTypes.Posting,
    t('comments.section.pinWalletPrompt'),
  );
  if (!res?.success || !res.result) throw new Error(t('comments.section.pinFailed'));
  return { signature: res.result, timestamp };
}

/**
 * Pin (or unpin) one comment on the author's own video.
 * Resolves to the video's new `pinned_comments` list.
 */
export async function setCommentPinned({ author, permlink, comment, pinned }) {
  let signed;
  try {
    signed = await signViaThreespeak(author, permlink, comment, pinned);
  } catch (err) {
    if (!canSignLocally()) throw err;
    signed = await signLocally(author, permlink, comment, pinned);
  }
  const r = await fetch(`${CHECKER_URL}/comments/pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ author, permlink, comment, pinned, ...signed }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.success) throw new Error(d.error || t('comments.section.pinFailed'));
  return Array.isArray(d.pinned_comments) ? d.pinned_comments : [];
}
