/**
 * "Made from this": the posts made from this one (lib/derived.js), as a row of
 * cards under it: audiograms of an episode, clips of a stream, Shorts and
 * remixes of a video, reactions to it, the narration of a written post.
 *
 * Renders nothing until there is at least one, so a post nobody built on
 * carries no empty frame. Asks the checker only once the row is near the
 * screen, since it sits below the fold on every page that has it.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import { derivedHref, fetchDerived } from '../../lib/derived';
import './MadeFromThis.scss';

export const KIND_ICON = {
  audiogram: 'graphic_eq',
  stream_clip: 'sensors',
  clip: 'content_cut',
  remix: 'movie_edit',
  reaction: 'videocam',
  narration: 'record_voice_over',
  recap: 'video_library',
  audio_version: 'headphones',
  quote: 'format_quote',
  teaser: 'history_toggle_off',
};

const MEDIA_ICON = { short: 'smart_display', video: 'smart_display', audio: 'headphones', post: 'article' };

const clock = (s) => {
  const n = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = String(n % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/** Waits until `ref` is within a screen of the viewport (at once without IntersectionObserver). */
function useNearScreen(ref) {
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (near || !ref.current) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); }
    }, { rootMargin: '600px 0px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [near, ref]);
  return near;
}

export default function MadeFromThis({ author, permlink, className = '' }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  const near = useNearScreen(ref);
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    if (!near || !author || !permlink) return undefined;
    const ctl = new AbortController();
    fetchDerived(author, permlink, { signal: ctl.signal })
      .then((d) => setData(d))
      .catch(() => {});
    return () => ctl.abort();
  }, [near, author, permlink]);

  const items = data?.items || [];
  if (!items.length) return <div ref={ref} className="made-from-this-probe" aria-hidden="true" />;

  return (
    <section ref={ref} className={`made-from-this ${className}`.trim()} aria-label={t('derived.regionLabel')}>
      <div className="mft-head">
        <h3 className="mft-title"><Icon name="account_tree" size={18} />{t('derived.title')}</h3>
        <p className="mft-sub">{t('derived.sub', { count: data.total || items.length })}</p>
      </div>
      <ul className="mft-row">
        {items.map((item) => {
          const kind = t(`derived.kinds.${item.kind}`);
          const title = item.title || t('derived.untitled');
          return (
            <li key={`${item.author}/${item.permlink}`} className={`mft-card is-${item.media}`}>
              <Link to={derivedHref(item)} className="mft-link" aria-label={t('derived.cardLabel', { kind, title, author: item.author })}>
                <span className="mft-thumb">
                  {item.thumbnail
                    ? <img src={item.thumbnail} alt="" loading="lazy" decoding="async" />
                    : <Icon name={MEDIA_ICON[item.media] || 'article'} size={28} />}
                  <span className="mft-kind"><Icon name={KIND_ICON[item.kind] || 'account_tree'} size={14} />{kind}</span>
                  {item.duration > 0 && <span className="mft-len">{clock(item.duration)}</span>}
                </span>
                <span className="mft-name">{title}</span>
                <span className="mft-meta">
                  @{item.author}
                  {Number.isFinite(item.start) && <> · {t('derived.from', { time: clock(item.start) })}</>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
