import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toastIn } from '../../utils/toast';
import { useAppStore } from '../../lib/store';
import { TAG_CATEGORIES } from '../../utils/tagsV2';
import { fixVideoThumbnail, fallbackImg } from '../../utils/fixThumbnails';
import { fetchVideoDetails } from '../../lib/videoData';
import {
  CHANNELS, getChannel, channelNumber, channelTitle, stepChannel, findNextOnChannel,
  markSeen, saveLastChannel, surfUrl, videoAuthor,
} from '../../utils/surf';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, DockTile, Eyebrow, Icon } from '../v2/ui';
import { cx } from '../v2/helpers';
import './SurfBar.scss';

const toast = toastIn('Channel Surfing');

/**
 * The remote control under the video while channel surfing. Watch renders it only
 * when the URL carries `surf=<channel>`, so every other way onto the watch page
 * looks exactly as it did.
 *
 * `flipRef` hands Watch the flip function, so a video that plays to the end moves
 * on to the next one on the same channel, like TV does.
 *
 * `overlayTarget` is the player wrapper while it is fullscreen (null otherwise):
 * the bar under the video is not part of the fullscreen element, so a small copy
 * of the remote is portalled into the player itself, fading with its controls.
 *
 * A flip is an in-place swap: /watch stays mounted and only the URL changes, so
 * the player is reused and fullscreen survives. What made it feel like a fresh
 * page load was the Hive metadata fetch, so the next video's details are warmed
 * into the query cache as soon as "up next" is known.
 */
