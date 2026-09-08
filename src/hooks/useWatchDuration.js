import { useEffect, useRef } from 'react';
import { getPlayerUrl } from '../utils/playerUrl';
import { useAppStore } from '../lib/store';
import { resolveVideoMeta } from '../lib/videoMetaCache';
import { viewerRewardsName } from '../utils/viewerRewards';

/**
 * Drives the snapievideoplayer watch-duration heartbeat against the player
 * backend (getPlayerUrl()) from an SDK usePlayer() instance.
 *
 *   POST /api/watch/start → opens a server-side session (HMAC token bound to
 *     sid.owner.permlink.ip), returns a beat interval.
 *   POST /api/watch/beat  → sent (throttled) while the video is really playing
 *     AND this tab is the one in front, plus a final beat on pause / tab-hide /
 *     unmount. The server credits only the wall-clock gap it measures between
 *     beats, so watch time can't be forged with a single request.
 *
 * Tab visibility is part of "really playing" on purpose: a short video left
 * running in a background tab used to accrue watch time exactly like one
 * someone was watching. The hide itself still flushes a beat, so the seconds up
 * to that moment count; the beats simply stop until the tab comes back. The
 * server caps any single beat at MAX_BEAT_CREDIT_MS (8s), so returning to a
 * long-hidden tab credits at most that much of the time away, not the whole gap.
 *
 * LONG-FORM IS THE EXCEPTION. Past BACKGROUND_OK_SECONDS the background tab is
 * the point: podcasts, interviews, DJ sets and long talks get listened to with
 * the tab parked, and that is real watch time, not a video nobody is with. So
 * anything that long keeps beating while hidden. Below the threshold, a
 * forgotten tab is far more likely than deliberate listening.
 *
 * Records watched seconds + % of duration (with the viewer IP + video) into the
 * backend's `view-durations` collection. This is the "non-polluting" path — it
 * NEVER increments the view counter (mirrors the /play route), so preview
 * playback doesn't inflate production view counts.
 *
 * @param {object}  args
 * @param {object}  args.api          ThreeSpeakApi instance (to resolve the embed asset owner/permlink)
 * @param {string}  args.author       URL author
 * @param {string}  args.permlink     URL permlink
 * @param {object}  args.playerState  usePlayer() state ({ paused, currentTime, duration })
 * @param {function} [args.mapPosition] player time → content time, for stitched ads
 * @param {boolean} args.enabled      gate (e.g. false for scheduled/unpublished posts)
 */
// A video at least this long still counts while the tab is in the background —
// people listen to long-form with the tab elsewhere on purpose.
const BACKGROUND_OK_SECONDS = 20 * 60;

