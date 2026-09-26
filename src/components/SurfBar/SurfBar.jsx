import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { MdSkipNext, MdKeyboardArrowUp, MdKeyboardArrowDown, MdClose } from 'react-icons/md';
import { toastIn } from '../../utils/toast';
import { useAppStore } from '../../lib/store';
import { TAG_CATEGORIES } from '../../utils/tagsV2';
import { fixVideoThumbnail, fallbackImg } from '../../utils/fixThumbnails';
import {
  getChannel, channelNumber, channelTitle, stepChannel, findNextOnChannel,
  markSeen, saveLastChannel, surfUrl,
} from '../../utils/surf';
import './SurfBar.scss';

const toast = toastIn('Channel Surf');

/**
 * The remote control under the video while channel surfing. Watch renders it only
 * when the URL carries `surf=<channel>`, so every other way onto the watch page
 * looks exactly as it did.
 *
 * `flipRef` hands Watch the flip function, so a video that plays to the end moves
 * on to the next one on the same channel, like TV does.
 */
function SurfBar({ channel: slug, author, permlink, flipRef }) {
  const navigate = useNavigate();
  const channel = getChannel(slug);
  const currentKey = author && permlink ? `${author}/${permlink}` : null;

  // Keyed on what is on screen, so a stale answer for the previous video is
  // never offered as "up next" for this one.
  // hideAi too: flipping the setting mid-surf re-picks what Flip will play.
  const hideAi = useAppStore((s) => s.hideAi);
  const tuneKey = `${slug}|${currentKey}|${hideAi ? 'noai' : 'ai'}`;
  const [prefetched, setPrefetched] = useState({ key: null, video: null });
  const upNext = prefetched.key === tuneKey ? prefetched.video : null;
  const [tuning, setTuning] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    markSeen(currentKey);
    saveLastChannel(slug);
  }, [currentKey, slug]);

  // What "Flip" will play, fetched ahead so the button can show it.
  useEffect(() => {
    let alive = true;
    findNextOnChannel(slug, currentKey)
      .then((video) => { if (alive) setPrefetched({ key: tuneKey, video }); })
      .catch(() => { /* the button still works; it fetches again on press */ });
    return () => { alive = false; };
  }, [slug, currentKey, tuneKey]);

  const tuneTo = useCallback(async (targetSlug, preloaded = null) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setTuning(true);
    try {
      const next = preloaded || await findNextOnChannel(targetSlug, currentKey);
      if (!next) {
        toast(`Nothing on air on ${channelTitle(getChannel(targetSlug)) || targetSlug} right now`);
        return;
      }
      navigate(surfUrl(next, targetSlug));
    } catch {
      toast.error('Could not tune in. Try again in a moment.');
    } finally {
      busyRef.current = false;
      setTuning(false);
    }
  }, [currentKey, navigate]);

  const flip = useCallback(() => tuneTo(slug, upNext), [tuneTo, slug, upNext]);

  useEffect(() => {
    if (!flipRef) return undefined;
    flipRef.current = flip;
    return () => { flipRef.current = null; };
  }, [flipRef, flip]);

  const changeChannel = (targetSlug) => {
    setGuideOpen(false);
    if (targetSlug !== slug) tuneTo(targetSlug);
  };

  const stopSurfing = () => navigate(`/watch?v=${author}/${permlink}`, { replace: true });

  useEffect(() => {
    if (!guideOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setGuideOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [guideOpen]);

  const prev = stepChannel(slug, -1);
  const next = stepChannel(slug, 1);

  // TV-style remote on the keyboard: → flip, ← back, ↑/↓ channel. Nothing else on
  // the watch page listens for arrows, so this takes no key away from the player.
  // Skipped while typing (comments, search), with a modifier held (browser/OS
  // shortcuts), and while the guide is open.
  const keysRef = useRef(null);
  keysRef.current = { flip, changeChannel, prevSlug: prev.slug, nextSlug: next.slug, guideOpen, tuning };
  useEffect(() => {
    const onKey = (e) => {
      const k = keysRef.current;
      if (!k || k.guideOpen || k.tuning || e.defaultPrevented) return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target;
      if (t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName || '')) return;
      if (e.key === 'ArrowRight') k.flip();
      else if (e.key === 'ArrowUp') k.changeChannel(k.nextSlug);
      else if (e.key === 'ArrowDown') k.changeChannel(k.prevSlug);
      // Back only within this tab's history, so ← never leaves the site.
      else if (e.key === 'ArrowLeft' && window.history.state?.idx > 0) navigate(-1);
      else return;
      e.preventDefault(); // ↑/↓ would otherwise scroll the page
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  if (!channel) return null;

  return (
    <section className={`surf-bar${tuning ? ' is-tuning' : ''}`} aria-label="Channel Surf remote">
      <div className="surf-bar__tuner">
        <button
          type="button"
          className="surf-bar__display"
          onClick={() => setGuideOpen(true)}
          title="Open the channel guide"
        >
          {/* Keyed on the video, so the static burst replays on every flip. */}
          <span key={tuneKey} className="surf-bar__static" aria-hidden="true" />
          <span className="surf-bar__ch">CH {channelNumber(channel)}</span>
          <span className="surf-bar__name">
            <span aria-hidden="true">{channel.emoji}</span> {channelTitle(channel)}
          </span>
          <span className="surf-bar__live"><i aria-hidden="true" /> {tuning ? 'Tuning' : 'On air'}</span>
        </button>

        <div className="surf-bar__rocker" role="group" aria-label="Change channel">
          <button type="button" onClick={() => changeChannel(next.slug)} disabled={tuning} title={`CH ${channelNumber(next)}: ${channelTitle(next)} (↑)`}>
            <MdKeyboardArrowUp aria-hidden="true" /><span className="sr-only">Next channel</span>
          </button>
          <span className="surf-bar__rocker-label">CH</span>
          <button type="button" onClick={() => changeChannel(prev.slug)} disabled={tuning} title={`CH ${channelNumber(prev)}: ${channelTitle(prev)} (↓)`}>
            <MdKeyboardArrowDown aria-hidden="true" /><span className="sr-only">Previous channel</span>
          </button>
        </div>

        <button type="button" className="surf-bar__off" onClick={stopSurfing} title="Stop surfing (keeps this video playing)">
          <MdClose aria-hidden="true" /><span className="sr-only">Stop surfing</span>
        </button>
      </div>

      <button type="button" className="surf-bar__flip" onClick={flip} disabled={tuning} title="Next video (→)">
        <span className="surf-bar__flip-thumb" aria-hidden="true">
          {upNext ? (
            <img src={fixVideoThumbnail(upNext)} alt="" onError={(e) => { e.currentTarget.src = fallbackImg; }} />
          ) : <span className="surf-bar__static surf-bar__static--loop" />}
        </span>
        <span className="surf-bar__flip-text">
          <span className="surf-bar__flip-label">{tuning ? 'Tuning…' : 'Flip'}</span>
          <span className="surf-bar__flip-next">{upNext?.title || 'Finding the next one…'}</span>
        </span>
        <MdSkipNext className="surf-bar__flip-icon" aria-hidden="true" />
      </button>

      {guideOpen && createPortal(
        <div className="surf-guide-overlay" onClick={() => setGuideOpen(false)}>
          <div className="surf-guide" role="dialog" aria-label="Channel guide" onClick={(e) => e.stopPropagation()}>
            <div className="surf-guide__head">
              <strong>Channel guide</strong>
              <button type="button" onClick={() => setGuideOpen(false)} aria-label="Close"><MdClose /></button>
            </div>
            {TAG_CATEGORIES.map((cat) => (
              <div className="surf-guide__group" key={cat.slug}>
                <div className="surf-guide__grid">
                  {[cat.slug, ...cat.topics.map((t) => t.slug)].map(getChannel).map((c) => (
                    <button
                      key={c.slug}
                      type="button"
                      className={`surf-guide__ch${c.isCategory ? ' surf-guide__ch--category' : ''}${c.slug === slug ? ' is-current' : ''}`}
                      onClick={() => changeChannel(c.slug)}
                    >
                      <span className="surf-guide__num">{channelNumber(c)}</span>
                      <span className="surf-guide__emoji" aria-hidden="true">{c.emoji}</span>
                      <span className="surf-guide__label">{channelTitle(c)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}

export default SurfBar;