function SurfBar({ channel: slug, author, permlink, flipRef, overlayTarget = null, overlayVisible = false }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const channel = getChannel(slug);
  const currentKey = author && permlink ? `${author}/${permlink}` : null;

  // Keyed on what is on screen, so a stale answer for the previous video is
  // never offered as "up next" for this one.
  // hideAi too: flipping the setting mid-surf re-picks what Zap will play.
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

  // What "Zap" will play, fetched ahead so the button can show it.
  useEffect(() => {
    let alive = true;
    findNextOnChannel(slug, currentKey)
      .then((video) => { if (alive) setPrefetched({ key: tuneKey, video }); })
      .catch(() => { /* the button still works; it fetches again on press */ });
    return () => { alive = false; };
  }, [slug, currentKey, tuneKey]);

  // Same key and fetcher as Watch's own details query, so a flip finds the title,
  // description and stats already cached instead of waiting on a Hive RPC.
  useEffect(() => {
    const a = videoAuthor(upNext);
    if (!a || !upNext?.permlink) return;
    queryClient.prefetchQuery({
      queryKey: ['video-details', a, upNext.permlink],
      queryFn: () => fetchVideoDetails(a, upNext.permlink),
      staleTime: 60 * 1000,
    }).catch(() => { /* Watch fetches it itself on arrival */ });
  }, [upNext, queryClient]);

  const tuneTo = useCallback(async (targetSlug, preloaded = null) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setTuning(true);
    try {
      const next = preloaded || await findNextOnChannel(targetSlug, currentKey);
      if (!next) {
        toast(t('feeds.surf.nothingOnAir', { channel: channelTitle(getChannel(targetSlug)) || targetSlug }));
        return;
      }
      navigate(surfUrl(next, targetSlug));
    } catch {
      toast.error(t('feeds.surf.tuneFailed'));
    } finally {
      busyRef.current = false;
      setTuning(false);
    }
  }, [currentKey, navigate, t]);

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

  const stopSurfing = () => navigate(`/@${author}/${permlink}`, { replace: true });

  // Surprise me from the guide: one of your interests, or any channel.
  const interests = useAppStore((st) => st.interests);
  const surprise = () => {
    const yours = Array.isArray(interests) ? interests.map(getChannel).filter((c) => c && !c.isCommunity) : [];
    const pool = yours.length ? yours : CHANNELS;
    changeChannel(pool[Math.floor(Math.random() * pool.length)].slug);
  };

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
      const target = e.target;
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || '')) return;
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

  const chNext = channelNumber(next);
  const chPrev = channelNumber(prev);

  return (
    <section className={cx('surf-bar', tuning && 'is-tuning')} aria-label={t('feeds.surf.remoteAria')}>
      {/* The remote (34a). Top: the channel display (opens the guide) and what
          Zap plays next. Under it the keys, equal tiles: CH -, CH +, Zap (the
          one accent fill), the guide and Stop. */}
      <div className="surf-bar__top">
        <button
          type="button"
          className="surf-bar__display"
          onClick={() => setGuideOpen(true)}
          title={t('feeds.surf.openGuide')}
          aria-haspopup="dialog"
        >
          {/* Keyed on the video, so the static burst replays on every flip. */}
          <span key={tuneKey} className="surf-bar__static" aria-hidden="true" />
          <span className="surf-bar__ch">{t('feeds.surf.ch', { number: channelNumber(channel) })}</span>
          <span className="surf-bar__text">
            <span className="surf-bar__name">
              {channelTitle(channel)}
            </span>
            <span className="surf-bar__live"><i aria-hidden="true" /> {tuning ? t('feeds.surf.tuningShort') : t('feeds.surf.onAir')}</span>
          </span>
        </button>

        <div className="surf-bar__next" aria-live="polite">
          <span className="surf-bar__flip-thumb" aria-hidden="true">
            {upNext ? (
              <img src={fixVideoThumbnail(upNext)} alt="" onError={(e) => { e.currentTarget.src = fallbackImg; }} />
            ) : <span className="surf-bar__static surf-bar__static--loop" />}
          </span>
          <span className="surf-bar__flip-text">
            <span className="surf-bar__flip-label">{t('feeds.surf.nextVideo')}</span>
            <span className="surf-bar__flip-next">{upNext?.title || t('feeds.surf.findingNext')}</span>
          </span>
        </div>
      </div>

      <div className="surf-bar__docks" role="group" aria-label={t('feeds.surf.changeChannel')}>
        <DockTile
          icon="skip_previous"
          fill
          label={`${t('feeds.surf.chLabel')} −`}
          className="surf-key"
          onClick={() => changeChannel(prev.slug)}
          disabled={tuning}
          aria-label={t('feeds.surf.prevChannel')}
          title={t('feeds.surf.channelHintKey', { number: chPrev, title: channelTitle(prev), key: '↓' })}
        />
        <DockTile
          icon="skip_next"
          fill
          label={`${t('feeds.surf.chLabel')} +`}
          className="surf-key"
          onClick={() => changeChannel(next.slug)}
          disabled={tuning}
          aria-label={t('feeds.surf.nextChannel')}
          title={t('feeds.surf.channelHintKey', { number: chNext, title: channelTitle(next), key: '↑' })}
        />
        {/* Zap: the one primary action here. */}
        <DockTile
          icon="bolt"
          fill
          label={tuning ? t('feeds.surf.tuningShort') : t('feeds.surf.zap')}
          className="surf-key surf-key--zap"
          onClick={flip}
          disabled={tuning}
          title={t('feeds.surf.nextVideoKey')}
        />
        <DockTile
          icon="list"
          fill
          label={t('feeds.surf.guideShort')}
          className="surf-key"
          onClick={() => setGuideOpen(true)}
          aria-label={t('feeds.surf.openGuide')}
          aria-haspopup="dialog"
        />
        {/* Last in the row on every screen size, so it never sits between the
            channel buttons and Zap. */}
        <DockTile
          icon="stop"
          fill
          label={t('feeds.surf.stop')}
          className="surf-key surf-bar__off"
          onClick={stopSurfing}
          aria-label={t('feeds.surf.stop')}
          title={t('feeds.surf.stopTitle')}
        />
      </div>

      {overlayTarget && createPortal(
        <div className={cx('surf-fs', overlayVisible && 'is-visible', tuning && 'is-tuning')} role="group" aria-label={t('feeds.surf.remoteAria')}>
          <span className="surf-fs__ch">{t('feeds.surf.ch', { number: channelNumber(channel) })}</span>
          <span className="surf-fs__name">{channelTitle(channel)}</span>
          <button type="button" onClick={() => changeChannel(prev.slug)} disabled={tuning} title={t('feeds.surf.channelHint', { number: chPrev, title: channelTitle(prev) })} aria-label={t('feeds.surf.prevChannel')}>
            <Icon name="skip_previous" size={20} fill />
          </button>
          <button type="button" onClick={() => changeChannel(next.slug)} disabled={tuning} title={t('feeds.surf.channelHint', { number: chNext, title: channelTitle(next) })} aria-label={t('feeds.surf.nextChannel')}>
            <Icon name="skip_next" size={20} fill />
          </button>
          <button type="button" className="surf-fs__flip" onClick={flip} disabled={tuning} title={t('feeds.surf.nextVideo')}>
            {tuning ? t('feeds.surf.tuning') : t('feeds.surf.zap')} <Icon name="bolt" size={18} fill />
          </button>
        </div>,
        overlayTarget,
      )}

      <Dialog
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title={t('feeds.surf.guide')}
        closeLabel={t('common.actions.close')}
        width={720}
        className="surf-guide"
        footer={(
          <div className="surf-guide__keys" aria-hidden="true">
            <span>↑ ↓ {t('feeds.surf.changeChannel')}</span>
            <span>→ {t('feeds.surf.nextVideo')}</span>
          </div>
        )}
      >
        <div className="surf-guide__top">
          <Button variant="primary" size={40} icon="casino" onClick={surprise}>{t('feeds.surf.surprise')}</Button>
        </div>
        {TAG_CATEGORIES.map((cat) => (
          <div className="surf-guide__group" key={cat.slug}>
            <Eyebrow>{t(cat.labelKey)}</Eyebrow>
            <div className="surf-guide__grid">
              {[cat.slug, ...cat.topics.map((topic) => topic.slug)].map(getChannel).map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  className={cx('surf-guide__ch', c.isCategory && 'surf-guide__ch--category', c.slug === slug && 'is-current')}
                  aria-current={c.slug === slug || undefined}
                  onClick={() => changeChannel(c.slug)}
                >
                  <span className="surf-guide__num">{channelNumber(c)}</span>
                  <span className="surf-guide__label">{channelTitle(c)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </Dialog>
    </section>
  );
}

export default SurfBar;
