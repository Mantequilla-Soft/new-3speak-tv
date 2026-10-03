import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Transcript from './Transcript';
import { listSubtitleLanguages } from '../../hooks/useSubtitles';
import './WatchTabs.scss';

/**
 * The top of the watch page's right column: reactions and the transcript,
 * one at a time, above the recommendations.
 *
 * The transcript used to sit under the comments, where nobody scrolled to it.
 * It belongs beside the video, next to the other "more about this video" panel,
 * and sharing the column with reactions costs neither of them any room.
 *
 * DESKTOP ONLY for the transcript. On a phone the right column stacks under
 * everything else and a wall of subtitle lines between the video and the
 * recommendations is in the way rather than useful — so on mobile this renders
 * the reaction panel exactly as it did before, with no tab bar at all. Same
 * when a video has no subtitles: one thing to show means no tabs to pick from.
 */
export default function WatchTabs({ reactionPanel, author, permlink, currentTime = 0, onSeek }) {
  const { t } = useTranslation();
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const on = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // One cheap list call decides whether there's a transcript to offer; the
  // panel itself only mounts once its tab is chosen.
  const [hasSubtitles, setHasSubtitles] = useState(false);
  useEffect(() => {
    if (!isDesktop) { setHasSubtitles(false); return undefined; }
    let alive = true;
    setHasSubtitles(false);
    listSubtitleLanguages(author, permlink)
      .then((list) => { if (alive) setHasSubtitles(list.length > 0); })
      .catch(() => {});
    return () => { alive = false; };
  }, [author, permlink, isDesktop]);

  const tabs = useMemo(() => {
    const out = [];
    if (reactionPanel) out.push('reactions');
    if (isDesktop && hasSubtitles) out.push('transcript');
    return out;
  }, [reactionPanel, isDesktop, hasSubtitles]);

  const [active, setActive] = useState(null);
  // Keep the selection valid as tabs appear and disappear (resizing across the
  // breakpoint, subtitles arriving late, reactions being closed).
  useEffect(() => {
    setActive((cur) => (cur && tabs.includes(cur) ? cur : tabs[0] || null));
  }, [tabs]);

  if (!tabs.length) return null;
  // Nothing to choose between: render exactly what was there before.
  if (tabs.length === 1 && tabs[0] === 'reactions') return reactionPanel;

  return (
    <div className="watch-tabs">
      <div className="watch-tabs-bar" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={active === tab}
            className={`watch-tab${active === tab ? ' active' : ''}`}
            onClick={() => setActive(tab)}
          >
            {tab === 'reactions' ? t('comments.tabs.reactions') : t('comments.tabs.transcript')}
          </button>
        ))}
      </div>

      <div className="watch-tabs-panel" role="tabpanel">
        {active === 'reactions' && reactionPanel}
        {active === 'transcript' && (
          <Transcript
            author={author}
            permlink={permlink}
            currentTime={currentTime}
            onSeek={onSeek}
            embedded
          />
        )}
      </div>
    </div>
  );
}
