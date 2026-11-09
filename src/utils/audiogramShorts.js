// Audiograms posted as Shorts together with an audio post (any mode: a
// standalone post, a snap or an album track; each Short links to its track).
//
// The audio editor makes audiograms (short vertical videos of pieces of the
// episode: moving waveform, title, cover, 3Speak branding) and marks some
// "Post together with the audio". They travel with the edited audio
// (EditorModal -> the audio upload) and, once the audio post is on Hive, each
// goes out as a Short of the same person: uploaded like any short, a reply
// under the current @peak.snaps container, the same metadata and beneficiaries
// as a short from the uploader, plus where the full episode is (in the text
// and in the metadata).
import { uploadVideoAsset } from './uploadVideoAsset';
import { uploadThumbnail } from './uploadThumbnail';
import { captureFrameAt, dataUrlToBlob } from './videoThumbnails';
import { resolveSnapsContainer } from './snapsContainer';
import { enforceLockedBeneficiaries } from './beneficiaries';
import { oaEnvelope, threespeakVideo, OA_MICROPOST } from './openAttribute';
import { withShortHeading } from './shortTitle';
import { EMBED_API_KEY, EMBED_API_URL } from './config';

export const MAX_AUDIOGRAM_SHORTS = 5;
export const MAX_SHORT_SECONDS = 120;
export const SHORTS_TAG = 'hive-181335';
const MAX_DESCRIPTION = 5000; // written in our post editor (in the audio editor or the upload)

/**
 * What the editor sent, checked: at most 5, each an MP4 audiogram on the
 * editor backend (https, or http on this machine for development), vertical,
 * at most 2 minutes. Bad entries are dropped.
 */
export function sanitizeAudiograms(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const a of list) {
    if (!a || typeof a.url !== 'string' || a.url.length > 2000) continue;
    let u;
    try { u = new URL(a.url); } catch { continue; }
    const local = u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
    if (u.protocol !== 'https:' && !local) continue;
    if (!/\/rendered\/audiogram-[A-Za-z0-9-]+\.mp4$/.test(u.pathname)) continue;
    const duration = Number(a.duration);
    if (!(duration > 0 && duration <= MAX_SHORT_SECONDS)) continue;
    if (Number(a.width) > Number(a.height)) continue;
    out.push({
      url: u.href,
      description: typeof a.description === 'string' ? a.description.trim().slice(0, MAX_DESCRIPTION) : '',
      title: typeof a.title === 'string' ? a.title.trim().slice(0, 120) : '',
      duration: Math.round(duration * 10) / 10,
    });
    if (out.length >= MAX_AUDIOGRAM_SHORTS) break;
  }
  return out;
}

