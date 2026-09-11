import { useEffect, useState } from 'react';
import { MdPersonOff } from 'react-icons/md';
import { useAppStore } from '../../lib/store';
import { usePromptsActive, setPromptActive } from '../../utils/welcomeGate';
import { handleStateOnHive } from '../../hive-api/api';
import { fetchGraduationStatus } from '../../lib/incubation';
import { openButrauthPopup } from '../../utils/butrauthPopup';
import { toastIn } from '../../utils/toast';
// Reuses the shared dialog shape rather than duplicating it, as the graduation
// prompt does. That file is the app's one modal-dialog shape.
import '../AdsPrompt/AdsPrompt.scss';

// Every toast from this module is headed "Your name"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Your name');

// "Later" means later, not never: the name is still gone, and burying the
// warning until some future date would let them reach graduation day and find
// out then. Module scope, so it survives SPA remounts but dies with the page --
// opening 3Speak again asks again.
let dismissedThisVisit = false;

/**
 * "The name you picked is no longer free."
 *
 * A warm-up handle is NOT a reservation on Hive. Nothing short of creating the
 * account holds a name, and creating it is precisely the cost being deferred --
 * so somebody else can register it while the user is still warming up. Butrauth
 * says so plainly on the picker; this is the other half, which is telling them
 * when it actually happens rather than at graduation, when it is too late to be
 * anything but a disappointment.
 *
 * Only ever acts on a definite "taken". A failed lookup is 'unknown' and does
 * nothing, or a Hive hiccup would tell every warm-up user their name was gone.
 */
export default function HandleTakenPrompt() {
  const user = useAppStore((s) => s.user);
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const otherPromptOpen = usePromptsActive('handle-taken');

  const [taken, setTaken] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!incubationHandle || user) {
      // Promoted mid-session (they graduated on another device and the session
      // sync caught up). Take the alarm back down rather than leaving it on
      // screen accusing them over their own account.
      setTaken(false);
      return undefined;
    }
    let alive = true;
    (async () => {
      const state = await handleStateOnHive(incubationHandle);
      if (!alive || state !== 'taken') return;

      // The name existing on Hive is EXPECTED once this person graduates: the
      // account is THEIRS. Hive cannot tell us which it is -- the chain has no
      // idea who was warming up -- so the server has to say, and it is asked
      // here rather than left to the session sync to fix afterwards. Racing
      // that produced exactly this alarm, on a user's own name, moments before
      // the sync promoted them.
      let status;
      try {
        status = await fetchGraduationStatus();
      } catch {
        return; // cannot tell whose it is: say nothing
      }
      // Anything but a clear "still incubating" stays quiet: 'graduated' is
      // their own account, and an unrecognised answer is not worth alarming on.
      if (!alive || status?.status !== 'incubating') return;
      setTaken(true);
    })();
    return () => { alive = false; };
  }, [incubationHandle, user]);

  // Hold the other prompts back while this is up: it is the only one that is
  // about something the user is losing.
  useEffect(() => {
    const open = taken && !dismissedThisVisit && !otherPromptOpen;
    setPromptActive('handle-taken', open);
    return () => setPromptActive('handle-taken', false);
  }, [taken, otherPromptOpen]);

  if (!taken || !incubationHandle || user || dismissedThisVisit || otherPromptOpen) return null;

  const goChange = async () => {
    setBusy(true);
    try {
      await openButrauthPopup({ changeHandle: true });
    } catch (err) {
      toast.error(err?.message || 'Could not open the name picker');
      setBusy(false);
    }
  };

  const later = () => {
    dismissedThisVisit = true;
    setPromptActive('handle-taken', false);
    setTaken(false);
  };

  return (
    <div className="ads-prompt-overlay">
      <div
        className="ads-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="handle-taken-title"
      >
        <header className="ads-prompt-head">
          <MdPersonOff className="ads-prompt-head-icon" aria-hidden="true" />
          <div>
            <h3 className="ads-prompt-title" id="handle-taken-title">
              The name @{incubationHandle} has been taken
            </h3>
            <p className="ads-prompt-lede">
              Somebody registered it on <strong>Hive</strong>, so it cannot become your
              account when you are ready. Picking a new one now takes a moment.
            </p>
          </div>
        </header>

        <p className="ads-prompt-text">
          Choosing a name here never reserved it. Hive has no way to hold a name short of
          creating the account, and that is the step you have not paid for yet, which is
          the whole point of starting without one.
        </p>

        {/* Said plainly, because the thing people fear here is losing what they
            made under the old name. */}
        <p className="ads-prompt-note">
          Nothing you have made is lost. Your videos, shorts, comments and follows stay
          with you and come across under whichever name you choose.
        </p>

        <div className="ads-prompt-actions">
          <button type="button" className="ads-prompt-ghost" onClick={later}>
            Later
          </button>
          <button type="button" className="ads-prompt-primary" onClick={goChange} disabled={busy}>
            {busy ? 'Opening…' : 'Pick a new name'}
          </button>
        </div>
      </div>
    </div>
  );
}
