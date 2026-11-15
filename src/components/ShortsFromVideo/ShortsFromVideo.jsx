import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import { useAppStore } from '../../lib/store';
import { fetchClipIdeas, shortRangeParam } from '../../lib/clipIdeas';
import './ShortsFromVideo.scss';

const REASON_ICON = { replay: 'replay', comments: 'forum', chat: 'chat', quote: 'format_quote' };

function mmss(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * "Shorts from this video": clip ranges for the creator's OWN long video, picked by
 * real viewers (lib/clipIdeas.js: replays, timestamped comments, chat, quotable
 * transcript lines), each with why it was picked, a preview and "Make a Short".
 *
 * Shown only to the video's owner (the checker answers nobody else either).
 *
 * On the watch page the player is right there: `onPreview(s)` plays the range and
 * `onMakeShort(s)` opens the editor on it (`previewing` is the range playing now).
 * Elsewhere (the profile's Stats tab) both are links to the watch page: `?t=` to
 * preview, `&short=S-E` to open the editor there.
 */
export default function ShortsFromVideo({ owner, permlink, onPreview = null, onMakeShort = null, previewing = null, canMake = true }) {
  const { t, i18n } = useTranslation();
  const user = useAppStore((s) => s.user);
  const isOwner = !!user && !!owner && user.toLowerCase() === String(owner).toLowerCase();
  const [state, setState] = useState({ loading: true, data: null, error: false });

  useEffect(() => {
    if (!isOwner || !permlink) return undefined;
    let cancelled = false;
    setState({ loading: true, data: null, error: false });
    fetchClipIdeas(user, permlink, { lang: i18n.language })
      .then((data) => { if (!cancelled) setState({ loading: false, data, error: false }); })
      .catch(() => { if (!cancelled) setState({ loading: false, data: null, error: true }); });
    return () => { cancelled = true; };
  }, [isOwner, user, permlink, i18n.language]);

  if (!isOwner || !permlink) return null;
  // Not theirs after all, or a Short: nothing to suggest, no card.
  if (!state.loading && !state.error && (!state.data || state.data.short)) return null;

  const watchPath = `/@${owner}/${permlink}`;
  const list = state.data?.suggestions || [];

  return (
    <section className="shorts-from-video" aria-busy={state.loading || undefined}>
      <div className="sfv-head">
        <h3 className="sfv-title"><Icon name="content_cut" size={18} />{t('clips.title')}</h3>
        <p className="sfv-sub">{t('clips.sub')}</p>
      </div>

      {state.loading && <div className="sfv-skeleton v2-skeleton" />}
      {state.error && <p className="sfv-empty">{t('clips.error')}</p>}
      {!state.loading && !state.error && list.length === 0 && <p className="sfv-empty">{t('clips.empty')}</p>}

      {list.length > 0 && (
        <ol className="sfv-list">
          {list.map((s) => {
            const quote = s.reasons.find((r) => r.kind === 'quote' && r.text);
            const playing = previewing != null && previewing === s.start;
            const range = t('clips.range', { start: mmss(s.start), end: mmss(s.end) });
            return (
              <li key={`${s.start}-${s.end}`} className={`sfv-item${playing ? ' is-playing' : ''}`}>
                <div className="sfv-when">
                  <b>{range}</b>
                  <span>{t('clips.seconds', { seconds: s.end - s.start })}</span>
                </div>
                <div className="sfv-reasons">
                  {s.reasons.map((r) => (
                    <span key={r.kind} className="sfv-reason">
                      <Icon name={REASON_ICON[r.kind] || 'star'} size={14} />
                      {r.kind === 'comments' ? t('clips.reasons.comments', { count: r.count || 1 }) : t(`clips.reasons.${r.kind}`)}
                    </span>
                  ))}
                </div>
                {quote && <q className="sfv-quote">{quote.text}</q>}
                <div className="sfv-actions">
                  {onPreview ? (
                    <button type="button" className="v2-btn v2-btn--secondary h32" onClick={() => onPreview(s)} aria-pressed={playing}>
                      <Icon name={playing ? 'stop' : 'play_arrow'} size={16} />
                      <span className="v2-btn__label">{playing ? t('clips.stop') : t('clips.preview')}</span>
                    </button>
                  ) : (
                    <Link className="v2-btn v2-btn--secondary h32" to={`${watchPath}?t=${s.start}`} aria-label={`${t('clips.preview')} ${range}`}>
                      <Icon name="play_arrow" size={16} />
                      <span className="v2-btn__label">{t('clips.preview')}</span>
                    </Link>
                  )}
                  {canMake && (onMakeShort ? (
                    <button type="button" className="v2-btn v2-btn--primary h32" onClick={() => onMakeShort(s)}>
                      <Icon name="content_cut" size={16} />
                      <span className="v2-btn__label">{t('clips.makeShort')}</span>
                    </button>
                  ) : (
                    <Link className="v2-btn v2-btn--primary h32" to={`${watchPath}?t=${s.start}&short=${shortRangeParam(s.start, s.end)}`} aria-label={`${t('clips.makeShort')} ${range}`}>
                      <Icon name="content_cut" size={16} />
                      <span className="v2-btn__label">{t('clips.makeShort')}</span>
                    </Link>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {list.length > 0 && <p className="sfv-foot">{t('clips.foot')}</p>}
    </section>
  );
}
