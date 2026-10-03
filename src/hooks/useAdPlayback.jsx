import { useState, useEffect, useCallback, useRef } from 'react';
import { createAdBreak, rememberAdSeenFor } from '../lib/adBreak';
import { resolveVideoMeta } from '../lib/videoMetaCache';
import AdOverlay from '../components/ads/AdOverlay';
import AdSkip from '../components/ads/AdSkip';
import BannerClick from '../components/ads/BannerClick';
import TickerCrawl from '../components/ads/TickerCrawl';

/* Everything a player needs to carry 3Speak's server-side ads, lifted out of
 * page/Watch.jsx so the watch page and the inline chat player run the SAME code:
 * the spot request, the disclosure / countdown / Skip / seek lock, spent-spot
 * jumping, the banner (burned or drawn) and the ticker, and every impression
 * report those make. Moved verbatim; the comments are the watch page's own.
 *
 * The caller owns the SDK player and the <video> element and hands them in:
 *   player, playerState  from usePlayer()
 *   videoElRef           an object ref holding the <video> element
 *   videoAttached        true once that element is attached to the player
 *
 * Per video, call beginVideo() before loading, then loadWithSpot() to try for a
 * spot; it loads the stitched source itself and returns 'plain' when the caller
 * should load the ordinary way instead.
 */
