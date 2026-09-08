import PropTypes from 'prop-types';
import { MdSkipNext } from 'react-icons/md';
import './AdSkip.scss';

/**
 * The Skip control on a video spot.
 *
 * Shown for the WHOLE spot, not only once skipping is allowed. A button that appears
 * partway through is a button nobody is looking for and half of them miss; one that is
 * there from the start, counting down, tells the viewer what the deal is: this lasts a
 * few seconds and then you may go. That is a shorter-feeling wait than the same wait
 * with nothing on screen, for the same reason the resume countdown exists.
 *
 * Two states, one element, so it never moves under the cursor:
 *   waiting  — "Skip in 3", inert, and NOT a button, because a control that looks
 *              pressable and does nothing is worse than one that plainly is not yet.
 *   ready    — "Skip ad", pressable.
 *
 * Bottom-right, above the control bar, which is where every player puts this and
 * therefore where people already look for it. Opposite the disclosure, which sits top
 * left, so the two never collide.
 */
export default function AdSkip({ secondsUntil, onSkip }) {
  const ready = secondsUntil == null && typeof onSkip === 'function';

  if (!ready) {
    return (
      <div className="ad-skip ad-skip-waiting" role="status" aria-live="off">
        Skip in <strong>{Math.max(1, Math.ceil(secondsUntil ?? 0))}</strong>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="ad-skip ad-skip-ready"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSkip(); }}
    >
      Skip ad
      <MdSkipNext aria-hidden="true" />
    </button>
  );
}

AdSkip.propTypes = {
  /** Seconds until skipping is allowed, or null once it is. */
  secondsUntil: PropTypes.number,
  /** Called when the viewer skips. Only ever invoked in the ready state. */
  onSkip: PropTypes.func,
};
