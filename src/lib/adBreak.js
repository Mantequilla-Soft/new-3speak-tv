/**
 * Client half of server-side ad insertion, for the SDK-based watch page.
 *
 * Deliberately a near-copy of preview-player/src/adBreak.js rather than a shared
 * package: the two live in different services with different build chains, and a
 * new npm dependency between them costs more than this duplication does. If a
 * third player ever needs it, that is the moment to extract it.
 *
 * The spot is already inside the playlist by the time the player sees it, so
 * nothing here fetches an ad and there is no request for a blocker to match. What
 * this does is the bookkeeping the player cannot do alone:
 *
 *  1. ASK whether this playback carries a spot, and hand back a source to load.
 *  2. MAP the player's timeline back to content time. The important one: in a
 *     stitched stream currentTime includes the ad, so every ad second would
 *     otherwise be recorded as watch time against the creator's video — poisoning
 *     the retention data the ad forecast is itself built from.
 *  3. Say when the playhead is inside the break, so a Sponsored label can show.
 *
 * Every failure path returns "no ad". A video must never fail to play because the
 * ad system had a bad day.
 */
import { CHECKER_URL } from '../utils/config';

const AD_BASE = CHECKER_URL;

// The stitcher only learns where the cut fell when a variant playlist is fetched,
// a beat after the source is set. Retry briefly rather than guess — a wrong offset
// silently corrupts watch data, which is worse than no label.
const RESOLVE_TRIES = 6;
const RESOLVE_DELAY_MS = 700;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Frequency-cap id for a viewer we cannot name. Per page load, in memory only —
 * never localStorage, never a cookie. It dies with the tab, so one browsing session
 * is capped without any durable anonymous identifier existing.
 */
/**
 * When this viewer should next be offered an ad, whoever the advertiser is.
 *
 * 🚨 This is a TIMESTAMP, not an identifier, and the distinction is the whole reason
 * it is allowed to be durable at all. CAP_ID below is deliberately per page load
 * because a persistent random id is a viewing profile in all but name. An expiry is
 * not: it is one number, identical for everyone who saw an ad at the same moment,
 * with no history behind it and nothing to correlate across visits.
 *
 * It exists so the quiet period survives navigating to the next video — the whole
 * point being that five videos should not carry five different advertisers in a row.
 * Server-side is authoritative for anyone signed in; this is what covers the rest.
 *
 * Read and written through try/catch: storage throws outright in some privacy modes,
 * and an ad decision must never be the thing that breaks a page.
 */
const SEEN_KEY = '3speak-ads-seen';
const SEEN_MINUTES = 30;   // matches AD_FREQUENCY_CAP_MINUTES on the server

/**
 * Which ADS this viewer has already been shown recently, so the same advertiser does
 * not follow them from one video to the next.
 *
 * 🚨 Per AD, not per viewer. The server has always capped repeats of the same
 * campaign, but it keys that on the signed-in name or on CAP_ID — and CAP_ID is per
 * page load by design, so for anyone not signed in the cap reset on every navigation
 * and one advertiser could run the whole session. This is the part that persists.
 *
 * What is stored is a list of opaque `adKey`s with the time each was seen. Not
 * viewing history: it says which ADVERTS were shown, never which videos were watched,
 * and each entry expires on its own within the cap window. Sending it can only cost
 * the viewer ads, never earn them extra, which is why the server can accept it
 * without trusting it.
 *
 * Read and written through try/catch — storage throws outright in some privacy modes,
 * and an ad decision must never be the thing that breaks a page.
 */
function readSeen() {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    const cutoff = Date.now() - SEEN_MINUTES * 60 * 1000;
    const out = {};
    for (const [k, t] of Object.entries(raw)) if (Number(t) > cutoff) out[k] = Number(t);
    return out;
  } catch { return {}; }
}

export function recentAdKeys() {
  return Object.keys(readSeen());
}

