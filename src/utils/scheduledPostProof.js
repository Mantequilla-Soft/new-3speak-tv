// The owner's proof for a write to the checker's scheduled posts (create, update,
// cancel; 3speakchecks routes/scheduledPosts.js).
//
// The checker's cron publishes a queued post AS its owner, so it wants each write
// signed under the owner's posting authority, over:
//   create: scheduled-post|create|<owner>|<permlink>|<scheduledOn as sent>|<ms>
//   update: scheduled-post|update|<owner>|<permlink>|<ms>
//   cancel: scheduled-post|cancel|<owner>|<permlink>|<ms>
// with a 5-minute window, so sign right before each POST.
//
// Who signs, by login:
//   • every login first asks our API (POST /api/scheduled-posts/signature), which
//     proves the session (Butter Auth cookie, wallet-login session, HiveSigner
//     token) and signs as @threespeak under the owner's grant. Scheduling needs
//     that grant anyway: without it the cron could not publish.
//   • a wallet with no session for the owner yet (Keychain, HiveAuth, PeakVault,
//     Ledger) signs in once (establishWalletSession) and asks again;
//   • and if our API still cannot sign, the wallet signs the message itself.
// 🚨 Keep scheduledPostMessage() in lockstep with the checker and with
// server/scheduled-post-proof.cjs.
import {
  establishWalletSession,
  getCurrentProvider,
  getCurrentUser,
  isManteAuthLogin,
  signMessageWithAioha,
  KeyTypes,
  Providers,
} from '../hive-api/aioha';
import { t } from '../i18n';

/**
 * 🚧 TEMPORARY, remove once the checker runs with SCHEDULED_POSTS_REQUIRE_SIGNATURE=true.
 * While that flag is off the checker still takes an unsigned write (and logs it),
 * so a proof we could not get must not stop anyone from scheduling: the write goes
 * out unsigned with a console warning, exactly as before this change. Once the flag
 * is on, set this to false (or delete it and the branch in proveScheduledPost): a
 * missing proof then fails the write with a clear message instead of a 401.
 */
export const SCHEDULED_POST_UNSIGNED_FALLBACK = true;

const THREESPEAK_API = import.meta.env.VITE_THREESPEAK_API || '/api';
const SIGN_CAPABLE_PROVIDERS = new Set([Providers.Keychain, Providers.HiveAuth, Providers.PeakVault, Providers.Ledger]);

export const scheduledPostMessage = ({ action, owner, permlink, scheduledOn, timestamp }) => (
  action === 'create'
    ? ['scheduled-post', 'create', owner, permlink, scheduledOn, String(timestamp)].join('|')
    : ['scheduled-post', action, owner, permlink, String(timestamp)].join('|')
);

/** Why there is no proof: 'not_signed_in_as' | 'no_grant' | 'unavailable'. */
export class ScheduledPostProofError extends Error {
  constructor(reason, owner) {
    super(reason === 'no_grant'
      ? t('studio.scheduled.proof.noGrant')
      : reason === 'not_signed_in_as'
        ? t('studio.scheduled.proof.notSignedIn', { owner })
        : t('studio.scheduled.proof.unavailable'));
    this.name = 'ScheduledPostProofError';
    this.reason = reason;
  }
}

const reasonOf = (status, data) => {
  if (status === 401) return 'not_signed_in_as';
  if (status === 403 && data?.reason === 'no_grant') return 'no_grant';
  return 'unavailable';
};

async function signViaThreespeak(fields) {
  const provider = getCurrentProvider();
  const isWallet = !isManteAuthLogin() && SIGN_CAPABLE_PROVIDERS.has(provider);
  const doPost = async () => {
    const headers = { 'Content-Type': 'application/json' };
    if (!isManteAuthLogin() && provider === Providers.HiveSigner) {
      const token = localStorage.getItem('hivesignerToken');
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const r = await fetch(`${THREESPEAK_API}/scheduled-posts/signature`, {
      method: 'POST', headers, credentials: 'include', body: JSON.stringify(fields),
    });
    return { r, d: await r.json().catch(() => ({})) };
  };
  let r; let d;
  try {
    ({ r, d } = await doPost());
    // A wallet login whose server session is missing or belongs to another
    // account: sign this one in (no session is logged out) and ask once more.
    if (isWallet && r.status === 401 && await establishWalletSession(fields.owner)) {
      ({ r, d } = await doPost());
    }
  } catch {
    throw new ScheduledPostProofError('unavailable', fields.owner);
  }
  if (!r.ok || !d?.signature || !d?.timestamp) throw new ScheduledPostProofError(reasonOf(r.status, d), fields.owner);
  // Never send a proof for somebody else (the server checks this too).
  if (d.username && String(d.username).toLowerCase() !== fields.owner) {
    throw new ScheduledPostProofError('not_signed_in_as', fields.owner);
  }
  return { signature: d.signature, timestamp: d.timestamp };
}

/** The wallet signs it with the owner's posting key: one prompt. */
async function signLocally(fields) {
  const timestamp = Date.now();
  const res = await signMessageWithAioha(
    scheduledPostMessage({ ...fields, timestamp }),
    KeyTypes.Posting,
    t('studio.scheduled.proof.walletPrompt'),
  );
  if (!res?.success || !res.result) throw new ScheduledPostProofError('unavailable', fields.owner);
  return { signature: res.result, timestamp };
}

// Only the owner's own wallet can sign for the owner: with another account loaded
// in the wallet, its signature would only be refused.
const canSignLocallyFor = (owner) => !isManteAuthLogin()
  && SIGN_CAPABLE_PROVIDERS.has(getCurrentProvider())
  && String(getCurrentUser() || '').toLowerCase() === owner;

/**
 * { signature, timestamp } for one write. Throws ScheduledPostProofError (with a
 * message to show) when neither our API nor the wallet can sign.
 * `scheduledOn` (create only) must be the exact string the create body sends.
 */
export async function scheduledPostProof({ action, owner, permlink, scheduledOn }) {
  const fields = { action, owner: String(owner || ''), permlink: String(permlink || '') };
  if (action === 'create') fields.scheduledOn = scheduledOn;
  try {
    return await signViaThreespeak(fields);
  } catch (err) {
    if (!canSignLocallyFor(fields.owner)) throw err;
    try {
      return await signLocally(fields);
    } catch {
      throw err; // the API's reason says more than "the wallet declined"
    }
  }
}

/**
 * What a caller spreads into the write's body: { signature, timestamp }, or {}
 * while SCHEDULED_POST_UNSIGNED_FALLBACK lets an unsigned write through.
 */
export async function proveScheduledPost(args) {
  try {
    return await scheduledPostProof(args);
  } catch (err) {
    if (!SCHEDULED_POST_UNSIGNED_FALLBACK) throw err;
    console.warn(
      `[scheduledPosts] no owner signature for the ${args.action} of @${args.owner}/${args.permlink} (${err?.reason || err?.message}); `
      + 'sending it unsigned while the checker still accepts that (SCHEDULED_POSTS_REQUIRE_SIGNATURE off)',
    );
    return {};
  }
}

/**
 * The message to show for a failed write: the checker's 401 (a missing or refused
 * signature, once it enforces them) as a sentence a person can act on.
 */
export function scheduledPostWriteError(err, fallback) {
  if (err instanceof ScheduledPostProofError) return err.message;
  if (err?.response?.status === 401) return t('studio.scheduled.proof.refused');
  return err?.response?.data?.error || err?.message || fallback;
}
