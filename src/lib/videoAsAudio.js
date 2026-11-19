/**
 * "Play as audio": a video in the global audio player (GlobalAudioPlayer), with
 * its queue, lock-screen controls, sleep timer and speed. Free for everyone.
 *
 * Videos have no audio-only rendition (lib/hlsRenditions.js), so the player
 * streams the LOWEST bandwidth rendition through hls.js into its <audio> element:
 * the picture is downloaded too, at the smallest size there is. hls.js feeds the
 * element through Media Source Extensions, so Web Audio can read it and voice
 * boost / skip silence work. A browser without MSE plays the HLS natively
 * (old iPhones), where Web Audio cannot read it: the effects are hidden then.
 *
 * The track keeps the Hive post as `post_permlink`, so comments, votes, tips,
 * Hype and Save in the player act on the video's post. It has no `permlink`
 * (that names an embed-audio upload): no listening rewards, no audio ads.
 */
import { fetchPlaySource } from './videoData';
import { parseMaster, lowestRendition, fetchPlaylist } from './hlsRenditions';

export const VIDEO_TRACK_PREFIX = 'video:';
export const HLS_MIME = 'application/vnd.apple.mpegurl';

export const videoTrackId = (author, permlink) => `${VIDEO_TRACK_PREFIX}${author}/${permlink}`;

/** A track the player made from a video. */
export const isVideoTrack = (track) => track?.video === true && !track.external && String(track._id || '').startsWith(VIDEO_TRACK_PREFIX);

/** Media Source Extensions, which hls.js needs (ManagedMediaSource on newer iPhones). */
export function mseAvailable() {
  return typeof globalThis.MediaSource !== 'undefined' || typeof globalThis.ManagedMediaSource !== 'undefined';
}

/** The lowest rendition of a master playlist url, or the url itself (a media playlist, or unreadable). */
export async function lowestRenditionUrl(playUrl, { fetchImpl } = {}) {
  try {
    const text = await fetchPlaylist(playUrl, { fetchImpl });
    const low = lowestRendition(parseMaster(text, playUrl));
    return low?.url || playUrl;
  } catch {
    return playUrl;
  }
}

/**
 * The audio-player track for a video. `video` = { author, permlink, title?,
 * thumbnail?, duration?, postAuthor?, postPermlink? }; what is missing comes
 * from the player API. `author`/`permlink` find what plays (the upload); the
 * Hive post the player votes, comments and tips on is `postAuthor`/`postPermlink`
 * when the caller knows the upload's own (a sound's original Short), else the
 * same. Throws an Error with code 'no_source' when the video has nothing to play
 * (processing, deleted, a live stream).
 */
export async function videoAudioTrack(video, { fetchSource = fetchPlaySource, fetchImpl } = {}) {
  const author = String(video?.author || '').trim();
  const permlink = String(video?.permlink || '').trim();
  const postAuthor = String(video?.postAuthor || '').trim() || author;
  const postPermlink = String(video?.postPermlink || '').trim() || permlink;
  const source = author && permlink ? await fetchSource(author, permlink) : null;
  if (!source?.play_url || source.placeholder) {
    const err = new Error('no_source');
    err.code = 'no_source';
    throw err;
  }
  const src = await lowestRenditionUrl(source.play_url, { fetchImpl });
  return {
    _id: videoTrackId(postAuthor, postPermlink),
    video: true,
    owner: postAuthor,
    post_permlink: postPermlink,
    title: video.title || '',
    thumbnail_url: video.thumbnail || source.thumbnail_url || null,
    duration: Number(video.duration) || Number(source.duration) || 0,
    src,
    mime: HLS_MIME,
  };
}

/**
 * Build the track and play it in the global player (the store's audioPlay); the
 * same video already loaded just plays on. The video page's own player pauses
 * through the media coordinator when the audio starts.
 */
export async function playVideoAsAudio(video, store, opts) {
  const track = await videoAudioTrack(video, opts);
  const { audioPlay, audioCurrent, audioIsPlaying, audioRequestToggle } = store;
  if (audioCurrent?._id !== track._id) audioPlay(track);
  else if (!audioIsPlaying) audioRequestToggle?.();
  return track;
}
