/**
 * The audio player's half of the spoken ticker (checker routes/adServe.js, surface
 * 'audio'): a ticker campaign's message, rendered to speech on the checker, played
 * at its booked position while the track waits.
 *
 * Which tracks carry one is the checker's call (AD_AUDIO_TICKER_ALLOWED_OWNERS); the
 * player always asks for 3Speak audio and plays whatever comes back.
 *
 * Every failure path returns "no ad": a track must never fail to play because the ad
 * system had a bad day.
 */
import { CHECKER_URL } from '../utils/config';
import { adCapId, recentAdKeys } from './adBreak';

/** Ask for a spot on this track. Null for "none", or for anything going wrong. */
export async function requestAudioAd({ owner, permlink, viewer }) {
  if (!owner || !permlink) return null;
  try {
    const res = await fetch(`${CHECKER_URL}/m/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        surface: 'audio',
        // Only a player that can play one is handed one.
        audioSpot: true,
        owner,
        permlink,
        viewer: viewer || null,
        capId: adCapId(),
        recentAdKeys: recentAdKeys(),
      }),
    });
    if (!res.ok) return null;
    return normalizeAudioAd((await res.json())?.audioAd);
  } catch {
    return null;
  }
}

/** The server's answer, checked and in the shape the player uses. */
export function normalizeAudioAd(a) {
  if (!a || typeof a.audioUrl !== 'string' || !/^https:\/\//i.test(a.audioUrl)) return null;
  const durationSeconds = Number(a.durationSeconds);
  // An audio spot (the advertiser's own clip) has no text: message is ''.
  if (!(durationSeconds > 0) || typeof a.message !== 'string') return null;
  return {
    audioUrl: a.audioUrl,
    durationSeconds,
    positionPercent: Math.min(100, Math.max(0, Number(a.positionPercent) || 0)),
    message: a.message,
    style: a.style === 'hold' ? 'hold' : 'crawl',
    account: a.account || null,
    productName: a.productName || null,
    clickUrl: a.clickUrl || null,
    shownUrl: a.shownUrl || null,
    adKey: a.adKey || null,
    capMinutes: Number(a.capMinutes) || null,
    label: a.label || 'Ad',
  };
}

/** The spot played to its end. Once per spot; the server refuses an early claim. */
export function reportAudioAdHeard(shownUrl) {
  if (!shownUrl) return;
  try {
    fetch(shownUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      keepalive: true,
    }).catch(() => { /* an unreported impression is the advertiser's loss, not a crash */ });
  } catch { /* never the reason a track stops */ }
}