export function useAdPlayback({ player, playerState, videoElRef, videoAttached }) {
  // Server-side ad insertion. Holds the mapping from the player's (stitched)
  // timeline back to content time — see lib/adBreak.js for why that matters.
  const adBreakRef = useRef(createAdBreak());
  const [sponsorVisible, setSponsorVisible] = useState(false);
  // A burned-in banner has nothing in the page to show, so this drives only the
  // click target over it. Separate from sponsorVisible: the two placements have
  // different windows and either can run without the other.
  const [bannerVisible, setBannerVisible] = useState(false);
  // The ticker crawl. Its own window again: it can run with, without or instead of
  // either of the other two placements.
  const [tickerVisible, setTickerVisible] = useState(false);
  // Paused behind a video spot that cut in mid-crossing. See the ticker effect.
  const [tickerHeld, setTickerHeld] = useState(false);
  // Seconds left before the break, 3 → 1, or null. A mid-roll that arrives with no
  // warning is the part people resent most; a few seconds' notice costs the
  // advertiser nothing and turns an interruption into a beat.
  const [adCountdown, setAdCountdown] = useState(null);
  /* 🚨 Is the timeline locked because a break is imminent or running?
   *
   * The countdown used to be a warning with no teeth: it named the second to drag the
   * handle past, and the bar was still live to do it with. This is the same window,
   * read off adBreak so the lock and the hint can never disagree. */
  const [adLocked, setAdLocked] = useState(false);
  // Seconds until the content resumes, while the spot is on screen. The wait is
  // the thing a viewer actually wants to know, and a number that is visibly
  // ticking down reads as shorter than the same wait with no number on it.
  const [resumeIn, setResumeIn] = useState(null);
  // Whether a Skip is being offered on the spot playing right now. The server decides
  // IF and AFTER HOW LONG; this is only whether that moment has arrived.
  const [canSkipAd, setCanSkipAd] = useState(false);
  /* A hard rule: NO ad chrome at all while the source is being swapped.
   *
   * Reloading a source resets the playhead to zero before the new manifest lands, and
   * a spot booked at the start of the video is "playing" at zero. So for a moment
   * after closing a banner, the roll's disclosure and Skip flashed up over a video
   * that was simply reloading. Rather than teach every control to recognise that
   * moment, one flag silences all of them, and it is a flag rather than more window
   * arithmetic because the timeline is exactly what cannot be trusted mid-swap. */
  const [adChromeOff, setAdChromeOff] = useState(false);
  // Seconds until the Skip becomes pressable, or null once it is. The control is on
  // screen for the whole spot either way; this only decides which state it is in.
  const [skipIn, setSkipIn] = useState(null);
  // Whether the banner may be closed yet. See adBreak.bannerClosable.
  const [bannerClosable, setBannerClosable] = useState(false);
  // Disclosure. Required by EU and US advertising rules, and driven off the same
  // clock the tracker reads so it can never disagree with what is on screen.
  useEffect(() => {
    const ab = adBreakRef.current;
    // Silenced while the source is swapping: the clock is meaningless until the new
    // manifest is parsed, so nothing derived from it may be shown.
    if (adChromeOff) {
      if (sponsorVisible) setSponsorVisible(false);
      if (bannerVisible) setBannerVisible(false);
      if (bannerClosable) setBannerClosable(false);
      if (adCountdown !== null) setAdCountdown(null);
      if (adLocked) setAdLocked(false);
      if (resumeIn !== null) setResumeIn(null);
      if (canSkipAd) setCanSkipAd(false);
      if (skipIn !== null) setSkipIn(null);
      return;
    }
    // `active` is the SPOT. A playback can carry a banner and no spot, so the banner
    // is cleared on its own terms rather than with the break.
    if (!ab.active && !ab.bannerInfo) {
      if (sponsorVisible) setSponsorVisible(false);
      if (bannerVisible) setBannerVisible(false);
      if (adCountdown !== null) setAdCountdown(null);
      if (adLocked) setAdLocked(false);
      if (resumeIn !== null) setResumeIn(null);
      if (canSkipAd) setCanSkipAd(false);
      if (skipIn !== null) setSkipIn(null);
      return;
    }
    if (!ab.active) {
      if (sponsorVisible) setSponsorVisible(false);
      if (adCountdown !== null) setAdCountdown(null);
      if (adLocked) setAdLocked(false);
      if (resumeIn !== null) setResumeIn(null);
      const t0 = Number(playerState?.currentTime) || 0;
      const onB = ab.isBannerVisible(t0);
      if (onB !== bannerVisible) setBannerVisible(onB);
      return;
    }
    const t = Number(playerState?.currentTime) || 0;
    const inside = ab.isInside(t);
    if (inside !== sponsorVisible) setSponsorVisible(inside);

    const onBanner = ab.isBannerVisible(t);
    if (onBanner !== bannerVisible) setBannerVisible(onBanner);

    // Only inside the last few seconds, and never while the spot is already playing.
    // countdownAt() rather than the arithmetic inline: it is what arms the seek lock,
    // so the hint appearing and the timeline locking are one event, not two.
    const next = inside ? null : ab.countdownAt(t);
    if (next !== adCountdown) setAdCountdown(next);

    // Armed by the hint above and held through the spot. Read after it, so the first
    // frame the countdown is visible is already a locked one.
    const locked = ab.seekLocked(t);
    if (locked !== adLocked) setAdLocked(locked);

    // Whole seconds, so it ticks once a second rather than flickering per frame.
    const remain = inside ? ab.secondsRemaining(t) : null;
    const shown = remain == null ? null : Math.max(0, Math.ceil(remain));
    if (shown !== resumeIn) setResumeIn(shown);

    // Skippable, and only once the server's threshold has actually elapsed. Read off
    // the same clock as the disclosure, so a Skip can never appear over a spot that is
    // not running.
    // The banner's close button waits too, on the same server-sent threshold. The
    // click target does not: following an ad is something a viewer may do at once.
    const closable = onBanner && ab.bannerClosable(t);
    if (closable !== bannerClosable) setBannerClosable(closable);

    const skippable = inside && ab.canSkip(t);
    if (skippable !== canSkipAd) setCanSkipAd(skippable);

    // Whole seconds, so it ticks once rather than flickering per frame — the same
    // treatment the resume countdown gets, for the same reason.
    const untilSkip = inside ? ab.secondsUntilSkip(t) : null;
    const shownSkip = untilSkip == null ? null : Math.max(1, Math.ceil(untilSkip));
    if (shownSkip !== skipIn) setSkipIn(shownSkip);
  }, [playerState?.currentTime, sponsorVisible, bannerVisible, adCountdown, adLocked, resumeIn, canSkipAd, skipIn, adChromeOff, bannerClosable]);

  /* The viewer closed the banner.
   *
   * 🚨 Telling the server is not enough on its own. The banner is IN the picture, so
   * every second the player has already buffered still carries it, and on a healthy
   * connection that is most of its run: closing it would appear to do nothing for
   * several seconds, which reads as a broken button rather than a slow one.
   *
   * So the buffer AHEAD of the playhead is dropped and refetched. Those segments come
   * back unburned now that the server has been told, and the ad goes in about a
   * second. It costs a moment of loading, which is the right trade for somebody who
   * has just asked to be rid of it. Only what is ahead: flushing from zero would throw
   * away what is behind too and make a scrub back re-download.
   *
   * All best-effort. hls.js is not guaranteed to be the engine, and a flush that fails
   * leaves the old behaviour, where the banner simply finishes its run. Never a reason
   * to throw inside a click handler on the watch page.
   */
  /* Skip the rest of the spot: seek to where the content resumes.
   *
   * The break is spliced INTO the playlist, so there is nothing to unload — the video
   * carries on immediately after it, and moving the playhead past the break is the
   * whole of skipping. `endOfBreak` lands a hair past the boundary, because stopping
   * exactly on it can leave the player one frame inside the spot and flash the
   * disclosure back up.
   *
   * The advertiser is not billed for what was not watched: an impression completes
   * only once enough of the spot has actually played, so a skip at five seconds of a
   * fifteen second spot was never a charge in the first place.
   */
  const skipAd = useCallback(() => {
    const to = adBreakRef.current?.endOfBreak?.();
    // Counted as watched. The button only exists after the threshold, so pressing it
    // means the spot got the seconds it was owed.
    try { adBreakRef.current?.recordSkip?.(); } catch { /* the skip still happens */ }
    setCanSkipAd(false);
    if (!Number.isFinite(to)) return;
    try { player?.seek(to); } catch { /* the spot simply plays out */ }
  }, [player]);


  /* Seconds the ticker has ACTUALLY been watched in its current run: playback time
   * that advanced while the strip was on screen, the video playing and the tab in
   * front. A paused video freezes the strip and a background tab shows nobody
   * anything, so neither counts; a seek out of the window starts the count over. */
  const tickerWatchRef = useRef({ seconds: 0, lastT: null, done: false });

  /* The ticker's window, off the same clock as everything else. Hidden while the
   * source is swapping, for the reason every other piece of ad chrome is. */
  useEffect(() => {
    const ab = adBreakRef.current;
    const t = Number(playerState?.currentTime) || 0;
    const on = !adChromeOff && ab.isTickerVisible(t, Number(playerState?.duration) || 0);
    const w = tickerWatchRef.current;
    /* A video spot cutting in mid-crossing PAUSES the ticker: kept mounted but hidden
     * and frozen, its watched seconds kept, and it carries on after the spot. Ending
     * the run there meant a ticker sharing a playback with an early spot never
     * completed and was never counted. */
    const held = !on && ab.isInside(t) && w.seconds > 0 && !w.done;
    if (held !== tickerHeld) setTickerHeld(held);
    if (held) { w.lastT = null; return; }
    if (on !== tickerVisible) setTickerVisible(on);
    if (!on) {
      // Out of the window: a partial run is not a view. Nothing is kept.
      if (!w.done) { w.seconds = 0; w.lastT = null; }
      return;
    }
    const playing = playerState?.paused === false
      && (typeof document === 'undefined' || document.visibilityState === 'visible');
    if (playing && w.lastT != null) {
      const dt = t - w.lastT;
      // Normal playback only. A jump (seek) inside the window is not time watched.
      if (dt > 0 && dt <= 1.5) w.seconds += dt;
    }
    w.lastT = playing ? t : null;

    const booked = Number(ab.tickerInfo?.durationSeconds) || 0;
    // A whole crossing watched: only NOW is it seen. The impression is reported and the
    // ad goes into the browser's seen-list for its own window (capMinutes), so the two
    // agree with the server, which only counts reported crossings.
    if (!w.done && booked > 0 && w.seconds >= booked * 0.95) {
      w.done = true;
      try { ab.reportTickerShown(); } catch { /* an unreported impression is not a crash */ }
      if (ab.tickerInfo?.adKey) rememberAdSeenFor(ab.tickerInfo.capMinutes, ab.tickerInfo.adKey);
    }
  }, [playerState?.currentTime, playerState?.duration, playerState?.paused, adChromeOff, tickerVisible, tickerHeld]);

  /* Report a DRAWN banner once it has been on screen for its booked seconds.
   *
   * A burned banner is counted by the server as its segments are fetched; a drawn one
   * never touches the server, so unless the page says so it is never counted. Same rule
   * as the standalone player: continuous time on screen, so seeking away or closing it
   * first cancels the claim. */
  useEffect(() => {
    if (!bannerVisible) return undefined;
    const ab = adBreakRef.current;
    if (!ab.bannerOverlay) return undefined;
    const booked = Number(ab.bannerInfo?.durationSeconds) || 0;
    if (booked <= 0) return undefined;
    const timer = setTimeout(() => {
      try { ab.reportBannerShown(); } catch { /* an unreported impression is not a crash */ }
    }, booked * 1000);
    return () => clearTimeout(timer);
  }, [bannerVisible]);

  const dismissBanner = useCallback(async () => {
    setBannerVisible(false);

    /* 🚨 A DRAWN BANNER IS ALREADY GONE.
     *
     * Hiding the element removes it, so none of what follows applies: there is no
     * reload, so no window where the clock reads zero and a passed spot looks live,
     * and nothing to seek back from. Everything below exists only because a burned
     * banner lives in bytes the browser has already downloaded.
     *
     * Told to the server all the same, so it stops counting the banner as on screen
     * and stops serving it for the rest of the session. */
    if (adBreakRef.current?.bannerOverlay) {
      try { await adBreakRef.current?.dismissBanner?.(); } catch { /* the hide stands */ }
      return;
    }

    // Everything ad-related goes quiet until the new manifest is parsed: a reload walks
    // the playhead through zero, and a spot booked at the start of the video is inside
    // its own window there.
    setAdChromeOff(true);

    /* HARD RULE: a spot already passed never shows its chrome again.
     *
     * Silencing only for the duration of the swap was not enough. The flag comes off
     * when the manifest parses, which is BEFORE the player has seeked back, so there
     * was still a window where the clock read zero and the pre-roll looked live.
     *
     * If the break ends at or before where the viewer is being put back, it is retired
     * outright and no clock can resurrect it. A break not yet reached is left alone:
     * that one still has to run. */
    try {
      const end = adBreakRef.current?.endOfBreak?.();
      const at0 = videoElRef.current?.currentTime;
      if (Number.isFinite(end) && Number.isFinite(at0) && end <= at0) {
        adBreakRef.current?.retireSpot?.();
      }
    } catch { /* the swap flag still covers the reload itself */ }
    try { await adBreakRef.current?.dismissBanner?.(); } catch { /* the hide still happens */ }

    /* SWAP THE SOURCE. Do not try to un-burn what is already downloaded.
     *
     * 🚨 Flushing the buffer was the wrong tool and could never have worked. The
     * covered seconds keep the SAME segment urls whether or not the banner is on them,
     * so a refetch is a refetch of the burned bytes, and the browser will happily serve
     * them from its own cache without asking anybody. Two rounds of cache headers and
     * buffer margins went into that and none of it could have.
     *
     * A dismissed session's playlist points those seconds at the CDN original instead,
     * so reloading the source genuinely changes which files play. Different urls, so
     * nothing cached under the old ones can come back.
     *
     * The position is captured first and restored once the new manifest is parsed,
     * because loading a source starts it from the beginning otherwise, and a viewer who
     * closed an ad should not be sent back to the start of the video for it.
     */
    try {
      const hls = player?.hls;
      const el = videoElRef.current;
      const at = el?.currentTime;
      const wasPlaying = el && !el.paused;
      if (!hls?.loadSource || !hls.url || !Number.isFinite(at)) { setAdChromeOff(false); return; }
      /* `startLoad(position)` rather than setting currentTime.
       *
       * Reloading a source detaches and re-attaches the MediaSource, so the element
       * starts empty at zero. Assigning currentTime against an empty buffer is ignored
       * as often as not; telling hls.js WHERE TO BEGIN LOADING is the supported way,
       * and the element lands there once the first fragment arrives. */
      hls.once('hlsManifestParsed', () => {
        try {
          hls.startLoad(at);
          if (wasPlaying) videoElRef.current?.play?.().catch(() => {});
        } catch { /* the viewer can press play */ }
        // Back on only once the playhead means something again.
        setAdChromeOff(false);
      });
      hls.loadSource(hls.url);
      // Belt and braces: a manifest that never parses must not silence the chrome for
      // the rest of the video.
      setTimeout(() => setAdChromeOff(false), 8000);
    } catch { setAdChromeOff(false); }
  }, [player]);

  /* 🚨 A SPOT THAT HAS RUN IS A HOLE IN THE TIMELINE.
   *
   * The ad is stitched into the manifest, so its seconds are real positions somebody
   * can drag the handle onto, and scrubbing back over your own video played the ad
   * again. Reloading onto a clean manifest would fix it and cost far more than it is
   * worth: that is the source swap the banner used to do, and it was never seamless.
   * So the seconds stay in the file and the playhead refuses to rest on them, jumping
   * to whichever side the viewer was travelling towards.
   *
   * `lastSeen` is the position BEFORE this event, which is the only way to tell a
   * scrub back from a scrub forward. Bound to `seeked` as well as `timeupdate`
   * because a quarter of a second of an ad already sat through still reads as one.
   */
  useEffect(() => {
    const el = videoElRef.current;
    if (!el) return undefined;
    let lastSeen = null;
    let boundaryRaf = 0;
    /* How far ahead of the cut to leave. Covers the gap between the frame on screen
     * and the clock, plus the seek's own latency. */
    const BOUNDARY_LEAD_S = 0.16;

    /* 🚨 WATCH THE BOUNDARY BY FRAME, not by timeupdate.
     *
     * A seek is announced, so it can be redirected before anything is drawn. Ordinary
     * playback into a spent spot is not: it just arrives, and timeupdate reports about
     * four times a second, so up to a quarter second of an ad the viewer already sat
     * through was presented before the jump. Re-watching the run-up to a mid-roll is
     * where that shows.
     *
     * Armed only within a second and a half of the cut and dropped as soon as playback
     * is past it or paused, so this is not a render loop the page carries around. */
    const boundaryTick = () => {
      boundaryRaf = 0;
      const ab = adBreakRef.current;
      const start = ab?.spotStart?.();
      const at = el.currentTime;
      if (start == null || !ab.spotConsumed || !Number.isFinite(at) || el.paused) return;
      /* 🚨 JUMP BEFORE THE CUT, not on it.
       *
       * Waiting until the playhead is inside the spot is already too late twice over:
       * the frame on screen is decoded ahead of what currentTime reports, and the seek
       * itself takes long enough that the ad frame sits there while it runs. Leaving a
       * sixth of a second early costs content at a point the viewer is about to be
       * moved away from anyway, and it is the difference between a glimpse of
       * somebody's ad and none. */
      if (at >= start - BOUNDARY_LEAD_S) {
        const to = ab.endOfBreak?.();
        if (Number.isFinite(to)) { try { el.currentTime = to; } catch { /* it plays through */ } }
        return;
      }
      if (start - at > 1.5) return;
      boundaryRaf = requestAnimationFrame(boundaryTick);
    };
    const armBoundary = () => {
      if (boundaryRaf) return;
      const ab = adBreakRef.current;
      const start = ab?.spotStart?.();
      const at = el.currentTime;
      if (start == null || !ab.spotConsumed || !Number.isFinite(at) || el.paused) return;
      if (at < start && start - at <= 1.5) boundaryRaf = requestAnimationFrame(boundaryTick);
    };

    /* `ev` says whether the playhead was MOVED or simply arrived: this is bound to
     * timeupdate as well as the two seek events.
     *
     * 🚨 The lock must only ever refuse a seek. Playing normally into the cut walks
     * the clock forward across the spot's start like any other second, and treating
     * that as a jump to be refused pins the playhead just short of the ad and never
     * lets the spot start at all — the break would be unreachable and unbillable,
     * which is the exact opposite of the point. Spent-spot jumping has no such
     * problem (those seconds are meant to be skipped however they are reached), so it
     * runs on every event. */
    const guard = (ev) => {
      const ab = adBreakRef.current;
      const at = el.currentTime;
      if (!ab || !Number.isFinite(at)) return;
      ab.noteTime?.(at);
      const moved = !!ev && ev.type !== 'timeupdate';
      /* Two rules, in order, and they never both apply: skipTargetFor moves the
       * playhead OUT of a spot already watched, lockedSeekTarget refuses to let it
       * leave one that has not been. The second is the backstop for every way past a
       * break that is not the progress bar — a deep link, a chapter marker, a reaction
       * jump, a media key, anything a later feature adds — because they all end up
       * setting currentTime on this element whatever they called to get here. */
      const to = ab.skipTargetFor?.(at, lastSeen)
        ?? (moved ? ab.lockedSeekTarget?.(at, lastSeen) : null);
      if (to == null) { lastSeen = at; armBoundary(); return; }
      try { el.currentTime = to; } catch { /* it plays through, as it did before */ }
      lastSeen = to;
    };
    /* 🚨 'seeking' does the work here, not 'seeked'.
     *
     * 'seeked' fires once the media has SETTLED on the new position, by which time a
     * frame or two of the ad has been decoded and shown — the flash of ad you get
     * from clicking into its span. 'seeking' fires the moment currentTime changes,
     * before anything is presented, and setting currentTime again from inside it
     * supersedes the seek in flight. 'seeked' stays as the backstop for any path that
     * reaches a new position without announcing it first. */
    el.addEventListener('timeupdate', guard);
    el.addEventListener('seeking', guard);
    el.addEventListener('seeked', guard);
    return () => {
      if (boundaryRaf) cancelAnimationFrame(boundaryRaf);
      el.removeEventListener('timeupdate', guard);
      el.removeEventListener('seeking', guard);
      el.removeEventListener('seeked', guard);
    };
  }, [videoAttached]);

  // A new video is a new break and a new ticker run.
  const beginVideo = useCallback(() => {
    adBreakRef.current.reset();
    tickerWatchRef.current = { seconds: 0, lastT: null, done: false };
    setTickerHeld(false);
    setSponsorVisible(false);
    setBannerVisible(false);
  }, []);

  /* Ask whether this playback carries a sponsor spot, and load the stitched source
   * if it does. Returns 'spot' (loaded), 'stale' (the caller moved on; do nothing)
   * or 'plain' (no spot: load the ordinary way). Never throws: no ad is always
   * better than no video. `isActive` is the caller's staleness check. */
  const loadWithSpot = useCallback(async ({ api, author, permlink, viewer, loadVideo, isActive }) => {
    try {
      const source = await api.fetchSource(author, permlink);
      if (!isActive() || !source?.url) throw new Error('no source');
      const meta = await resolveVideoMeta(api, author, permlink);
      // 🚨 NEVER ON A SHORT. See the note in page/Watch.jsx's load effect: shorts
      // have their own format, played BETWEEN them rather than inside one. The FLAG,
      // not the length.
      const spot = meta?.short === true ? null : await adBreakRef.current.request({
        owner: meta?.owner || author,
        permlink: meta?.permlink || permlink,
        viewer,
        manifestUrl: source.url,
        // This player can draw a ticker, for every viewer. Which channels carry one
        // is the checker's call.
        ticker: true,
      });
      if (!isActive()) return 'stale';
      if (spot) {
        // Original stays as the next fallback, so a stitcher outage degrades to
        // ordinary playback rather than a dead player.
        await loadVideo({
          url: spot.manifestUrl,
          fallbacks: [source.url, ...(source.fallbacks || [])],
          poster: source.poster,
        });
        adBreakRef.current.resolve();
        return 'spot';
      }
    } catch { /* no spot, or we could not resolve one — play it plainly */ }
    return isActive() ? 'plain' : 'stale';
  }, []);

  /* The ad chrome a player frame draws, as the props PlayVideo takes. Built here so
   * a second player cannot forget a piece of the disclosure. */
  const ab = adBreakRef.current;
  const chrome = {
    adPlaying: sponsorVisible,
    adCountdown,
    adLocked,
    sponsorLabel: sponsorVisible ? (
      // A node, not a string: the disclosure names the advertiser, their product and
      // their slogan, and draws their logo. AdOverlay is the same component the
      // /advertise preview uses.
      <AdOverlay
        account={ab.info?.brand?.account || null}
        brand={ab.info?.brand || null}
        resumeIn={resumeIn}
      />
    ) : null,
    adSkip: sponsorVisible && ab?.skipOffered ? (
      <AdSkip secondsUntil={skipIn} onSkip={canSkipAd ? skipAd : null} />
    ) : null,
    bannerHit: (
      // Nothing is drawn for a burned banner — it is already in the picture. This
      // is only somewhere to click, and only while it is on screen. videoElRef is
      // the OBJECT ref; a callback ref has no .current to measure.
      <BannerClick
        videoRef={videoElRef}
        placement={ab.bannerInfo?.placement}
        overlay={ab.bannerOverlay}
        visible={bannerVisible}
        clickUrl={ab.bannerInfo?.brand?.clickUrl}
        advertiser={ab.bannerInfo?.advertiser}
        onDismiss={dismissBanner}
      />
    ),
    tickerSlot: (tickerVisible || tickerHeld) && ab.tickerInfo ? (
      <TickerCrawl
        hidden={tickerHeld}
        account={ab.tickerInfo.account}
        productName={ab.tickerInfo.productName}
        message={ab.tickerInfo.message}
        label={ab.tickerInfo.label}
        clickUrl={ab.tickerInfo.clickUrl}
        durationSeconds={ab.tickerInfo.durationSeconds}
        tickerStyle={ab.tickerInfo.style}
        paused={tickerHeld || playerState?.paused === true}
      />
    ) : null,
  };

  return {
    adBreakRef,
    chrome,
    beginVideo,
    loadWithSpot,
    skipAd,
    dismissBanner,
    sponsorVisible,
    bannerVisible,
    tickerVisible,
    tickerHeld,
    adCountdown,
    adLocked,
    resumeIn,
    canSkipAd,
    skipIn,
  };
}
