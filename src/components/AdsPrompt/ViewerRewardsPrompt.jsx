import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { MdTv } from 'react-icons/md';
import { toastIn } from '../../utils/toast';
import { useAppStore } from '../../lib/store';
import { adsEnabledFor, adsBetaUserFor } from '../../utils/config';
import { fetchAdAccess, fetchViewerAdPrefs, setViewerAdPrefs } from '../../lib/advertiseData';
import { usePromptsActive, setPromptActive } from '../../utils/welcomeGate';
import './AdsPrompt.scss';

// Every toast from this module is headed "Advertising"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Advertising');

/**
 * Asks a viewer, once, whether they want a share of ad revenue for what they watch.
 *
 * 🚨 THE SERVER DECIDES WHETHER TO ASK, NOT localStorage.
 * The answer is a consent record, so "have we asked?" has to be the same fact
 * everywhere: a localStorage flag would re-ask on every new device and, worse,
 * could show the prompt to somebody who already declined on their phone. The read
 * route returns `decided` precisely so this component never has to guess.
 *
 * Because the question is "may we store your username", declining is a real answer
 * that we record and then respect. There is no third showing.
 */
export default function ViewerRewardsPrompt() {
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

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authenticated || !user || !uiAvailable) return undefined;
    let alive = true;
    fetchAdAccess(user).then((a) => {
      if (!alive) return;
      setAccess({ account: user, allowed: a ? a.allowed : adsBetaUserFor(user) });
    });
    return () => { alive = false; };
  }, [authenticated, user, uiAvailable]);

  const allowed = !!user && access?.account === user && access.allowed === true;

  useEffect(() => {
    if (!allowed || onAdvertise || promptsActive) return undefined;
    let alive = true;
    fetchViewerAdPrefs(user)
      .then((r) => {
        // `decided` is the whole point: false means never asked. Someone who said
        // no is decided, and is never asked again.
        if (alive && r && r.decided === false) {
          setOpen(true);
          setPromptActive('viewer-rewards', true);
        }
      })
      .catch(() => { /* unreachable checker: ask another time, never guess */ });
    return () => { alive = false; };
  }, [allowed, onAdvertise, promptsActive, user]);

  function close() {
    setOpen(false);
    setPromptActive('viewer-rewards', false);
  }

  async function answer(rewardsEnabled) {
    if (saving) return;
    setSaving(true);
    try {
      await setViewerAdPrefs(user, { rewardsEnabled });
      toast.success(rewardsEnabled
        ? 'You will earn a share of ad revenue for what you watch'
        : 'No problem, you stay anonymous');
      close();
    } catch (err) {
      // Left open on failure: an unrecorded answer must not look like a recorded
      // one, or we would never ask again and never pay them either.
      toast.error(err.message || 'Could not save that. Try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="ads-prompt-overlay">
      <div className="ads-prompt" role="dialog" aria-modal="true" aria-labelledby="viewer-rewards-title">
        {/* The viewer half of /advertise, same icon and same promise. The three ad
            dialogs share this header shape and differ only by icon, so which side of
            the deal you are being asked about is legible before the copy is read. */}
        <header className="ads-prompt-head">
          <MdTv className="ads-prompt-head-icon" aria-hidden="true" />
          <div>
            <h3 className="ads-prompt-title" id="viewer-rewards-title">Get paid for watching</h3>
            <p className="ads-prompt-lede">
              You earn a share of what the ads make, for the videos you actually watch.
              Paid in <strong>HBD or HIVE</strong>, same as everyone else.
            </p>
          </div>
        </header>

        <p className="ads-prompt-text">
          Ads on 3Speak pay the creator, their community, and now you. Your share comes
          out of what the advertiser paid, in whatever they paid with, for videos you were
          going to watch anyway.
        </p>
        <p className="ads-prompt-note">
          3Speak already keeps your watch history so you can find things again. This lets
          us use it to work out what you are owed, and keeps a record of how much of each
          video you actually watched. Say no and nothing changes. You can switch it off
          any time in Settings, and that deletes what we kept for rewards.
        </p>
        <div className="ads-prompt-actions">
          <button type="button" className="ads-prompt-ghost" onClick={() => answer(false)} disabled={saving}>
            No thanks
          </button>
          <button type="button" className="ads-prompt-primary" onClick={() => answer(true)} disabled={saving}>
            {saving ? 'Saving\u2026' : 'Yes, pay me'}
          </button>
        </div>
      </div>
    </div>
  );
}
