import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useHangout } from '../context/HangoutContext';
import { useAppStore } from '../lib/store';
import { toastIn } from '../utils/toast';
import { getHangoutsEndpoints, defaultEndpoint } from '../utils/hangoutsEndpoints';
import { usePostClipAsShort } from '../hooks/usePostClipAsShort';
import {
  fetchMyClips, clipFileUrl, clipShareFor, clipClock, isReadyClip, shortUrlFor, readClipQueue, writeClipQueue,
} from '../lib/streamClips';
import SEOHead from '../components/SEOHead';
import { Button, EmptyState, Icon, StatusPill } from '../components/v2/ui';
import '../components/openpods/StreamClips.scss';

const toast = toastIn('Live');

/**
 * /clips, "Your stream clips" (H13): the clips you made of live streams and,
 * for a host, every clip of your own streams, from every hangouts server. Pick
 * any number and post them as Shorts: each goes through the normal Shorts
 * upload with its locked share, one after the other (the rest wait in a queue
 * in this browser, "Post the next one"). The bell's "clips are ready" leads here.
 */
export default function StreamClipsHome() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const { sessionToken } = useHangout();
  const { post, busy } = usePostClipAsShort();
  const [state, setState] = useState({ loading: true, clips: [], keepHours: 48, error: false });
  const [picked, setPicked] = useState(() => new Set());
  const [queue, setQueue] = useState(() => readClipQueue());

  const load = useCallback(async () => {
    if (!sessionToken) { setState({ loading: false, clips: [], keepHours: 48, error: false }); return; }
    const endpoints = getHangoutsEndpoints();
    const list = endpoints.length ? endpoints : [defaultEndpoint()];
    const answers = await Promise.all(list.map((ep) => fetchMyClips(ep.api, sessionToken).catch(() => undefined)));
    const ok = answers.filter(Boolean);
    const clips = ok.flatMap((a) => a.clips).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    setState({ loading: false, clips, keepHours: ok[0]?.keepHours || 48, error: answers.every((a) => a === undefined) });
  }, [sessionToken]);
  useEffect(() => { load(); }, [load]);

  const rooms = useMemo(() => {
    const m = new Map();
    for (const c of state.clips) {
      if (!m.has(c.room)) m.set(c.room, { room: c.room, host: c.host, clips: [] });
      m.get(c.room).clips.push(c);
    }
    return [...m.values()];
  }, [state.clips]);

  const postOne = async (c) => {
    try {
      await post({ url: await shortUrlFor(c.api, c, sessionToken), room: c.room, host: c.host, clipper: c.clipper, offsetSec: c.offsetSec });
    } catch {
      toast.error(t('streamClips.postFailed'));
    }
  };
  const postSelected = async () => {
    const chosen = state.clips.filter((c) => picked.has(c.id) && isReadyClip(c));
    if (!chosen.length) return;
    const rest = chosen.slice(1);
    writeClipQueue(rest);
    setQueue(rest);
    await postOne(chosen[0]);
  };
  const postNext = async () => {
    const [next, ...rest] = queue;
    if (!next) return;
    writeClipQueue(rest);
    setQueue(rest);
    await postOne(next);
  };
  const toggle = (id) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  if (!user) {
    return (
      <div className="stream-clips-page">
        <EmptyState icon="content_cut" title={t('streamClips.page.title')}>{t('streamClips.loginToPost')}</EmptyState>
      </div>
    );
  }

  return (
    <div className="stream-clips-page stream-clips-home">
      <SEOHead title={t('streamClips.page.title')} url={window.location.href} />
      <div className="stream-highlights__head">
        <h1 className="stream-highlights__title"><Icon name="content_cut" size={20} />{t('streamClips.page.title')}</h1>
        <p className="stream-highlights__sub">{t('streamClips.page.sub', { hours: state.keepHours })}</p>
      </div>

      {queue.length > 0 && (
        <div className="stream-clips-home__queue">
          <Button variant="primary" size={40} icon="movie" onClick={postNext} loading={busy} disabled={busy}>
            {t('streamClips.page.queueNext', { count: queue.length })}
          </Button>
          <Button variant="ghost" size={40} onClick={() => { writeClipQueue([]); setQueue([]); }}>{t('streamClips.page.queueClear')}</Button>
        </div>
      )}

      {state.loading && <div className="stream-highlights__skeleton v2-skeleton" />}
      {!state.loading && state.error && <p className="stream-highlights__empty">{t('streamClips.error')}</p>}
      {!state.loading && !state.error && !state.clips.length && <p className="stream-highlights__empty">{t('streamClips.page.empty')}</p>}

      {rooms.map((r) => (
        <section key={r.room} className="stream-highlights">
          <h2 className="stream-clips-home__room">
            {r.host === user ? t('streamClips.page.yours') : t('streamClips.page.ofStream', { host: r.host || '' })}
            {' '}<Link className="stream-highlights__at" to={`/live/clips/${encodeURIComponent(r.room)}`}>{r.room}</Link>
          </h2>
          <ul className="stream-highlights__clips">
            {r.clips.map((c) => {
              const ready = isReadyClip(c);
              const share = clipShareFor({ poster: user, host: c.host, clipper: c.clipper });
              return (
                <li key={c.id} className={`stream-highlights__clip${ready ? '' : ' is-waiting'}`}>
                  {ready
                    ? <video className="stream-highlights__video" src={clipFileUrl(c.api, c.path)} controls playsInline preload="metadata" />
                    : (
                      <div className="stream-highlights__placeholder">
                        <Icon name={c.status === 'pending' ? 'schedule' : 'content_cut'} size={24} />
                        <span>{c.status === 'pending' ? t('streamClips.status.pending') : t(`streamClips.reasonUnavailable.${c.reason || 'failed'}`)}</span>
                      </div>
                    )}
                  <div className="stream-highlights__meta">
                    <StatusPill tone={c.source === 'auto' ? 'accent' : 'muted'} caps={false}>
                      {c.source === 'auto' ? t('streamClips.source.auto') : c.clipper === user ? t('streamClips.source.mine') : c.clipper ? t('streamClips.source.by', { user: c.clipper }) : t('streamClips.source.guest')}
                    </StatusPill>
                    {Number.isFinite(c.offsetSec) && <span className="stream-highlights__at num">{t('streamClips.at', { time: clipClock(c.offsetSec) })}</span>}
                  </div>
                  {ready && share && (
                    <p className="stream-highlights__share">{share.role === 'clipper'
                      ? t('streamClips.shareClipper', { clipper: share.account, percent: share.percent })
                      : t('streamClips.shareHost', { host: share.account, percent: share.percent })}</p>
                  )}
                  {ready && (
                    <div className="stream-highlights__actions">
                      <label className="stream-clips-home__pick">
                        <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
                        {t('streamClips.page.select')}
                      </label>
                      <Button variant="secondary" size={40} icon="movie" onClick={() => postOne(c)} disabled={busy}>{t('streamClips.postShort')}</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {picked.size > 0 && (
        <div className="stream-clips-home__bar">
          <Button variant="primary" size={48} icon="movie" onClick={postSelected} loading={busy} disabled={busy}>
            {t('streamClips.page.postSelected', { count: picked.size })}
          </Button>
        </div>
      )}
    </div>
  );
}
