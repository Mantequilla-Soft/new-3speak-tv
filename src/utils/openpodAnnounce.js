import { toastIn } from './toast';
import { commentWithAioha } from '../hive-api/aioha';
import { enforceLockedBeneficiaries } from './beneficiaries';
import {
  fetchLatestSnapsPost,
  buildOpenPodSnapBody,
  buildOpenPodPermlink,
  buildOpenPodSnapMetadata,
} from './openpodUtils';
import { oaEnvelope, threespeakVideo, OA_ARTICLE, OA_MICROPOST } from './openAttribute';

// Every toast from this module is headed "Live"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Live');

// --- Shared announce config (community / payout / beneficiaries) ----------
// Edited in TWO places — the create-room dialog AND the studio's post tab —
// so it lives in one module-level store both AnnounceOptions instances read
// from and write to. Read at post time (getAnnounceConfig) so the latest edit
// always wins, whether it was made before or after entering the studio.
const ANNOUNCE_CFG_KEY = 'openpod-announce-config';

// Everything the host set last time survives a reload — including whether to
// announce at all. Note that leaves the announcement able to stay switched OFF
// across sessions; the studio's checkbox is the visible reminder of that.
const PERSISTED_KEYS = [
  'announceEnabled', 'community', 'communityTitle', 'declineRewards', 'rewardPowerup', 'beneList',
];