/** The person's playlist covers for the editor's picture choice: [{ title, url }], https only, no repeats. */
export function playlistCoversOf(playlists) {
  const seen = new Set();
  const out = [];
  for (const p of Array.isArray(playlists) ? playlists : []) {
    const url = p?.thumbnail || p?.metadata?.album?.thumbnail;
    if (typeof url !== 'string' || !/^https:\/\//.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: String(p.title || p.name || '').slice(0, 120), url });
  }
  return out.slice(0, 50);
}

/** The episode's page on 3speak.tv (always the main site, like the shorts' own link). */
export const audioPageUrl = ({ author, permlink }) => `https://3speak.tv/audio/${author}/${permlink}`;

/** The audiogram's MP4 as a File (for the upload and the thumbnail editor). */
export async function fetchAudiogramFile(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The audiogram could not be fetched (${res.status})`);
  return new File([await res.blob()], 'audiogram.mp4', { type: 'video/mp4' });
}

/** The Short's title: its own (set in the upload), else the episode's. */
export const shortTitleOf = (a, episode) => (a?.title || '').trim() || episode.title || '';

/**
 * The Short's text: the video, the creator's words (or a plain line), the link
 * to the full episode, and the usual "Watch on 3speak.tv" line. Its title
 * (`title`, else the episode's) goes on top (utils/shortTitle.js).
 */
export function audiogramShortBody({ embedUrl, description, episode, author, permlink, title = '' }) {
  const words = description?.trim() || `A piece of my episode "${episode.title}".`;
  let body = `${embedUrl}\n\n${words}\n\n🎧 Full episode: [${episode.title}](${audioPageUrl(episode)})`;
  body = withShortHeading(title || episode.title, body);
  return `${body}\n\n---\n▶ [Watch on 3speak.tv](https://3speak.tv/shorts?v=${author}/${permlink})`;
}

/** The Short's json_metadata: a regular short's, plus the episode it is from. */
export function audiogramShortMetadata({ embedUrl, owner, assetPermlink, thumbnailUrl, duration, episode, tags = [], title = '' }) {
  const userTags = (tags || []).filter(t => typeof t === 'string' && t && t !== SHORTS_TAG).slice(0, 9);
  return {
    app: '3speak/embed',
    format: 'markdown',
    tags: [SHORTS_TAG, ...userTags],
    ...(thumbnailUrl ? { image: [thumbnailUrl] } : {}),
    links: [embedUrl, audioPageUrl(episode)],
    video: {
      platform: '3speak',
      url: embedUrl,
      reusable: false,
      ...(thumbnailUrl ? { thumbnail: thumbnailUrl } : {}),
      info: {
        platform: '3speak',
        author: owner,
        permlink: assetPermlink,
        title: title || episode.title || '',
        duration: Number(duration) || 0,
        ...(thumbnailUrl ? { sourceMap: [{ url: thumbnailUrl, type: 'thumbnail' }] } : {}),
      },
    },
    ...oaEnvelope(OA_MICROPOST),
    ...threespeakVideo({ surface: 'shorts', orientation: 'portrait', duration }),
    // Where it is from: the audio post (the audiogram is a teaser of it)
    '3speak': { audiogram: { author: episode.author, permlink: episode.permlink } },
  };
}

/** A Hive permlink for the Short: from the title, unique enough per second. */
export function audiogramPermlink(title, i = 0, now = Date.now()) {
  const slug = String(title || 'audiogram').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 20).replace(/-+$/, '') || 'audiogram';
  return `${slug}-teaser-${(now % 100000) + i}`;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Posts the audiograms as Shorts of `user`, one after another, after the
 * episode (`episode`: { author, permlink, title }) is on Hive. Never throws:
 * returns [{ ok, permlink?, error? }] per audiogram, so a failed Short never
 * takes the published episode down with it.
 * `broadcast(ops)` signs like the audio post did; `deps` are swapped in tests.
 */
export async function publishAudiogramShorts({ audiograms, user, isPremium, episode, tags, broadcast, onProgress, deps = {} }) {
  const d = {
    fetchFile: fetchAudiogramFile,
    upload: (file, opts) => uploadVideoAsset(file, opts),
    thumbnail: async (file, owner) => {
      const blob = dataUrlToBlob(await captureFrameAt(file, 1.5));
      return uploadThumbnail(new File([blob], 'audiogram.jpg', { type: 'image/jpeg' }), owner, { preferStatic: true });
    },
    container: () => resolveSnapsContainer(),
    link: async (base, permlink, body) => fetch(`${base}/video/${permlink}/${body.thumbnail_url ? 'thumbnail' : 'hive'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(EMBED_API_KEY ? { 'X-API-Key': EMBED_API_KEY } : {}) },
      body: JSON.stringify(body),
    }),
    pause: sleep,
    ...deps,
  };
  const results = [];
  for (let i = 0; i < audiograms.length; i++) {
    const a = audiograms[i];
    // 'upload', 'post', then 'done' with { ok, permlink | error }: the upload window shows each Short's state
    const step = (what, extra = {}) => onProgress?.({ index: i, count: audiograms.length, step: what, ...extra });
    try {
      step('upload');
      const file = await d.fetchFile(a.url);
      const asset = await d.upload(file, { owner: user, duration: a.duration, short: true });
      // the thumbnail made in the upload, else a frame 1.5 s in
      let thumbnailUrl = /^https:\/\//.test(a.thumbnailUrl || '') ? a.thumbnailUrl : null;
      if (!thumbnailUrl) {
        try { thumbnailUrl = await d.thumbnail(file, user); } catch { /* a short without its own thumbnail still plays */ }
      }
      step('post');
      const container = await d.container();
      const title = shortTitleOf(a, episode);
      const permlink = audiogramPermlink(title, i);
      const body = audiogramShortBody({ embedUrl: asset.embedUrl, description: a.description, episode, author: user, permlink, title });
      const meta = audiogramShortMetadata({ embedUrl: asset.embedUrl, owner: asset.owner, assetPermlink: asset.permlink, thumbnailUrl, duration: a.duration, episode, tags, title });
      const beneMap = new Map();
      enforceLockedBeneficiaries(beneMap, { isPremium, username: user, includeEncoder: true });
      const beneficiaries = [...beneMap.entries()].map(([account, weight]) => ({ account, weight })).sort((x, y) => x.account.localeCompare(y.account));
      const ops = [
        ['comment', { parent_author: container.author, parent_permlink: container.permlink, author: user, permlink, title: '', body, json_metadata: JSON.stringify(meta) }],
        ['comment_options', {
          author: user, permlink, max_accepted_payout: '1000000.000 HBD', percent_hbd: 10000, allow_votes: true, allow_curation_rewards: true,
          extensions: beneficiaries.length ? [[0, { beneficiaries }]] : [],
        }],
      ];
      const res = await broadcast(ops);
      if (res && res.success === false) throw new Error(res.error || 'The Short could not be posted');
      // Tie the video to its post, and its thumbnail (best effort, like the studio)
      const base = (asset.base || EMBED_API_URL || '').replace(/\/+$/, '');
      if (base && asset.permlink) {
        await d.link(base, asset.permlink, { hive_author: user, hive_permlink: permlink, hive_title: title, hive_body: body, hive_tags: ['3speak', ...(tags || [])] }).catch(() => {});
        if (thumbnailUrl) await d.link(base, asset.permlink, { thumbnail_url: thumbnailUrl }).catch(() => {});
      }
      results.push({ ok: true, permlink });
      step('done', { ok: true, permlink });
    } catch (err) {
      const error = err?.message || String(err);
      results.push({ ok: false, error });
      step('done', { ok: false, error });
    }
    // Replies one after another, not in the same second (like the album tracks)
    if (i < audiograms.length - 1) await d.pause(3500);
  }
  return results;
}
