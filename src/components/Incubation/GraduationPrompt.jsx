import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { MdKey } from 'react-icons/md';
import { toastIn } from '../../utils/toast';
import { useAppStore } from '../../lib/store';
import { usePromptsActive, setPromptActive } from '../../utils/welcomeGate';
import {
  fetchGraduationPlan, fetchGraduationStatus, canCreateAccount
} from '../../lib/incubation';
// Reuses the ads prompt's dialog styles rather than duplicating them. That file
// is the app's one modal-dialog shape, and a second copy would drift from it.
import '../AdsPrompt/AdsPrompt.scss';

// Every toast from this module is headed "Your account"; the message becomes
// the line under it. See utils/toast.js.
const toast = toastIn('Your account');

const DISMISS_KEY = 'graduation_prompt_snoozed_until';
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

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
 * Snoozing is deliberately localStorage and not a server record, unlike the ads
 * consent prompt: this is an OFFER, not a consent decision, so re-asking on
 * another device is fine and nothing is lost by forgetting it.
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

    let snoozedUntil = 0;
    try { snoozedUntil = Number(localStorage.getItem(DISMISS_KEY)) || 0; } catch { /* ignore */ }
    if (Date.now() < snoozedUntil) return undefined;

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

  function close(snooze) {
    if (snooze) {
      try { localStorage.setItem(DISMISS_KEY, String(Date.now() + SNOOZE_MS)); } catch { /* ignore */ }
    }
    setOpen(false);
    setPromptActive('graduation', false);
  }

  function goCreate() {
    close(false);
    toast.success('Let’s set up your Hive account');
    // ButrAuth owns key generation and the account-creation job. Sending them
    // there rather than reimplementing it here is the whole point of the split:
    // the keys must be generated in the browser on butrauth's own origin.
    window.location.href = '/create-account';
  }

  if (!open) return null;

  const pendingPosts = plan?.estimate?.pendingRootPosts ?? 0;

  return (
    <div className="ads-prompt-overlay">
      <div className="ads-prompt" role="dialog" aria-modal="true" aria-labelledby="graduation-title">
        <header className="ads-prompt-head">
          <MdKey className="ads-prompt-head-icon" aria-hidden="true" />
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
            a couple of posts a day at first, and votes genuinely cannot come
            along. Finding that out later would feel like a bait and switch. */}
        <p className="ads-prompt-note">
          Your {pendingPosts > 0 ? `${pendingPosts} post${pendingPosts === 1 ? '' : 's'}` : 'posts'} and
          the people you follow can move across with you. Publishing them happens gradually
          over a few days, because a brand new account starts with a small posting
          allowance. Likes you gave while getting started stay here, since the posts they
          were for have already paid out.
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
