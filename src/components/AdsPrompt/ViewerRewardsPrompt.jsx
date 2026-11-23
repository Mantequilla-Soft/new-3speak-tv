import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { toastIn } from '../../utils/toast';
import { useAppStore } from '../../lib/store';
import { adsEnabledFor, adsBetaUserFor } from '../../utils/config';
import { fetchAdAccess, fetchViewerAdPrefs, setViewerAdPrefs, setListenerAdPrefs } from '../../lib/advertiseData';
import { resetViewerRewards } from '../../utils/viewerRewards';
import { usePromptsActive, setPromptActive } from '../../utils/welcomeGate';
import { isAdvertiserAccount } from '../../utils/advertiserAccount';
import { blockedNow } from '../InstallAppPrompt/installGate';
import { Dialog, Button } from '../v2/ui';
import './AdsPrompt.scss';

// Every toast from this module is headed "Advertising"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Advertising');

// "No thanks" is kept on this device, per account and per question ('both' or
// 'listen'), and needs no signature (issue #578): saying no changes nothing on the
// server, since an account that never answered is not paid and not identified. It
// used to sign "off" twice (watching, then listening) just to stop the question.
// Another device may ask once more; Settings switches it on any time.
const DECLINED_KEY = (account) => `3speak-rewards-prompt-no:${String(account).toLowerCase()}`;
const declinedHere = (account, ask) => {
  try { return localStorage.getItem(DECLINED_KEY(account)) === ask; } catch { return false; }
};
const rememberDeclined = (account, ask) => {
  try { localStorage.setItem(DECLINED_KEY(account), ask); } catch { /* asked again next visit */ }
};
// The X and Escape: not now, asked again on a later visit.
const closedThisVisit = new Set();
// Another dialog on screen: look again this much later.
const RETRY_MS = 4000;

/**
 * Asks a viewer, once, whether they want a share of ad revenue for what they watch.
 *
 * 🚨 A YES IS DECIDED BY THE SERVER, NOT localStorage. It is a consent record,
 * signed and stored on the server, and the read route returns `decided` so someone
 * who agreed on their phone is never asked again here. A no is the state the
 * account is already in, so it is only remembered on this device (DECLINED_KEY
 * above): someone who said no elsewhere, or answered before 2026-11-23 by signing
 * "off", is `decided` on the server and not asked either.
 *
 * Listening (listener rewards) is its own consent record. Someone never asked gets
 * one question covering watching and listening; someone who already agreed to
 * watching is asked once more, about listening only (owner, 2026-10-30). Listener
 * payouts start later, once the numbers are checked, and the copy says so.
 */
