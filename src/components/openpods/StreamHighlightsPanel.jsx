import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../lib/store';
import { toastIn } from '../../utils/toast';
import { usePostClipAsShort } from '../../hooks/usePostClipAsShort';
import { shortRangeParam } from '../../lib/clipIdeas';
import {
  fetchStreamHighlights, deleteClip, clipFileUrl, clipShareFor, momentRanges, clipClock, downloadClip, shortUrlFor, clipSummary, isReadyClip,
} from '../../lib/streamClips';
import { Button, IconButton, Icon, StatusPill } from '../v2/ui';
import './StreamClips.scss';

const toast = toastIn('Live');
const REASON_ICON = { chat: 'chat', boosts: 'bolt', big_boost: 'bolt' };

/**
 * After a stream (H13): the clips of its best moments, ready to post as Shorts.
 *
 * The host sees every clip (automatic ones cut at chat and boost spikes while
 * the Pro DVR ran, their own, and their viewers': posting one gives its clipper
 * a share) and the moments without a clip, which open the Shorts editor on the
 * replay. A viewer sees only their own clips. Clips stay two days.
 */
export default function StreamHighlightsPanel({ api, room, token, compact = false }) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const { post, busy } = usePostClipAsShort();
  const [state, setState] = useState({ loading: true, data: null, error: false });
  const [posting, setPosting] = useState(null);

  const load = useCallback(() => {
    if (!api || !room || !token) { setState({ loading: false, data: null, error: false }); return undefined; }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fetchStreamHighlights(api, room, token)
      .then((data) => { if (alive) setState({ loading: false, data, error: false }); })
      .catch(() => { if (alive) setState({ loading: false, data: null, error: true }); });
    return () => { alive = false; };
  }, [api, room, token]);
  useEffect(() => load(), [load]);

  // Clips of a stream without DVR are cut from its recording after it ends:
  // look again every 15 s while some are still pending (for up to 20 minutes).
  const pendingCount = (state.data?.clips || []).filter((c) => c.status === 'pending').length;
  const [polls, setPolls] = useState(0);
  useEffect(() => {
    if (!pendingCount || polls >= 80) return undefined;
    const timer = setTimeout(() => {
      fetchStreamHighlights(api, room, token)
        .then((data) => { if (data) setState({ loading: false, data, error: false }); })
        .catch(() => { /* next round */ })
        .finally(() => setPolls((n) => n + 1));
    }, 15000);
    return () => clearTimeout(timer);
  }, [pendingCount, polls, api, room, token]);

  const data = state.data;
  const clips = data?.clips || [];
  const ranges = data?.isHost ? momentRanges(data.moments, clips) : [];
  if (!state.loading && !state.error && !clips.length && !ranges.length && compact) return null;

  const postClip = async (c) => {
    setPosting(c.id);
    try {
      await post({ url: await shortUrlFor(api, c, token), room, host: c.host || data?.host, clipper: c.clipper, offsetSec: c.offsetSec });
    } catch {
      toast.error(t('streamClips.postFailed'));
    } finally { setPosting(null); }
  };
  const remove = async (c) => {
    if (!window.confirm(t('streamClips.deleteConfirm'))) return;
    try {
      await deleteClip(api, c.id, token);
      setState((s) => ({ ...s, data: { ...s.data, clips: s.data.clips.filter((x) => x.id !== c.id) } }));
    } catch { toast.error(t('streamClips.deleteFailed')); }
  };
  const save = async (c) => {
    try { await downloadClip(clipFileUrl(api, c.path)); toast.success(t('live.clip.saved')); }
    catch { toast.error(t('live.clip.failed')); }
  };

  const label = (c) => {
    if (c.source === 'auto') return t('streamClips.source.auto');
    if (c.clipper && c.clipper === user) return t('streamClips.source.mine');
    if (c.clipper) return t('streamClips.source.by', { user: c.clipper });
    return t('streamClips.source.guest');
  };

  return (
    <section className={`stream-highlights${compact ? ' is-compact' : ''}`} aria-busy={state.loading || undefined}>
      <div className="stream-highlights__head">
        <h3 className="stream-highlights__title"><Icon name="auto_awesome" size={18} />{t('streamClips.title')}</h3>
        <p className="stream-highlights__sub">{data?.isHost ? t('streamClips.subHost') : t('streamClips.subViewer')}</p>
      </div>

      {state.loading && !data && <div className="stream-highlights__skeleton v2-skeleton" />}
      {state.error && <p className="stream-highlights__empty">{t('streamClips.error')}</p>}
      {!state.loading && !state.error && !token && <p className="stream-highlights__empty">{t('streamClips.loginToPost')}</p>}
      {!state.loading && !state.error && token && !clips.length && !ranges.length && (
        <p className="stream-highlights__empty">{t('streamClips.empty')}</p>
      )}

      {data?.isHost && clips.length > 0 && <ClipSummary clips={clips} t={t} />}

      {clips.length > 0 && (
        <ul className="stream-highlights__clips">
          {clips.map((c) => {
            const share = clipShareFor({ poster: user, host: c.host || data?.host, clipper: c.clipper });
            return (
              <li key={c.id} className={`stream-highlights__clip${isReadyClip(c) ? '' : ' is-waiting'}`}>
                {isReadyClip(c)
                  ? <video className="stream-highlights__video" src={clipFileUrl(api, c.path)} controls playsInline preload="metadata" />
                  : (
                    <div className="stream-highlights__placeholder">
                      <Icon name={c.status === 'pending' ? 'schedule' : 'content_cut'} size={24} />
                      <span>{c.status === 'pending' ? t('streamClips.status.pending') : t(`streamClips.reasonUnavailable.${c.reason || 'failed'}`)}</span>
                    </div>
                  )}
                <div className="stream-highlights__meta">
                  <StatusPill tone={c.source === 'auto' ? 'accent' : 'muted'} caps={false}>{label(c)}</StatusPill>
                  {Number.isFinite(c.offsetSec) && <span className="stream-highlights__at num">{t('streamClips.at', { time: clipClock(c.offsetSec) })}</span>}
                  {(c.reasons || []).map((r) => (
                    <span key={r} className="stream-highlights__reason"><Icon name={REASON_ICON[r] || 'star'} size={14} />{t(`streamClips.reasons.${r}`)}</span>
                  ))}
                </div>
                {share && <p className="stream-highlights__share">{share.role === 'clipper'
                  ? t('streamClips.shareClipper', { clipper: share.account, percent: share.percent })
                  : t('streamClips.shareHost', { host: share.account, percent: share.percent })}</p>}
                <div className="stream-highlights__actions">
                  {isReadyClip(c) && (
                    <>
                      <Button variant="primary" size={40} icon="movie" onClick={() => postClip(c)} loading={posting === c.id} disabled={busy}>
                        {t('streamClips.postShort')}
                      </Button>
                      <IconButton icon="download" label={t('streamClips.download')} onClick={() => save(c)} />
                    </>
                  )}
                  <IconButton icon="delete" label={t('streamClips.delete')} onClick={() => remove(c)} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {ranges.length > 0 && data?.host && (
        <div className="stream-highlights__moments">
          <h4 className="stream-highlights__moments-title">{t('streamClips.momentsTitle')}</h4>
          <p className="stream-highlights__sub">{t('streamClips.momentsSub')}</p>
          <ol className="stream-highlights__list">
            {ranges.map((r) => (
              <li key={r.moment.at} className="stream-highlights__moment">
                <b className="num">{clipClock(r.start)}</b>
                <span className="stream-highlights__reasons">
                  {r.reasons.map((k) => (
                    <span key={k} className="stream-highlights__reason"><Icon name={REASON_ICON[k] || 'star'} size={14} />{t(`streamClips.reasons.${k}`)}</span>
                  ))}
                </span>
                <Link
                  className="v2-btn v2-btn--secondary h32"
                  to={`/@${data.host}/${room}?t=${r.start}&short=${shortRangeParam(r.start, r.end)}`}
                >
                  <Icon name="content_cut" size={16} />
                  <span className="v2-btn__label">{t('streamClips.makeShort')}</span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

/** The host's end screen: how many clips, from whom, and whether they are still being cut. */
function ClipSummary({ clips, t }) {
  const sum = clipSummary(clips);
  if (!sum.total) return null;
  const parts = [
    ...sum.byUser.map((u) => t('streamClips.summary.byUser', { user: u.user, count: u.count })),
    ...(sum.auto ? [t('streamClips.summary.auto', { count: sum.auto })] : []),
    ...(sum.guests ? [t('streamClips.summary.guests', { count: sum.guests })] : []),
  ];
  return (
    <div className="stream-highlights__summary" role="status">
      <b>{t('streamClips.summary.title', { count: sum.total })}</b>
      <span className="stream-highlights__summary-who">{parts.join(' · ')}</span>
      <span className="stream-highlights__sub">{sum.pending ? t('streamClips.summary.pending') : t('streamClips.summary.ready')}</span>
    </div>
  );
}
