import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { usePlayer } from '@mantequilla-soft/3speak-player/react';
import { getPlayerUrl } from '../utils/playerUrl';
import { useTranslation } from 'react-i18next';
import './EmbedPlayer.scss';

// Bare, chrome-free 3Speak player used INSIDE the Spotlight /links page (iframed).
// Mirrors the watch/shorts technique: usePlayer + a <video> element, resolving the
// HLS source from author/permlink via the SDK's apiBase (getPlayerUrl) — no
// play.3speak.tv iframe. `?short=1` renders it for a vertical 9:16 frame. Shorts do
// NOT autoplay. The page is kept transparent so the parent iframe's own loading
// spinner (.vid::after) shows through until the poster/first frame paints.
export default function EmbedPlayer() {
  const { t } = useTranslation();
  const { author, permlink } = useParams();
  const [sp] = useSearchParams();
  const isShort = sp.get('short') === '1';
  const [attached, setAttached] = useState(false);

  const a = String(author || '').toLowerCase();
  const p = String(permlink || '').toLowerCase();
  const valid = /^[a-z][a-z0-9.\-]{2,15}$/.test(a) && /^[a-z0-9-]{1,255}$/.test(p);

  const {
    ref: sdkVideoRef,
    player,
    load: loadVideo,
  } = usePlayer({
    apiBase: getPlayerUrl(),
    muted: false,
    loop: isShort, // a short loops once it's playing — but never autoplays
    poster: true,  // SDK paints the thumbnail/poster + play affordance
  });

  // Keep the document transparent so the parent's loading spinner shows through
  // until the player paints. Restored on unmount (SPA safety).
  useEffect(() => {
    const els = [document.documentElement, document.body, document.getElementById('root')].filter(Boolean);
    const prev = els.map((el) => el.style.background);
    els.forEach((el) => { el.style.background = 'transparent'; });
    return () => { els.forEach((el, i) => { el.style.background = prev[i]; }); };
  }, []);

  const videoRef = useCallback((el) => {
    // Detaching from an already-destroyed player throws, and a throw from a ref
    // callback unmounts the tree rather than being contained — a blank embed.
    try {
      sdkVideoRef(el);
    } catch {
      /* player already destroyed — nothing left to detach from */
    }
    setAttached(!!el);
  }, [sdkVideoRef]);

  useEffect(() => {
    if (!valid || !player || !attached) return;
    loadVideo(`${a}/${p}`).catch(() => {});
  }, [valid, a, p, player, attached, loadVideo]);

  if (!valid) return <div className="emb-player emb-player--err">{t('misc.embedPlayer.unavailable')}</div>;

  return (
    <div className={`emb-player${isShort ? ' short' : ''}`}>
      <video ref={videoRef} playsInline controls loop={isShort} />
    </div>
  );
}