export default function ViewerRewardsPrompt() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const authenticated = useAppStore((s) => s.authenticated);

  // Same two-part gate the creator prompt uses: the build flag says the ad UI
  // exists here, the checker says whether THIS account may use it. Prompting on
  // the flag alone is how everyone once got pitched a feature the server refused.
  const uiAvailable = adsEnabledFor(user);
  const [access, setAccess] = useState(null);

  // Never on /advertise — someone reading the ad page does not need a dialog about
  // it on top. The question is not spent, just held until they are elsewhere.
  const { pathname } = useLocation();
  const onAdvertise = String(pathname || '').toLowerCase().startsWith('/advertise');

  // One prompt at a time across the app. Welcome and interests outrank this.
  const promptsActive = usePromptsActive('viewer-rewards');

  // 'both' = never asked; 'listen' = agreed to watching, not yet asked about listening.
  const [open, setOpen] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authenticated || !user || !uiAvailable) return undefined;
    let alive = true;
    // Not for advertisers: they came to book ads, not to be paid for watching them.
    // Not asked rather than answered for them, so the Settings toggle stays theirs.
    Promise.all([fetchAdAccess(user), isAdvertiserAccount(user)]).then(([a, advertiser]) => {
      if (!alive) return;
      setAccess({ account: user, allowed: !advertiser && (a ? a.allowed : adsBetaUserFor(user)) });
    });
    return () => { alive = false; };
  }, [authenticated, user, uiAvailable]);

  const allowed = !!user && access?.account === user && access.allowed === true;

  useEffect(() => {
    if (!allowed || onAdvertise || promptsActive || open || closedThisVisit.has(user)) return undefined;
    let alive = true;
    let retry = null;
    fetchViewerAdPrefs(user)
      .then((r) => {
        // `decided` false means never asked; someone who said yes is decided.
        if (!alive || !r) return;
        const ask = r.decided === false ? 'both'
          : r.rewardsEnabled === true && r.listenDecided === false ? 'listen'
            : null;
        if (!ask || declinedHere(user, ask)) return;
        // Never on top of another dialog (the changelog, a login, the tour).
        const tryOpen = () => {
          if (!alive) return;
          if (blockedNow()) { retry = setTimeout(tryOpen, RETRY_MS); return; }
          setOpen(ask);
          setPromptActive('viewer-rewards', true);
        };
        tryOpen();
      })
      .catch(() => { /* unreachable checker: ask another time, never guess */ });
    return () => { alive = false; clearTimeout(retry); };
  }, [allowed, onAdvertise, promptsActive, open, user]);

  function close() {
    setOpen(null);
    setPromptActive('viewer-rewards', false);
  }

  // The X and Escape, also while a wallet prompt is still waiting (a cancelled
  // Keychain unlock never answers, which left the dialog stuck on "Saving…").
  function closeForNow() {
    closedThisVisit.add(user);
    close();
  }

  function decline() {
    rememberDeclined(user, open);
    toast.success(t('ads.viewerPrompt.savedNo'));
    close();
  }

  async function accept() {
    if (saving) return;
    setSaving(true);
    const asked = open;
    try {
      if (asked === 'both') {
        await setViewerAdPrefs(user, { rewardsEnabled: true });
        // Watching is recorded: a failed listening signature below only asks that again.
        setOpen('listen');
      }
      await setListenerAdPrefs(user, { listenEnabled: true });
      resetViewerRewards();
      toast.success(asked === 'listen' ? t('ads.listenPrompt.savedYes') : t('ads.viewerPrompt.savedYes'));
      close();
    } catch (err) {
      // Left open on failure: an unrecorded yes must not look like a recorded one,
      // or we would never pay them.
      toast.error(err.message || t('ads.viewerPrompt.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const listen = open === 'listen';
  // The X and Escape close it for this visit; a click beside it does nothing, so a
  // stray tap does not lose the question.
  // Design 47d: the title, one muted paragraph, then No thanks | Yes side by side
  // (cyan for listening). The consent fine print stays under the paragraph.
  return (
    <Dialog
      open
      onClose={closeForNow}
      closeLabel={t('common.actions.close')}
      backdropClose={false}
      title={listen ? t('ads.listenPrompt.title') : t('ads.viewerPrompt.titleBoth')}
      width={460}
      className="ads-prompt-v2 ads-prompt-v2--answer"
      footer={(
        <>
          <Button variant="secondary" size={44} onClick={decline} disabled={saving}>
            {t('ads.viewerPrompt.noThanks')}
          </Button>
          <Button variant={listen ? 'cyan' : 'primary'} size={44} className="ads-prompt-v2__main" onClick={accept} disabled={saving} loading={saving}>
            {saving ? t('common.actions.saving') : listen ? t('ads.listenPrompt.yes') : t('ads.viewerPrompt.yes')}
          </Button>
        </>
      )}
    >
      {listen ? (
        <>
          <p className="ads-prompt-v2__lede">{t('ads.listenPrompt.text')}</p>
          <p className="v2-meta-sm">{t('ads.listenPrompt.note')}</p>
        </>
      ) : (
        <>
          <p className="ads-prompt-v2__lede">
            <Trans i18nKey="ads.viewerPrompt.lede" components={{ b: <span /> }} />
          </p>
          <p className="v2-meta-sm">{t('ads.viewerPrompt.note')}</p>
        </>
      )}
    </Dialog>
  );
}
