import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { MdRocketLaunch } from 'react-icons/md';
import { toastIn } from '../../utils/toast';
import { useAppStore } from '../../lib/store';
import { usePromptsActive, setPromptActive } from '../../utils/welcomeGate';
import {
  fetchGraduationPlan, fetchGraduationStatus, canCreateAccount
} from '../../lib/incubation';
import { openButrauthPopup } from '../../utils/butrauthPopup';
// Reuses the ads prompt's dialog styles rather than duplicating them. That file
// is the app's one modal-dialog shape, and a second copy would drift from it.
import '../AdsPrompt/AdsPrompt.scss';
// Only the celebration: the dialog's own shape stays in AdsPrompt.scss, which is
// shared, and must not grow a second personality here.
import './GraduationPrompt.scss';

// Every toast from this module is headed "Your account"; the message becomes
// the line under it. See utils/toast.js.
const toast = toastIn('Your account');

// "Not yet" means not now, NOT not-ever. It used to write a seven-day snooze to
// localStorage, so one stray click buried the offer for a week -- on the one
// screen a user is most likely to dismiss reflexively and then go looking for.
//
// Module scope, not localStorage and not state: it survives the remounts of an
// SPA navigation, so the prompt does not spring back on every route change
// after being dismissed, and it dies with the page, so opening 3Speak again
// offers it again.
let dismissedThisVisit = false;

/** "1 video", "2 shorts" — and nothing at all for a zero. */
const count = (n, one, many = `${one}s`) => (n > 0 ? `${n} ${n === 1 ? one : many}` : null);

/** "a, b and c", skipping the empties. */
function sentenceList(parts) {
  const kept = parts.filter(Boolean);
  if (kept.length === 0) return '';
  if (kept.length === 1) return kept[0];
  return `${kept.slice(0, -1).join(', ')} and ${kept[kept.length - 1]}`;
}

/**
 * Offers an incubating user their own Hive account, once they have earned it.
 *
 * `canGraduate` is the whole gate, and it is not a UI decision: butrauth
 * refuses /account/create outright until the owner of THIS frontend has
 * activated the person in their sign-ups queue. So this prompt appears only for
 * someone a human has already looked at and cleared.
 *
 * Nothing is shown while they are still waiting. Someone in the queue has done
 * nothing wrong, and a prompt that dead-ends — or a refusal that reads as
 * rejection — is worse than silence.
 *
 * Dismissing is deliberately not recorded anywhere, unlike the ads consent
 * prompt: this is an OFFER, not a consent decision. Re-asking next visit is
 * the point, and nothing is lost by forgetting it.
 */
export default function GraduationPrompt() {
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const authenticated = useAppStore((s) => s.authenticated);

  const { pathname } = useLocation();
  // Not while they are already in a setup or upload flow: the first is where
  // this leads anyway, and the second is the worst moment to interrupt.
  const onBusyPage = /^\/(pick-handle|upload|studio|create-account)/i.test(String(pathname || ''));

  // One prompt at a time across the app. Welcome and interests outrank this.
  const promptsActive = usePromptsActive('graduation');

  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState(null);

  useEffect(() => {
    if (!authenticated || !incubationHandle || onBusyPage || promptsActive) return undefined;

    if (dismissedThisVisit) return undefined;

    let alive = true;
    Promise.all([fetchGraduationStatus(), fetchGraduationPlan()])
      .then(([status, p]) => {
        if (!alive) return;
        // Server-authoritative. The prompt cannot show for anyone butrauth
        // would refuse, because it is the same answer /account/create gives.
        if (canCreateAccount(status)) {
          setPlan(p);
          setOpen(true);
          setPromptActive('graduation', true);
        }
      })
      .catch(() => { /* unreachable service: offer another time, never guess */ });
    return () => { alive = false; };
  }, [authenticated, incubationHandle, onBusyPage, promptsActive]);

  function close(dismissed) {
    if (dismissed) dismissedThisVisit = true;
    setOpen(false);
    setPromptActive('graduation', false);
  }

  async function goCreate() {
    close(false);
    // ButrAuth owns key generation and the account-creation job. Sending them
    // there rather than reimplementing it here is the whole point of the split:
    // the keys must be generated in the browser on butrauth's own origin.
    //
    // In the POPUP, the same way signing in works, and with screen_hint=graduate
    // so butrauth opens on key generation with their handle already filled in
    // and re-checked against the chain. This used to be
    // `window.location.href = '/create-account'` — a RELATIVE url, so it
    // resolved against 3Speak, which has no such route: the button navigated
    // the user to a dead page on the wrong origin.
    try {
      await openButrauthPopup({ graduate: true });
      toast.success('Let’s set up your Hive account');
    } catch (err) {
      console.error('Graduation start error:', err);
      toast.error('Could not open account setup. Please try again.');
    }
  }

  if (!open) return null;

  // What actually comes with them, named the way they would name it.
  //
  // NOT `estimate.pendingRootPosts`, which this used to print as "your N
  // post(s)": a short is stored as a reply to the @peak.snaps container, so
  // somebody who had uploaded a video and two shorts was told they had one
  // post. Being wrong about that here, on the screen that asks them to commit,
  // is the worst place in the app to be wrong about it.
  const content = plan?.content || {};
  const moving = sentenceList([
    count(content.videos, 'video'),
    count(content.shorts, 'short'),
    count(content.comments, 'comment'),
    count(plan?.follow?.pending, 'follow'),
    count(plan?.vote?.pending, 'like'),
  ]);
  // Replies and likes aimed at another incubating user's post, which cannot go
  // up until that post does. Everything aimed at real Hive content goes across.
  const waiting = (plan?.waiting?.comment || 0) + (plan?.waiting?.vote || 0);

  return (
    <div className="ads-prompt-overlay">
      <div
        className="ads-prompt graduation-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="graduation-title"
      >
        <header className="ads-prompt-head">
          <MdRocketLaunch className="ads-prompt-head-icon" aria-hidden="true" />
          <div>
            <h3 className="ads-prompt-title" id="graduation-title">
              You can create your own account now
            </h3>
            <p className="ads-prompt-lede">
              You have been posting as <strong>@{incubationHandle}</strong>. Turn that into a
              real <strong>Hive account</strong> that belongs to you, for free.
            </p>
          </div>
        </header>

        <p className="ads-prompt-text">
          A Hive account is a key only you hold. Nobody can lock you out of it, your posts
          start earning, and the same login works across every Hive app, not just 3Speak.
        </p>

        {/* Said up front rather than discovered afterwards. Publishing the back
            catalogue is slow because a new account's resource credits only allow
            a couple of posts a day at first. Finding that out later would feel
            like a bait and switch. */}
        <p className="ads-prompt-note">
          {moving
            ? <>Your <strong>{moving}</strong> come across with you.</>
            : <>Everything you have made here comes across with you.</>}
          {' '}Publishing happens gradually over a few days, because a brand new account
          starts with a small posting allowance.
          {waiting === 1 && <>{' '}One of them waits for the post it answers to be published first.</>}
          {waiting > 1 && <>{' '}{waiting} of them wait for the posts they answer to be published first.</>}
        </p>

        <div className="ads-prompt-actions">
          <button type="button" className="ads-prompt-ghost" onClick={() => close(true)}>
            Not yet
          </button>
          <button type="button" className="ads-prompt-primary" onClick={goCreate}>
            Create my account
          </button>
        </div>
      </div>
    </div>
  );
}
