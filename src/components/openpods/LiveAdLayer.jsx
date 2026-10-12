import { useCallback, useEffect, useRef, useState } from 'react';
import { useStreamLive } from '@snapie/hangouts-react';
import { useAppStore } from '../../lib/store';
import { CHECKER_URL } from '../../utils/config';
import { adCapId, recentAdKeys, rememberAdSeen, rememberAdSeenFor } from '../../lib/adBreak';
import TickerCrawl from '../ads/TickerCrawl';
import BannerClick from '../ads/BannerClick';
import './LiveAdLayer.scss';

// Seconds of watching before we ask for an ad at all, so someone who opens a
// stream and leaves straight away never creates a session.
const ASK_AFTER_S = 3;
// The page clock ticks this often while the stream plays.
const TICK_MS = 500;
// The live stream counts as a video of this many seconds for PLACEMENT (each spot's
// positionPercent). Must match AD_LIVE_ASSUMED_SECONDS on the checker, which uses
// the same number for the banner's window and for length targeting.
export const LIVE_ASSUMED_SECONDS = 300;

/**
 * Ads on a live OpenPods stream: the ticker and the page-drawn banner, never a roll.
 *
 * Nothing is spliced or burned: a WebRTC stream has no playlist to splice into, and
 * the program track also feeds the VOD and DVR clips, so an ad drawn into it would
 * end up in the recording and could not be counted per viewer. Everything here is a
 * DOM overlay over the player, like the ticker and drawn banner on the watch page.
 *
 * The checker treats the stream as a video of LIVE_ASSUMED_SECONDS (surface 'live'):
 * it runs every rule the watch page gets (approval, Pro viewers, the creator's own
 * opt-out, cooldown, frequency caps, one ad per address per stream per day) and
 * picks overlay formats only. The page's clock is seconds of THIS viewer watching,
 * counted only while the stream is live and the tab is in front.
 *
 * Must render inside <StandaloneWatch> (it reads the room's live state), as a child
 * of the positioned box the video fills.
 */
