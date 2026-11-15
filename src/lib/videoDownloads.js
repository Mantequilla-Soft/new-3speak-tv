/**
 * Videos saved in this browser for watching without a connection.
 *
 * A video is HLS, so a download is the segments of one rendition (the best at or
 * under 480p, lib/hlsRenditions.js), each kept as its own file in the same
 * IndexedDB store as the podcast downloads (lib/podcastDownloads.js
 * downloadParts), under `<id>#<n>`. The meta row lists them with their
 * durations, so the offline player (components/Downloads/OfflineVideoPlayer)
 * rebuilds a playlist and hands the segments to hls.js from storage. The iframe
 * player cannot do this: it runs on another origin and cannot read this site's
 * storage.
 *
 * Like the podcast downloads it is per browser, not per account: signed out
 * works, and signing in or out keeps them. A saved video expires after
 * VIDEO_TTL_DAYS (removed when the store opens), and every download counts
 * against the one storage cap (downloadCap). Error codes as there, plus 'cap'
 * (the cap would be passed) and 'no_source' (nothing playable, or encrypted).
 */
import { fetchPlaySource } from './videoData';
import { parseMaster, parseMedia, renditionUpTo, fetchPlaylist, buildMediaPlaylist } from './hlsRenditions';
import {
  downloadParts, downloadError, cancelDownload, removeDownload, isDownloaded, useDownloads, partBlob, downloadEntry,
} from './podcastDownloads';

export const VIDEO_TTL_DAYS = 30;
const DAY_MS = 86400000;
export const MAX_HEIGHT = 480;
const PREFIX = 'dlvideo:';
// Segments fetched at once: a little parallel, without starving the page.
const PARALLEL = 3;

export const videoDownloadId = (author, permlink) => `${PREFIX}${author}/${permlink}`;
export const isVideoDownload = (m) => m?.kind === 'video' || String(m?.id || '').startsWith(PREFIX);
export const partKey = (id, n) => `${id}#${n}`;

/** Days left before a saved video goes (0 on its last day), or null. */
export function daysLeft(entry, now = Date.now()) {
  if (!Number.isFinite(entry?.expiresAt)) return null;
  return Math.max(0, Math.floor((entry.expiresAt - now) / DAY_MS));
}

/**
 * Which rendition to save, and its segments: { rendition, segments, map }.
 * `playUrl` is the player API's master playlist.
 */
export async function planDownload(playUrl, { signal, fetchImpl } = {}) {
  const masterText = await fetchPlaylist(playUrl, { signal, fetchImpl });
  const renditions = parseMaster(masterText, playUrl);
  const rendition = renditionUpTo(renditions, MAX_HEIGHT) || { url: playUrl, bandwidth: 0, height: 0 };
  const mediaText = rendition.url === playUrl ? masterText : await fetchPlaylist(rendition.url, { signal, fetchImpl });
  const media = parseMedia(mediaText, rendition.url);
  if (!media.segments.length || media.encrypted) throw downloadError('no_source');
  return { rendition, segments: media.segments, map: media.map };
}

/** A guess at the bytes, before anything is fetched: bandwidth x duration. */
export function estimateBytes(plan) {
  const seconds = plan.segments.reduce((n, s) => n + (s.duration || 0), 0);
  return Math.round(((plan.rendition.bandwidth || 0) / 8) * seconds);
}

async function fetchSegment(url, signal, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, { mode: 'cors', credentials: 'omit', signal });
  } catch (err) {
    if (signal.aborted || err?.name === 'AbortError') throw downloadError('cancelled');
    throw downloadError('failed');
  }
  if (!res.ok) throw downloadError('failed', res.status);
  return res.blob();
}

/**
 * Save a video. `video` = { author, permlink, title?, thumbnail?, duration? }.
 * Resolves when it is saved; a second call while it runs joins the first.
 */