function readStoredConfig() {
  try {
    const raw = window.localStorage.getItem(ANNOUNCE_CFG_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(PERSISTED_KEYS.filter((k) => k in parsed).map((k) => [k, parsed[k]]));
  } catch {
    return {};
  }
}

let announceConfig = {
  // The host can still switch the announcement off from the studio, right up
  // until they hit Start (the create dialog's checkbox decides whether an
  // announcement is queued at all).
  announceEnabled: true,
  community: 'hive-181335',
  communityTitle: '',
  declineRewards: false,
  rewardPowerup: false,
  beneList: [],
  ...readStoredConfig(),
};

export function setAnnounceConfig(partial) {
  announceConfig = { ...announceConfig, ...partial };
  try {
    const toStore = Object.fromEntries(
      PERSISTED_KEYS.filter((k) => k in announceConfig).map((k) => [k, announceConfig[k]]),
    );
    window.localStorage.setItem(ANNOUNCE_CFG_KEY, JSON.stringify(toStore));
  } catch {
    /* storage blocked/full — non-critical, config still lives in memory */
  }
}

export function getAnnounceConfig() {
  return announceConfig;
}

// A short snap announcement, threaded under the latest @peak.snaps container.
async function postSnap(room, watchUrl, orientation, host) {
  const snapPost = await fetchLatestSnapsPost();
  const body = buildOpenPodSnapBody(room.title, watchUrl, room.backgroundImage);
  const permlink = buildOpenPodPermlink();
  const thumbnailUrl = room.backgroundImage || '';

  // A standalone stream is a broadcast, so the snap carries it: same `video`
  // block as the full post, which is what makes peakd/ecency render the player
  // instead of showing a bare link.
  //
  // A conference room is deliberately NOT carried. It is something you join,
  // and embedding a player invites people to sit and watch it silently from the
  // audience — the opposite of what a room is for. A room snap stays a link
  // into the conversation, so it gets the envelope and no video.
  const isStandalone = room.mode === 'standalone';
  const embedUrl = `https://play.3speak.tv/embed?v=${host}/${room.name}`;

  const metadata = {
    ...buildOpenPodSnapMetadata(room.name),
    ...oaEnvelope(OA_MICROPOST),
    ...(isStandalone ? {
      links: [embedUrl],
      video: {
        platform: '3speak',
        url: embedUrl,
        reusable: false,
        live: true,
        ...(thumbnailUrl ? { thumbnail: thumbnailUrl } : {}),
        info: {
          platform: '3speak',
          author: host,
          permlink: room.name,
          title: room.title || '',
          duration: 0,
          live: true,
          ...(thumbnailUrl ? { sourceMap: [{ url: thumbnailUrl, type: 'thumbnail' }] } : {}),
        },
      },
      ...threespeakVideo({ surface: 'live', orientation }),
    } : {}),
  };
  await commentWithAioha(snapPost.author, snapPost.permlink, permlink, '', body, metadata);
}

// A full top-level Hive post. The post's permlink IS the room name, so
// `author/roomName` is one identity everywhere: the votable/commentable Hive
// post, the watch link (?v=host/roomName), and the embed the player resolves
// to the live stream. Same object structure as an embed-studio video post
// (see EmbedUploadContext) so any 3Speak-aware frontend renders it identically.
async function postFullPost({ room, user, isPremium, orientation }) {
  const cfg = getAnnounceConfig();
  const communityTag = typeof cfg.community === 'string' && cfg.community ? cfg.community : 'hive-181335';

  const extraTags = Array.isArray(room?.post?.tags) ? room.post.tags : [];
  const tags = [communityTag, 'openpod', '3speak', ...extraTags].filter((t, i, a) => t && a.indexOf(t) === i);

  const host = room.host || user;
  const roomName = room.name;
  const thumbnailUrl = room.backgroundImage || '';
  const embedUrl = `https://play.3speak.tv/embed?v=${host}/${roomName}`;
  const watchUrl = `https://3speak.tv/watch?v=${host}/${roomName}`;

  // A standalone stream is a broadcast: the body leads with the embed so every
  // frontend renders the player, and it gets ONE link, "Watch on 3speak.tv"
  // (the ?v=host/room watch page). No separate "Join the live session" link.
  //
  // A conference room is something you join. Embedding it would seat people in
  // a silent audience, which is the opposite of what a room is for, so a room
  // announcement carries no player anywhere — not in the body, not in `video`,
  // not in the attribute — and links into the room instead. This matches what
  // the UI already does: Card3 sends a conference to /openpods/<room> under a
  // "LIVE CHAT" badge, while a standalone gets "LIVE" and the watch page.
  const isStandalone = room.mode === 'standalone';
  const joinUrl = `https://3speak.tv/openpods/${roomName}`;
  const descPart = (room.description || '').trim();
  const body = isStandalone
    ? `${embedUrl}\n\n` +
      (descPart ? `${descPart}\n\n` : '') +
      `---\n▶ [Watch on 3speak.tv](${watchUrl})`
    : (descPart ? `${descPart}\n\n` : '') +
      `---\n🎙️ [Join the live session](${joinUrl})`;

  const permlink = roomName;

  const jsonMetadata = {
    app: '3speak/embed',
    format: 'markdown',
    tags,
    ...(thumbnailUrl ? { image: [thumbnailUrl] } : {}),
    openpodRoom: roomName,
    // OpenAttribute. On a standalone stream `surface: live` is permanent: it
    // says how this post was published, not whether the stream is still
    // running. Nothing edits it afterwards, so it carries no duration — the
    // end, and any VOD that replaces the stream, live in our own database
    // rather than on chain.
    ...oaEnvelope(OA_ARTICLE),
    ...(isStandalone ? {
      links: [embedUrl],
      video: {
        platform: '3speak',
        url: embedUrl,
        reusable: false,
        live: true,
        ...(thumbnailUrl ? { thumbnail: thumbnailUrl } : {}),
        info: {
          platform: '3speak',
          author: host,
          permlink: roomName,
          title: room.title || '',
          duration: 0,
          live: true,
          ...(thumbnailUrl ? { sourceMap: [{ url: thumbnailUrl, type: 'thumbnail' }] } : {}),
        },
      },
      ...threespeakVideo({ surface: 'live', orientation }),
    } : {
      links: [joinUrl],
    }),
  };

  // Build beneficiaries — @threespeakfund 10% is locked for non-Pro hosts, but
  // a Pro host with no splits of their own legitimately ends up with NONE.
  // Hive REJECTS an empty beneficiaries extension ("Must specify at least one
  // beneficiary"), so the extension has to be omitted entirely in that case.
  // Declining payout skips beneficiaries too — they're meaningless against a
  // 0 HBD payout. Mirrors EmbedUploadContext's handling.
  let allBeneficiaries = [];
  if (!cfg.declineRewards) {
    const beneMap = new Map();
    for (const b of (cfg.beneList || [])) {
      beneMap.set(b.account, Math.max(beneMap.get(b.account) || 0, b.weight));
    }
    enforceLockedBeneficiaries(beneMap, { isPremium, originalAuthor: null });
    allBeneficiaries = [...beneMap.entries()]
      .map(([account, weight]) => ({ account, weight }))
      .sort((a, b) => a.account.localeCompare(b.account));
  }

  const commentOptions = {
    author: user,
    permlink,
    max_accepted_payout: cfg.declineRewards ? '0.000 HBD' : '1000000.000 HBD',
    percent_hbd: cfg.rewardPowerup ? 0 : 10000,
    allow_votes: true,
    allow_curation_rewards: true,
    extensions: allBeneficiaries.length > 0 ? [[0, { beneficiaries: allBeneficiaries }]] : [],
  };

  const result = await commentWithAioha('', communityTag, permlink, room.title, body, jsonMetadata, commentOptions);
  if (result && result.success === false) throw new Error('Post rejected');
}

/**
 * Post the Hive announcement for an OpenPod — a short snap, or a full
 * top-level post — per the host's choice. Community/payout/beneficiaries come
 * from the shared announce config (getAnnounceConfig).
 */
export async function postOpenPodAnnouncement({ room, options, user, isPremium, orientation }) {
  if (!user) return;
  if (options && options.notifyOnHive === false) return;

  const host = room.host || user;
  const watchUrl = `https://3speak.tv/watch?v=${host}/${room.name}`;
  const announceType = options?.announceType || 'snap';

  try {
    if (announceType === 'post') {
      await postFullPost({ room, user, isPremium, orientation });
      toast.success('Live session announced on Hive!');
    } else {
      await postSnap(room, watchUrl, orientation, host);
    }
  } catch (err) {
    // Non-blocking — the pod is live regardless of whether the post landed.
    console.error('OpenPod announcement failed:', err);
    toast.error('OpenPod started, but the Hive announcement could not be posted.');
  }
}

// --- Deferred announcement (standalone streams) --------------------------
// A standalone stream announces only when the host hits "Start Stream" — not
// at room creation. OpenPods stores the intent here; OpenPodModal fires it
// (room-scoped, once) on the start signal, passing the LATEST post details the
// host edited in the studio composer.
let pending = null;

export function setPendingAnnouncement(payload) {
  pending = payload;
}

export function clearPendingAnnouncement() {
  pending = null;
}

/**
 * Fire the stored announcement iff it belongs to `roomName`. `freshPost` is the
 * studio composer's current post details (title/description/thumbnail/tags) —
 * merged over the create-time room so the post reflects what the host actually
 * set before going live. Consumed so pause→resume or reopen can't double-post.
 */
export async function firePendingAnnouncement(roomName, freshPost) {
  if (!pending) return;
  if (roomName && pending.room?.name !== roomName) return;
  const payload = pending;
  pending = null;

  // Host switched the announcement off in the studio — consume and skip.
  if (getAnnounceConfig().announceEnabled === false) return;

  const room = { ...payload.room };
  if (freshPost) {
    if (freshPost.title != null && freshPost.title !== '') room.title = freshPost.title;
    if (freshPost.description != null) room.description = freshPost.description;
    if (freshPost.thumbnail != null && freshPost.thumbnail !== '') room.backgroundImage = freshPost.thumbnail;
    if (Array.isArray(freshPost.tags)) room.post = { ...(room.post || {}), tags: freshPost.tags };
  }

  // The studio reports the composited output's shape at go-live. Older SDK
  // builds send nothing, in which case the announcement simply carries no video
  // attribute rather than a guessed orientation.
  await postOpenPodAnnouncement({ ...payload, room, orientation: freshPost?.orientation });
}