export default function LiveAdLayer({ host, room, fit = 'contain', tickerTop = '0px' }) {
  const live = useStreamLive();
  const viewer = useAppStore((s) => (s.user || '').toLowerCase()) || null;

  const layerRef = useRef(null);
  const videoRef = useRef(null);
  const [ads, setAds] = useState(null);           // { sid, ticker, banner, bannerWindow, closeAfter }
  const [clock, setClock] = useState(0);          // seconds watched (live + visible)
  const askedRef = useRef(false);

  // The clock. Wall time, but only while the stream is live and the page is seen.
  useEffect(() => {
    if (!live) return undefined;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const dt = (now - last) / 1000;
      last = now;
      const seen = typeof document === 'undefined' || document.visibilityState === 'visible';
      // A frozen tab or a sleeping phone resumes with a huge dt: not watched.
      if (seen && dt > 0 && dt < 2) setClock((c) => c + dt);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [live]);

  // Ask once per stream, a few seconds in.
  useEffect(() => {
    if (askedRef.current || clock < ASK_AFTER_S || !host || !room) return;
    askedRef.current = true;
    (async () => {
      try {
        const res = await fetch(`${CHECKER_URL}/m/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            surface: 'live',
            owner: host,
            permlink: room,
            viewer,
            capId: adCapId(),
            recentAdKeys: recentAdKeys(),
            bannerOverlay: true,
            ticker: true,
          }),
        });
        if (!res.ok) return;
        const d = await res.json();
        const ticker = d?.ticker?.message && Number(d.ticker.durationSeconds) > 0 ? {
          ...d.ticker,
          start: Math.max(0, (Number(d.ticker.positionPercent) || 0) / 100) * LIVE_ASSUMED_SECONDS,
          durationSeconds: Number(d.ticker.durationSeconds),
        } : null;
        const banner = d?.banner?.overlay && (d.banner.overlay.imageUrl || d.banner.overlay.videoUrl)
          && Number(d.banner.durationSeconds) > 0 ? d.banner : null;
        if (!ticker && !banner) return;
        const sid = ((banner?.manifestUrl || ticker?.shownUrl || '').match(/\/m\/([0-9a-f]{32})[./]/) || [])[1] || null;

        // The banner's window and close delay come from the session, which fixed
        // them from the same slot maths (routes/adServe.js, surface 'live').
        let bannerWindow = null;
        let closeAfter = 5;
        if (banner && sid) {
          try {
            const r = await fetch(`${CHECKER_URL}/m/${sid}/i`);
            if (r.ok) {
              const i = await r.json();
              if (typeof i.bannerStartAt === 'number' && i.bannerDurationSeconds) {
                bannerWindow = { start: i.bannerStartAt, duration: i.bannerDurationSeconds };
              }
              if (typeof i.bannerCloseAfterSeconds === 'number') closeAfter = i.bannerCloseAfterSeconds;
            }
          } catch { /* no window, no banner */ }
        }
        setAds({ sid, ticker, banner: bannerWindow ? banner : null, bannerWindow, closeAfter });
      } catch { /* no ad is always fine on a stream */ }
    })();
  }, [clock, host, room, viewer]);

  // The <video> the banner positions itself against: the SDK's, inside our parent box.
  const findVideo = useCallback(() => {
    const box = layerRef.current?.parentElement;
    videoRef.current = box?.querySelector('video.hh-stream-video__el') || box?.querySelector('video') || null;
  }, []);

  // ── Ticker ────────────────────────────────────────────────────────────────
  const tk = ads?.ticker;
  const tickerOn = !!(tk && live && clock >= tk.start && clock < tk.start + tk.durationSeconds);
  const tickerDoneRef = useRef(false);
  const tickerSeenRef = useRef(0);
  const lastClockRef = useRef(null);
  useEffect(() => {
    if (!tickerOn) { lastClockRef.current = null; return; }
    const prev = lastClockRef.current;
    lastClockRef.current = clock;
    if (prev != null && clock > prev && clock - prev < 2) tickerSeenRef.current += clock - prev;
    if (!tickerDoneRef.current && tickerSeenRef.current >= tk.durationSeconds * 0.95) {
      tickerDoneRef.current = true;
      if (tk.shownUrl) {
        fetch(tk.shownUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', keepalive: true })
          .catch(() => { /* an unreported impression is not a crash */ });
      }
      if (tk.adKey) rememberAdSeenFor(tk.capMinutes, tk.adKey);
    }
  }, [tickerOn, clock, tk]);

  // ── Banner ────────────────────────────────────────────────────────────────
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const bw = ads?.bannerWindow;
  const bannerOn = !!(ads?.banner && bw && live && !bannerDismissed
    && clock >= bw.start && clock < bw.start + bw.duration);
  // When (on the watch clock) the banner came on screen, for its close delay.
  const [bannerSince, setBannerSince] = useState(null);
  useEffect(() => {
    if (!bannerOn) { setBannerSince(null); return; }
    setBannerSince((since) => (since == null ? clock : since));
  }, [bannerOn, clock]);
  const bannerClosable = bannerOn && bannerSince != null && clock - bannerSince >= (ads?.closeAfter ?? 5);

  useEffect(() => { if (bannerOn) findVideo(); }, [bannerOn, findVideo]);

  // First sight puts it in the seen list; a full booked run on screen is the impression.
  const bannerRememberedRef = useRef(false);
  const bannerReportedRef = useRef(false);
  useEffect(() => {
    if (!bannerOn || !ads?.banner) return undefined;
    if (!bannerRememberedRef.current && ads.banner.adKey) {
      bannerRememberedRef.current = true;
      rememberAdSeen(ads.banner.adKey);
    }
    const booked = Number(ads.banner.durationSeconds) || 0;
    if (booked <= 0 || bannerReportedRef.current || !ads.sid) return undefined;
    // Continuous time on screen, as on the watch page: hiding it first cancels the claim.
    const timer = setTimeout(() => {
      bannerReportedRef.current = true;
      fetch(`${CHECKER_URL}/m/${encodeURIComponent(ads.sid)}/banner-shown`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', keepalive: true,
      }).catch(() => { /* an unreported impression is not a crash */ });
    }, booked * 1000);
    return () => clearTimeout(timer);
  }, [bannerOn, ads]);

  const dismissBanner = useCallback(() => {
    setBannerDismissed(true);
    if (!ads?.sid) return;
    fetch(`${CHECKER_URL}/m/${encodeURIComponent(ads.sid)}/dismiss`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', keepalive: true,
    }).catch(() => { /* the local hide already happened */ });
  }, [ads]);

  if (!ads) return <div ref={layerRef} className="live-ads" aria-hidden="true" />;
  return (
    <div ref={layerRef} className="live-ads" style={{ '--live-ads-ticker-top': tickerTop }}>
      {ads.banner && (
        <BannerClick
          videoRef={videoRef}
          placement={ads.banner.placement}
          overlay={ads.banner.overlay}
          visible={bannerOn}
          clickUrl={ads.banner.brand?.clickUrl}
          advertiser={ads.banner.advertiser}
          onDismiss={bannerClosable ? dismissBanner : undefined}
          fit={fit}
        />
      )}
      {tickerOn && tk && (
        <div className="live-ads__ticker">
          <TickerCrawl
            account={tk.account || null}
            productName={tk.productName || null}
            message={tk.message}
            label={tk.label || 'Ad'}
            clickUrl={tk.clickUrl || null}
            durationSeconds={tk.durationSeconds}
            tickerStyle={tk.style === 'hold' ? 'hold' : 'crawl'}
            paused={false}
          />
        </div>
      )}
    </div>
  );
}
