import { clockText } from '../../lib/sliderKeys';
import './ScrubOverlay.scss';

/**
 * What a drag on an audio timeline shows (hooks/useTimelineScrub.js): a round
 * thumb at the spot and the time above it, so the viewer sees where the release
 * will land before it does. Nothing while not dragging.
 */
export default function ScrubOverlay({ fraction, time }) {
  if (fraction == null) return null;
  const left = `${Math.min(100, Math.max(0, fraction * 100))}%`;
  return (
    <>
      <span className="tl-scrub-thumb" style={{ left }} aria-hidden="true" />
      <span className="tl-scrub-tip num" style={{ left }} aria-hidden="true">{clockText(time)}</span>
    </>
  );
}
