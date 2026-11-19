import { StreamBoostGoal, useStreamLive } from '@snapie/hangouts-react';
import { useBoostLabels } from './boostLabels';

/**
 * The host's boost goal as a slim bar, in the site language, for a surface
 * that places it itself (the phone stream view puts it in the info block, not
 * over the bottom of the video where <StreamVideo> would draw it). Like
 * <StreamVideo>'s own bar it shows only while the stream is live, and renders
 * nothing when the host set no goal. Must be inside <StandaloneWatch>.
 */
export default function StreamBoostGoalBar({ className }) {
  const live = useStreamLive();
  const labels = useBoostLabels();
  if (!live) return null;
  return <StreamBoostGoal variant="overlay" labels={labels} className={className} />;
}