export function downloadVideo(video, { fetchSource = fetchPlaySource, fetchImpl = (...a) => fetch(...a), now = () => Date.now() } = {}) {
  const author = String(video?.author || '');
  const permlink = String(video?.permlink || '');
  if (!author || !permlink) return Promise.reject(downloadError('no_source'));
  const id = videoDownloadId(author, permlink);
  return downloadParts(id, async ({ signal, putPart, report, room }) => {
    const source = await fetchSource(author, permlink);
    if (!source?.play_url || source.placeholder) throw downloadError('no_source');
    const plan = await planDownload(source.play_url, { signal, fetchImpl });
    if (estimateBytes(plan) > room()) throw downloadError('cap');
    const files = [];
    if (plan.map) files.push({ url: plan.map, init: true });
    plan.segments.forEach((s) => files.push({ url: s.url, duration: s.duration }));
    const parts = new Array(files.length);
    let bytes = 0;
    let next = 0;
    let doneCount = 0;
    // The first failure stops the others after the segment each is on, so the
    // clean-up (downloadParts) runs once nothing is still being written.
    let failure = null;
    const worker = async () => {
      while (next < files.length && !failure) {
        const i = next++;
        const blob = await fetchSegment(files[i].url, signal, fetchImpl);
        bytes += blob.size;
        if (bytes > room()) throw downloadError('cap');
        const key = partKey(id, i);
        await putPart(key, blob);
        parts[i] = files[i].init ? { key, init: true } : { key, duration: files[i].duration };
        doneCount += 1;
        report(doneCount / files.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, files.length) }, () => worker().catch((err) => { failure = failure || err; })));
    if (failure) throw failure;
    // The cover too, so the list shows it offline (best effort: a host without CORS has none).
    const thumbnail = video.thumbnail || source.thumbnail_url || null;
    let thumbKey = null;
    if (thumbnail) {
      try {
        const blob = await fetchSegment(thumbnail, signal, fetchImpl);
        if (/^image\//.test(blob.type || '')) {
          thumbKey = `${id}#thumb`;
          await putPart(thumbKey, blob);
          bytes += blob.size;
        }
      } catch (err) {
        if (err?.code === 'cancelled' || err?.code === 'storage') throw err;
      }
    }
    const at = now();
    return {
      kind: 'video',
      track: {
        author,
        permlink,
        title: video.title || '',
        thumbnail_url: thumbnail,
        duration: Number(video.duration) || Number(source.duration) || plan.segments.reduce((n, s) => n + (s.duration || 0), 0),
        height: plan.rendition.height || null,
      },
      bytes,
      parts,
      ...(thumbKey ? { thumbKey } : {}),
      expiresAt: at + VIDEO_TTL_DAYS * DAY_MS,
    };
  });
}

export const cancelVideoDownload = (author, permlink) => cancelDownload(videoDownloadId(author, permlink));
export const removeVideoDownload = (author, permlink) => removeDownload(videoDownloadId(author, permlink));
export const isVideoDownloaded = (author, permlink) => isDownloaded(videoDownloadId(author, permlink));

// ─── Playing a saved video ───────────────────────────────────────────────────

// A made-up address the offline loader answers for; nothing is ever fetched from it.
export const OFFLINE_BASE = 'https://offline.3speak.invalid/';

/** The local playlist of a saved video (segments named seg-<n>.ts under OFFLINE_BASE). */
export function offlinePlaylist(entry) {
  const parts = Array.isArray(entry?.parts) ? entry.parts : [];
  const init = parts.findIndex((p) => p?.init);
  const segs = parts.map((p, i) => ({ ...p, i })).filter((p) => !p.init);
  return buildMediaPlaylist(
    segs.map((p) => ({ duration: p.duration })),
    (n) => `${OFFLINE_BASE}seg-${segs[n].i}.ts`,
    { map: init >= 0 ? `${OFFLINE_BASE}seg-${init}.mp4` : null },
  );
}

export const OFFLINE_PLAYLIST_URL = `${OFFLINE_BASE}index.m3u8`;

/**
 * An hls.js loader class that answers from storage for one saved entry: the
 * playlist from offlinePlaylist(), segments from partBlob(). `LoadStats` comes
 * from hls.js (passed in, so this module does not import hls.js).
 */
export function offlineLoaderClass(entry, LoadStats, readPart = partBlob) {
  const playlist = offlinePlaylist(entry);
  return class OfflineLoader {
    constructor() {
      this.stats = new LoadStats();
      this.aborted = false;
    }

    load(context, _config, callbacks) {
      const { stats } = this;
      stats.loading.start = performance.now();
      const finish = (data) => {
        if (this.aborted) return;
        const size = typeof data === 'string' ? data.length : data.byteLength;
        stats.loading.first = performance.now();
        stats.loading.end = stats.loading.first;
        stats.loaded = size;
        stats.total = size;
        callbacks.onSuccess({ url: context.url, data }, stats, context, null);
      };
      const fail = (text) => {
        if (!this.aborted) callbacks.onError({ code: 404, text }, context, null, stats);
      };
      const url = String(context.url || '');
      if (url === OFFLINE_PLAYLIST_URL) { Promise.resolve().then(() => finish(playlist)); return; }
      const m = /seg-(\d+)\.(ts|mp4)$/.exec(url);
      const part = m ? entry.parts?.[Number(m[1])] : null;
      if (!url.startsWith(OFFLINE_BASE) || !part) { Promise.resolve().then(() => fail('not saved')); return; }
      readPart(part.key)
        .then((blob) => (blob ? blob.arrayBuffer() : null))
        .then((buf) => (buf ? finish(buf) : fail('not saved')))
        .catch(() => fail('not readable'));
    }

    abort() { this.aborted = true; this.stats.aborted = true; }

    destroy() { this.aborted = true; }
  };
}

/** The saved entry for a video, or null. */
export const videoEntry = (author, permlink) => downloadEntry(videoDownloadId(author, permlink));

/**
 * React hook for one video: { saved, progress (0..1 | null), entry }.
 */
export function useVideoDownload(author, permlink) {
  const { items, progress } = useDownloads();
  const id = videoDownloadId(author, permlink);
  const entry = items.find((m) => m.id === id) || null;
  return { saved: !!entry, progress: id in progress ? progress[id] : null, entry, id };
}