export function rememberAdSeen(...keys) {
  const flat = keys.flat().filter((k) => typeof k === 'string' && k);
  if (!flat.length) return;
  try {
    const seen = readSeen();
    const now = Date.now();
    for (const k of flat) seen[k] = now;
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch { /* storage unavailable — the server still caps a signed-in viewer */ }
}

const CAP_ID = (() => {
  try {
    const a = new Uint8Array(12);
    (globalThis.crypto || {}).getRandomValues?.(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
})();

export function createAdBreak() {
  let session = null;
  let window_ = null;
  // Seconds into the spot at which a Skip may be offered, or null for never.
  let skipAfter = null;
  // Seconds into the banner before its close button may appear. The server decides.
  let bannerCloseAfter = 5;
  // Set once the spot has been passed for good; nothing shows its chrome afterwards.
  let spotRetired = false;
  /* Has this spot actually RUN?
   *
   * A spot that has been sat through is spent, and the seconds it occupies become a
   * hole in the timeline rather than something to serve again to somebody scrubbing
   * back over their own video. `entered` is what keeps that honest: dragging straight
   * past a spot that never played does not spend it. */
  let spotEntered = false;
  let spotConsumed = false;
  let premium = false;
  // The banner is a SEPARATE placement, from a separate advertiser, that can be
  // present with or without a spot. It is not a second kind of break: it adds no
  // time to the timeline, so it never affects contentTime() — the picture changes,
  // the clock does not.
  let banner = null;
  let bannerWindow = null;
  // A banner-only playback still has a session to ask /i about, and it is the same
  // sid — both placements ride one session — but it is read from the banner's own
  // manifest URL because that is the only one present in that case.
  let bannerSid = null;

  return {
    get active() { return !!session; },
    get info() { return session; },
    get resolved() { return !!window_; },

    /** The banner running on this playback, or null. */
    get bannerInfo() { return banner; },

    /** The creative to draw, when the server handed it over. Null when burned. */
    get bannerOverlay() { return (banner && banner.overlay) || null; },

    /**
     * The viewer closed the banner.
     *
     * Tells the server to stop burning it, and forgets it locally so the click target
     * and the close button go with it. The pixels already decoded still carry the ad:
     * the caller flushes the player's buffer to shorten that to about a second, and
     * the impression stands either way. It was delivered, and refunding it would make
     * closing an ad an attack on the advertiser.
     *
     * Fire and forget. A failed request means the viewer keeps seeing an ad they asked
     * to close, which is bad, but blocking the UI on it would be worse.
     */
    dismissBanner() {
      const sid = session?.sid || bannerSid;
      banner = null;
      bannerWindow = null;
      if (!sid) return Promise.resolve();
      /* ⚠️ RETURNS the request, and the caller must wait for it.
       *
       * The caller reloads the playlist straight afterwards, and the playlist is only
       * clean once the server knows the banner was closed. Fire-and-forget here is a
       * race the viewer loses about half the time: the reload arrives first, gets the
       * burned playlist back, and closing the ad appears to do nothing.
       *
       * A failure still resolves. The local hide has already happened, and the banner
       * finishing its run is a far better outcome than a rejection nobody handles. */
      return fetch(`${AD_BASE}/m/${encodeURIComponent(sid)}/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        keepalive: true,
      }).catch(() => { /* they still get the local hide */ });
    },

    /**
     * Is the banner on screen at this moment?
     *
     * Measured in CONTENT time, because that is what the banner's position is a
     * percentage of and what the stitcher burned it against. On a playback that also
     * carries a spot, player time runs ahead of content time by the length of the
     * break, so comparing raw player time would put the click target in the wrong
     * place for exactly as long as the spot lasted.
     */
    isBannerVisible(playerTime) {
      if (!bannerWindow || !Number.isFinite(playerTime)) return false;
      /* 🚨 Never while the SPOT is playing.
       *
       * A banner is burned into the CONTENT's frames. During a break the picture is
       * the ad, which carries no banner, so there is nothing on screen to label or to
       * click and its controls must not appear.
       *
       * It is not enough to rely on the window arithmetic, because contentTime() pins
       * to the break's own position for the whole break. A playback carrying a pre-roll
       * AND a banner booked early therefore reads as "banner visible" for every second
       * of the spot: the close button and click target sat on top of a different
       * advertiser's ad. */
      if (this.isInside(playerTime)) return false;

      const t = this.contentTime(playerTime);
      return t >= bannerWindow.start && t < bannerWindow.start + bannerWindow.duration;
    },
    /** True when the server said this playback is ad-free because the viewer is Pro. */
    get isPremiumViewer() { return premium; },

    async request({ owner, permlink, viewer, manifestUrl }) {
      session = null;
      window_ = null;
      skipAfter = null;
      banner = null;
      bannerWindow = null;
      bannerSid = null;
      premium = false;
      if (!owner || !permlink || !manifestUrl) return null;
      try {
        const res = await fetch(`${AD_BASE}/m/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // `lastAdAt` is the quiet period travelling with the viewer rather than
          // with an identity we refuse to keep. The server treats it as a reason to
          // withhold an ad, never as a reason to grant one.
          body: JSON.stringify({
            owner, permlink, viewer: viewer || null, manifestUrl, capId: CAP_ID,
            recentAdKeys: recentAdKeys(),
            /* Hand the banner over rather than burning it into the picture.
             *
             * Burned, closing one meant reloading the source onto a dismissed
             * playlist and seeking back to where the viewer was, because the covered
             * seconds keep the same segment urls and a refetch just returns the same
             * burned bytes. That swap could never be seamless. Drawn, closing it is
             * hiding an element. */
            bannerOverlay: true,
          }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        premium = data?.premium === true;
        // Remembered as soon as the server hands one over, not when it finishes
        // playing: a viewer who skips away mid-spot has still been shown that ad.
        rememberAdSeen(data?.ad?.adKey, data?.banner?.adKey);

        // Kept whether or not there is also a spot: a playback can carry a banner
        // alone, and then the banner's manifest is the one to load.
        if (data?.banner?.manifestUrl) {
          bannerSid = (data.banner.manifestUrl.match(/\/m\/([0-9a-f]{32})\.m3u8/) || [])[1] || null;
          banner = {
            positionPercent: data.banner.positionPercent,
            durationSeconds: data.banner.durationSeconds,
            advertiser: data.banner.advertiser || null,
            brand: data.banner.brand || null,
            // The creative to DRAW. Null would mean the server burned it instead,
            // which is still a shape this code understands.
            overlay: data.banner.overlay || null,
            // Where the banner goes, in frame percentages. Never assumed here.
            placement: data.banner.placement || null,
            manifestUrl: data.banner.manifestUrl,
          };
        }

        if (!data || !data.ad || !data.ad.manifestUrl) {
          // No spot, but a banner still needs its manifest loaded and its window
          // resolved — so report the banner as the thing to play.
          return banner ? { bannerOnly: true, manifestUrl: banner.manifestUrl } : null;
        }
        const sid = (data.ad.manifestUrl.match(/\/m\/([0-9a-f]{32})\.m3u8/) || [])[1];
        if (!sid) return null;
        session = {
          sid,
          manifestUrl: data.ad.manifestUrl,
          position: data.ad.position,
          durationSeconds: data.ad.durationSeconds,
          label: data.ad.label || 'Sponsored',
          advertiser: data.ad.advertiser || null,
          // Who the ad is from, for the overlay. Absent fields are fine: the
          // overlay renders what is there and omits what is not.
          brand: data.ad.brand || null,
        };
        return session;
      } catch {
        return null;
      }
    },

    /** Learn where the break actually landed. Safe to call repeatedly. */
    async resolve() {
      // A banner-only playback has no session sid of its own here, so the id comes
      // from whichever placement produced the manifest.
      const sid = session?.sid || bannerSid;
      if (!sid) return window_;
      if (window_ && (!banner || bannerWindow)) return window_;
      for (let i = 0; i < RESOLVE_TRIES; i += 1) {
        try {
          const res = await fetch(`${AD_BASE}/m/${sid}/i`);
          if (res.ok) {
            const d = await res.json();
            if (banner && !bannerWindow
              && typeof d.bannerStartAt === 'number' && d.bannerDurationSeconds) {
              bannerWindow = { start: d.bannerStartAt, duration: d.bannerDurationSeconds };
              if (typeof d.bannerCloseAfterSeconds === 'number') bannerCloseAfter = d.bannerCloseAfterSeconds;
            }
            if (session && !window_
              && typeof d.adStartAt === 'number' && d.adDurationSeconds) {
              window_ = { start: d.adStartAt, duration: d.adDurationSeconds };
              /* Whether this spot may be skipped, and after how long.
               *
               * Read HERE, in the same breath as the window, because they arrive
               * together and a skip threshold without a window is unusable: canSkip
               * needs both to say anything. The SERVER decides — a page that worked it
               * out itself could offer a skip on a spot the server considers
               * unskippable, and nothing would say which was right. */
              skipAfter = typeof d.skipAfterSeconds === 'number' ? d.skipAfterSeconds : null;
            }
            // Done once everything present has been located.
            const spotDone = !session || !!window_;
            const bannerDone = !banner || !!bannerWindow;
            if (spotDone && bannerDone) return window_;
          }
        } catch { /* keep trying */ }
        await sleep(RESOLVE_DELAY_MS);
      }
      return null;
    },

    /**
     * Seconds until the break starts, or null when that is not a useful question
     * (no spot, not resolved yet, or the playhead is already past the cut).
     *
     * Drives the "ad in 3… 2… 1" hint. A break that arrives unannounced is the part
     * of mid-roll advertising people hate most; a few seconds of warning costs the
     * advertiser nothing and is the difference between an interruption and a beat.
     */
    secondsUntil(playerTime) {
      if (!window_ || !Number.isFinite(playerTime)) return null;
      const left = window_.start - playerTime;
      return left > 0 ? left : null;
    },

    /**
     * Seconds until the content resumes, or null when not inside the break.
     *
     * Derived from the SAME window the disclosure and the watch tracker use, so the
     * number on screen can never disagree with when the video actually comes back.
     */
    secondsRemaining(playerTime) {
      if (!window_ || !Number.isFinite(playerTime)) return null;
      const { start, duration } = window_;
      if (playerTime < start || playerTime >= start + duration) return null;
      return Math.max(0, start + duration - playerTime);
    },

    /**
     * May the viewer skip this spot yet?
     *
     * True only INSIDE the break, only once the server's threshold has actually
     * elapsed, and only when the server offered a skip at all. Everything is measured
     * off the same window as the disclosure and the countdown, so a Skip button can
     * never appear over a spot that is not running.
     */
    canSkip(playerTime) {
      if (skipAfter == null || !window_ || !Number.isFinite(playerTime)) return false;
      const elapsed = playerTime - window_.start;
      return elapsed >= skipAfter && elapsed < window_.duration;
    },

    /**
     * Where the content resumes, for a player that is skipping the break.
     *
     * A hair PAST the end. Landing exactly on the boundary can leave the player one
     * frame inside the spot, which puts the disclosure back on screen for an instant
     * and reads as the skip having failed.
     */
    /**
     * Seconds until skipping is allowed, or null when it already is (or never will be).
     *
     * Null means two different things on purpose, and the caller wants them collapsed:
     * a spot with no skip offered shows no control at all, and one past its threshold
     * shows a pressable button. `skipOffered` separates them for the one caller that
     * needs to know which.
     */
    secondsUntilSkip(playerTime) {
      if (skipAfter == null || !window_ || !Number.isFinite(playerTime)) return null;
      const left = (window_.start + skipAfter) - playerTime;
      return left > 0 ? left : null;
    },

    /**
     * The viewer pressed Skip. Tell the server, which counts it as watched.
     *
     * The button only appears after the threshold, so a press means they sat through
     * the part we ask for and then chose to move on. Billing that is the honest
     * reading, and it also means a skip costs us nothing, so it can stay generous
     * rather than becoming something we are tempted to make harder.
     *
     * Fire and forget: a lost request costs the advertiser an impression they earned,
     * which is a smaller harm than delaying the skip the viewer just asked for.
     */
    recordSkip() {
      // Pressing Skip spends the spot as surely as watching it out does. Without this
      // the timeline would offer it back the moment somebody scrubbed over it.
      spotConsumed = true;
      const sid = session?.sid;
      if (!sid) return;
      fetch(`${AD_BASE}/m/${encodeURIComponent(sid)}/skipped`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        keepalive: true,
      }).catch(() => { /* the viewer still skips */ });
    },

    /**
     * May the banner be closed yet?
     *
     * Not from its first frame. An ad dismissible instantly is an ad nobody reads, and
     * the advertiser bought seconds on screen rather than a button. The threshold comes
     * from the server so this page and the embed player cannot disagree about a number
     * that is really one decision.
     */
    bannerClosable(playerTime) {
      if (!bannerWindow || !Number.isFinite(playerTime)) return false;
      return (this.contentTime(playerTime) - bannerWindow.start) >= bannerCloseAfter;
    },

    /** Does this spot offer a skip at all? Decided by the server, not here. */
    get skipOffered() { return skipAfter != null; },

    endOfBreak() {
      return window_ ? window_.start + window_.duration + 0.05 : null;
    },

    isInside(playerTime) {
      if (!window_ || !Number.isFinite(playerTime)) return false;
      // 🚨 A spot that has been RETIRED is never inside anything again. See retireSpot:
      // this is the one place every piece of spot chrome funnels through, so silencing
      // it here silences the disclosure, the Skip and the resume countdown together
      // rather than leaving each to remember on its own.
      if (spotRetired) return false;
      return playerTime >= window_.start && playerTime < window_.start + window_.duration;
    },

    /**
     * This spot is done with, whatever the clock says.
     *
     * Closing a banner reloads the source, and a reload walks the playhead through zero
     * before the new manifest lands. A spot booked at the START of the video is inside
     * its own window at zero, so its disclosure and Skip came back up over a video that
     * was merely reloading — controls for an ad that had already finished.
     *
     * Timing guards could not fix that, and two attempts proved it: the moment is not
     * knowable from a clock that is itself being reset. So the spot is retired outright
     * once it has been passed, and no arithmetic can bring it back.
     */
    retireSpot() { spotRetired = true; },

    /** Has the spot been passed and retired? */
    get spotRetired() { return spotRetired; },

    /**
     * Where the spot sits on the player's clock, ignoring whether it is retired.
     *
     * isInside() answers "should spot chrome be on screen", which a retired spot
     * silences. This answers "are these seconds the ad", which stays true either way
     * and is what the seek guard has to ask.
     */
    spansSpot(playerTime) {
      if (!window_ || !Number.isFinite(playerTime)) return false;
      return playerTime >= window_.start && playerTime < window_.start + window_.duration;
    },

    /**
     * Told the clock on every tick, so a spot that has run can be marked spent.
     *
     * Entering it is not enough on its own and neither is passing its end: a viewer
     * who drags the handle from before the spot to after it has done both without
     * seeing a frame of it. Both, in order, is what "watched" means here.
     */
    noteTime(playerTime) {
      if (!window_ || !Number.isFinite(playerTime)) return;
      if (this.spansSpot(playerTime)) { spotEntered = true; return; }
      if (spotEntered && playerTime >= window_.start + window_.duration) spotConsumed = true;
    },

    /** Has the spot been watched, or skipped, and become a hole in the timeline? */
    get spotConsumed() { return spotConsumed; },

    /**
     * Where to put the playhead when it lands in a spot that has already run.
     *
     * Null unless the spot is spent and the playhead is in it. Direction matters:
     * arriving from AFTER the spot means scrubbing back, and the viewer wants the
     * content before the ad rather than the ad again, so they are put in front of it.
     * Every other arrival is travelling forward and goes to the far side. Playing
     * forward off that landing point re-enters the spot and jumps it again, which is
     * the correct reading of a hole: the ad occupies no content time at all.
     */
    skipTargetFor(playerTime, cameFrom) {
      if (!spotConsumed || !this.spansSpot(playerTime)) return null;
      const end = window_.start + window_.duration;
      if (Number.isFinite(cameFrom) && cameFrom >= end) {
        const before = window_.start - 0.05;
        /* A PRE-ROLL has nothing in front of it. Landing at 0 would be landing inside
         * the ad again, and the guard would immediately throw the playhead forward —
         * two seeks to reach the one place that was ever available. */
        return before > 0 ? before : end + 0.05;
      }
      return end + 0.05;
    },

    /**
     * Player time → content time. Inside the break the content has not advanced at
     * all, so it pins to the cut point; after it, the ad's length comes off. This
     * is what keeps ad seconds out of `view-durations`.
     */
    contentTime(playerTime) {
      if (!window_ || !Number.isFinite(playerTime)) return playerTime;
      const { start, duration } = window_;
      if (playerTime < start) return playerTime;
      if (playerTime < start + duration) return start;
      return playerTime - duration;
    },

    /**
     * Content time → the player's clock. The inverse of contentTime().
     *
     * What a timeline drawn in content seconds needs in order to seek: the viewer
     * points at a second of the creator's video, and this says where that second
     * actually lives in the stitched file.
     *
     * `<=` at the cut point on purpose. contentTime() collapses the WHOLE spot onto
     * `start`, so that one content second is where the playhead reads from while the
     * ad runs. Mapping it back to the far side would mean anything that round-trips
     * the displayed position — a control reading the clock and seeking to it — would
     * jump the viewer past an ad they had not watched.
     */
    playerTimeFor(contentSeconds) {
      if (!window_ || !Number.isFinite(contentSeconds)) return contentSeconds;
      const { start, duration } = window_;
      return contentSeconds <= start ? contentSeconds : contentSeconds + duration;
    },

    /**
     * How long the creator's video is, with the spot taken back out.
     *
     * The stitched file is longer than the video by exactly the ad, and a timeline
     * measured against the file counts seconds the creator never made.
     */
    contentDuration(mediaDuration) {
      if (!window_ || !Number.isFinite(mediaDuration)) return mediaDuration;
      return Math.max(0, mediaDuration - window_.duration);
    },

    reset() { session = null; window_ = null; skipAfter = null; spotRetired = false; spotEntered = false; spotConsumed = false; banner = null; bannerWindow = null; bannerSid = null; premium = false; },
  };
}
