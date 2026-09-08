import { useState } from 'react';
import { createPortal } from 'react-dom';
import { MdVideocam } from 'react-icons/md';
import { toastIn } from '../../utils/toast';
import { saveCreatorAdSettings } from '../../utils/adSettings';

// Every toast from this module is headed "Advertising"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Advertising');

/**
 * Two steps: what the deal is, then what you want.
 *
 * Split in two on purpose. The numbers in step two only mean something once you
 * know what pool they divide, and a dialog that opens straight onto a percentage
 * box gets answered by whoever guesses fastest rather than by whoever understood.
 */
// Two callbacks rather than one with a flag: the dismiss paths are wired straight
// to onClick handlers, which would hand a click event to a `saved` argument and
// make every dismissal look like a save.
export default function AdSettingsDialog({ user, split, initialAdsEnabled, onSaved, onDismiss }) {
  const [step, setStep] = useState(0);
  const [adsEnabled, setAdsEnabled] = useState(initialAdsEnabled !== false);
  // Seeded from the server's own default community share rather than a constant
  // kept here — see readCreatorAdChoice. (That default is 0 now, not the 25 this
  // comment used to name: sharing with a community is opt in.)
  const [community, setCommunity] = useState(split.communityPct);
  const [saving, setSaving] = useState(false);

  const pool = split.poolPct;
  const mine = pool - community;
  // Viewers are paid out of 3Speak's own cut, not the creator pool — `pool` is the
  // same number whether or not anyone watching is opted in. Both of these come from
  // the server for the same reason the pool does: a checker that changes the viewer
  // share must not need a frontend release to stop lying about it.
  //
  // A checker that predates the viewer share sends neither, and the fallback is the
  // old two-way split rather than a guess: showing an invented 5% here would be a
  // promise nothing in the payout run has made.
  const viewers = Number.isFinite(split.viewerPct) ? split.viewerPct : 0;
  const platform = Number.isFinite(split.platformPct) ? split.platformPct : 100 - pool;

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await saveCreatorAdSettings(user, {
        adsEnabled,
        communitySharePct: community,
      });
      if (res.chainSaved) {
        toast.success('Ad settings saved to your Hive account');
      } else {
        // The setting DID take effect — only the creator's own on-chain copy is
        // missing. Saying "saved" flatly would hide that; saying "failed" would be
        // a lie that has people set it twice.
        toast.warning('Saved on 3Speak. Could not write it to your Hive account, try again from Settings.');
      }
      onSaved();
    } catch (err) {
      toast.error((err && err.message) || 'Could not save your ad settings');
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    // No dismiss-on-overlay-click: this dialog asks for a decision that gets
    // written to the creator's own Hive account, and losing a half-made choice to
    // a stray click beside the card is a bad trade for the convenience. The way
    // out is the explicit "Not now" button.
    <div className="ads-prompt-overlay">
      <div className="ads-prompt">
        {/* The creator half of /advertise, same icon and same promise, so the page
            and this dialog are recognisably one feature. It stays put across both
            steps: the step titles below say where you are, the header says what the
            whole thing is, and losing that on step two is how "Your choice" ends up
            floating with nothing naming the subject. */}
        <header className="ads-prompt-head">
          <MdVideocam className="ads-prompt-head-icon" aria-hidden="true" />
          <div>
            <h3 className="ads-prompt-title">Ads on your videos</h3>
            <p className="ads-prompt-lede">
              Ads run on your videos and you earn a share of what they make, along with
              the community you posted in.
            </p>
          </div>
        </header>

        <span className="ads-prompt-step">Step {step + 1} of 2</span>

        {step === 0 ? (
          <>
            <p className="ads-prompt-text">
              3Speak can play a short sponsor spot in your videos. Here is the whole
              arrangement, with nothing behind it.
            </p>

            {/* The numbers moved out of the bar and into the key below it when the
                viewer share was added: at 5% of the width there is no room to print
                "5%" inside the segment, and a bar where only the wide slices are
                labelled invites you to read the unlabelled one as rounding. */}
            <div className="ads-prompt-bar" aria-hidden="true">
              <span className="ads-prompt-bar-creators" style={{ width: `${pool}%` }} />
              {viewers > 0 ? (
                <span className="ads-prompt-bar-viewers" style={{ width: `${viewers}%` }} />
              ) : null}
              <span className="ads-prompt-bar-platform" />
            </div>
            <ul className="ads-prompt-bar-key">
              <li className="is-creators"><span>Creator side</span><b>{pool}%</b></li>
              {viewers > 0 ? (
                <li className="is-viewers"><span>People watching</span><b>{viewers}%</b></li>
              ) : null}
              <li className="is-platform">
                <span>Keeping 3Speak running</span><b>{platform}%</b>
              </li>
            </ul>

            <ul className="ads-prompt-points">
              <li>
                <strong>{pool}% of what an ad earns goes to the creator side.</strong> The
                other {100 - pool}% pays the people watching and keeps 3Speak thriving:
                encoding, storage, bandwidth and the people who keep it up.
              </li>
              <li>
                <strong>That {pool}% is yours to divide.</strong> You can pass part of it to
                the community the video was posted into, so the community carrying your
                work earns from it too. Keep all {pool}% if you would rather.
              </li>
              {viewers > 0 ? (
                <li>
                  <strong>Viewers earn {viewers}% too, and not out of your share.</strong>{' '}
                  People who opt in are paid for the videos they actually watch, out of
                  3Speak&apos;s end of the split rather than yours. Your {pool}% is the
                  same either way.
                </li>
              ) : null}
              <li>
                <strong>You can say no.</strong> Turn ads off and your videos carry none at
                all. They are also withdrawn from what we offer advertisers, so nothing
                is sold that you opted out of.
              </li>
            </ul>

            <div className="ads-prompt-actions">
              <button type="button" className="ads-prompt-ghost" onClick={() => onDismiss()}>
                Not now
              </button>
              <button type="button" className="ads-prompt-primary" onClick={() => setStep(1)}>
                Next
              </button>
            </div>
          </>
        ) : (
          <>
            <h4 className="ads-prompt-title">Your choice</h4>
            <p className="ads-prompt-text">
              You can change either of these at any time in <strong>Settings</strong>.
            </p>

            <div className="ads-prompt-row">
              <div className="ads-prompt-row-text">
                <span className="ads-prompt-row-title">Allow ads on my videos</span>
                <span className="ads-prompt-row-desc">
                  On by default. Off means no ads on anything you post, and no share.
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={adsEnabled}
                aria-label="Allow ads on my videos"
                className={`ads-prompt-switch${adsEnabled ? ' is-on' : ''}`}
                onClick={() => setAdsEnabled((v) => !v)}
                disabled={saving}
              >
                <span className="ads-prompt-switch-knob" />
              </button>
            </div>

            {adsEnabled && (
              <div className="ads-prompt-share">
                <label className="ads-prompt-row-title" htmlFor="ads-prompt-community">
                  Share with the community
                </label>
                <span className="ads-prompt-row-desc">
                  How much of the {pool}% goes to the community you posted the video into.
                </span>
                <input
                  id="ads-prompt-community"
                  type="range"
                  min="0"
                  max={pool}
                  step="1"
                  value={community}
                  disabled={saving}
                  onChange={(e) => setCommunity(parseInt(e.target.value, 10))}
                />
                {/* The three-way breakdown, because "25%" on its own is the one
                    number in this dialog that reads differently depending on
                    whether you think it is a share of the pool or of everything. */}
                <div className="ads-prompt-breakdown">
                  <span><b>{mine}%</b> you</span>
                  <span><b>{community}%</b> community</span>
                  {viewers > 0 ? (
                    <span className="muted"><b>{viewers}%</b> viewers</span>
                  ) : null}
                  <span className="muted"><b>{platform}%</b> 3Speak</span>
                </div>
              </div>
            )}

            <div className="ads-prompt-actions">
              <button
                type="button"
                className="ads-prompt-ghost"
                onClick={() => setStep(0)}
                disabled={saving}
              >
                Back
              </button>
              <button
                type="button"
                className="ads-prompt-primary"
                onClick={save}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
            <p className="ads-prompt-note">
              Saving stores this on your own Hive account, so the choice is yours and
              travels with you.
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