export default function useWatchDuration({ api, author, permlink, playerState, enabled = true, mapPosition = null, premium = false }) {
  const sessionRef = useRef({ sid: null, token: null, beatMs: 5000, lastBeatAt: 0 });
  const startingRef = useRef(false);
  const key = author && author !== 'unknown' && permlink ? `${author}/${permlink}` : null;

  // Whether this tab is the one in front. Kept in a ref so the beat effect reads
  // it without re-subscribing on every visibility flip.
  const visibleRef = useRef(typeof document === 'undefined' || document.visibilityState !== 'hidden');

  // Set once the session opens, from the same duration the session was opened
  // with. Unknown duration counts as short, so the gate stays the safe default.
  const countsInBackgroundRef = useRef(false);

  // Latest playback position + rate, kept in refs so the stable beat() reads the
  // current values (position → timeline-coverage/heatmap; rate → avg-speed stat).
  //
  // `mapPosition` exists because of server-side ad insertion: with a spot stitched
  // in, the player's currentTime runs ahead of the video by the ad's length. Passing
  // that through would credit every ad second as watch time on the creator's video
  // — and the retention data the ad forecast is built from would be poisoned by the
  // ads it sells. Defaults to the identity, so callers with no ads are unaffected.
  const posRef = useRef(0);
  const rawPos = Number(playerState?.currentTime) || 0;
  posRef.current = typeof mapPosition === 'function' ? (Number(mapPosition(rawPos)) || 0) : rawPos;
  const rateRef = useRef(1);
  rateRef.current = Number(playerState?.playbackRate) || 1;

  // Reset session state whenever the video changes.
  useEffect(() => {
    sessionRef.current = { sid: null, token: null, beatMs: 5000, lastBeatAt: 0 };
    startingRef.current = false;
    countsInBackgroundRef.current = false;
  }, [key]);

  const beat = () => {
    const s = sessionRef.current;
    if (!s.sid) return;
    s.lastBeatAt = Date.now(); // throttle before the async call so we don't double-fire
    // fetch(keepalive) — not sendBeacon: the beat is CROSS-origin to PLAYER_URL
    // with a JSON body (not CORS-safelisted), which a beacon can drop. keepalive
    // survives unload and does a proper CORS request.
    try {
      fetch(`${getPlayerUrl()}/api/watch/beat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sid: s.sid, token: s.token, position: posRef.current, rate: rateRef.current }),
        keepalive: true,
      }).catch(() => {});
    } catch { /* best-effort — never disrupt playback */ }
  };

  // Open a measured session on first real play.
  useEffect(() => {
    if (!enabled || !key) return;
    if (playerState?.paused !== false) return;         // only once genuinely playing
    if (sessionRef.current.sid || startingRef.current) return;
    startingRef.current = true;

    (async () => {
      // Resolve the embed ASSET owner/permlink (the URL permlink is often the
      // Hive permlink; the backend matches the embed asset). Fall back to the
      // URL values when metadata isn't available (legacy videos).
      let owner = author;
      let vPermlink = permlink;
      // Shared session cache — the view recorder resolves the same /api/embed
      // metadata; this dedupes both into one request per video.
      const meta = await resolveVideoMeta(api, author, permlink);
      if (meta?.owner) owner = meta.owner;
      if (meta?.permlink) vPermlink = meta.permlink;

      // Prefer the STORED duration from the embed metadata we just resolved
      // over playerState.duration. Under HLS/MSE the player's own duration,
      // read at first play, can transiently report only the buffered-so-far
      // segment span instead of the full manifest total — that race is what
      // recorded 6s for a 120s video and poisoned retention/heatmap data.
      // The live reading stays as the fallback for anything the metadata
      // doesn't cover (e.g. legacy videos with no stored duration).
      const storedDuration = Number(meta?.duration);
      const duration = (Number.isFinite(storedDuration) && storedDuration > 0)
        ? storedDuration
        : (Number(playerState?.duration) || undefined);
      countsInBackgroundRef.current = Number.isFinite(duration) && duration >= BACKGROUND_OK_SECONDS;
      // A video lives in exactly one collection — try embed (also matches
      // hive_permlink) then legacy; whichever owns it opens the session.
      for (const type of ['embed', 'legacy']) {
        try {
          const res = await fetch(`${getPlayerUrl()}/api/watch/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // `premium` marks the row as ad-free so the ad inventory forecast excludes it.
              body: JSON.stringify({ owner, permlink: vPermlink, type, duration, position: posRef.current, source: '3speak', premium: !!premium, private: !!useAppStore.getState().privateMode,
                // Sent ONLY for a viewer who opted into rewards, so we do not
                // transmit a name for anyone who declined. The player re-checks the
                // opt-in against the database before storing anything.
                viewer: viewerRewardsName() }),
          });
          if (!res.ok) continue;                       // 404 for the wrong collection → try the next
          const data = await res.json().catch(() => null);
          if (data?.sid) {
            sessionRef.current = {
              sid: data.sid,
              token: data.token,
              beatMs: (data.beatSeconds || 5) * 1000,
              lastBeatAt: Date.now(),                  // first beat one interval from now
            };
            break;
          }
          if (data && data.tracked === false) break;   // no measurable duration
        } catch { /* try the next type */ }
      }
      startingRef.current = false;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, playerState?.paused]);

  // Beat while playing — driven (throttled) by the SDK's currentTime updates,
  // which only advance while the video is genuinely playing. A hidden tab keeps
  // those updates coming (playback doesn't stop), so visibility is checked here
  // rather than inferred from the player.
  useEffect(() => {
    const s = sessionRef.current;
    if (!enabled || !s.sid || playerState?.paused) return;
    if (!visibleRef.current && !countsInBackgroundRef.current) return;
    if (Date.now() - s.lastBeatAt >= s.beatMs) beat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, playerState?.currentTime, playerState?.paused]);

  // Long-form in a hidden tab beats on a timer rather than on the SDK's updates.
  // Those updates can stop when a tab goes to the background (rAF is paused
  // there), and the whole point of the long-form exception is that this time
  // still counts. Idle while visible — the update-driven effect above owns that
  // case — and idle for anything below the threshold, which isn't counted at all.
  useEffect(() => {
    if (!enabled || playerState?.paused) return undefined;
    const id = setInterval(() => {
      const s = sessionRef.current;
      if (!s.sid || visibleRef.current || !countsInBackgroundRef.current) return;
      if (Date.now() - s.lastBeatAt >= s.beatMs) beat();
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, playerState?.paused]);

  // Final measured beat when playback pauses.
  useEffect(() => {
    if (playerState?.paused && sessionRef.current.sid) beat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerState?.paused]);

  // Flush the tail when the tab goes away, and stop counting until it's back.
  useEffect(() => {
    const onVisibility = () => {
      const hidden = document.visibilityState === 'hidden';
      visibleRef.current = !hidden;
      // Beat on the way out only: the seconds actually watched up to this moment
      // still count. Coming back does NOT beat immediately — that would hand the
      // server a gap to credit for time nobody was watching.
      if (hidden) beat();
      // Coming back after a stretch we DIDN'T count: re-anchor so the next beat
      // has no gap to credit. Long-form kept beating throughout, so leave its
      // throttle alone.
      else if (!countsInBackgroundRef.current) sessionRef.current.lastBeatAt = Date.now();
    };
    const onPageHide = () => { visibleRef.current = false; beat(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      beat();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
