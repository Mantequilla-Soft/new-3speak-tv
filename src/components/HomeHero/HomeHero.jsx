import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Icon } from "../v2/Icon";
import HiveAvatar from "../HiveAvatar/HiveAvatar";
import AddToPlaylistModal from "../AddToPlaylistModal/AddToPlaylistModal";
import ShareChooserModal from "../Chat/ShareChooserModal";
import { fixVideoThumbnail } from "../../utils/fixThumbnails";
import { watchPath } from "../../utils/urls";
import { getPostDetails } from "../../hive-api/hiveApi";
import { getFollowers } from "../../hive-api/api";
import { formatNumber } from "../../i18n";
import { Player, ThreeSpeakApi } from "@mantequilla-soft/3speak-player";
import { holdForHero, releaseHero } from "../../lib/heroPriority";
import { getPlayerUrl } from "../../utils/playerUrl";
import { withGatewayFallback } from "../../lib/hlsGatewayFallback.js";
import "./HomeHero.scss";

// The picture behind the hero is drawn full width, so it asks for a big crop.
const HERO_SIZE = { w: 1280, h: 720 };

// How long each video stays in the Spotlight before the next slides in. The
// timer is the fill animation of the active segment (HomeHero.scss), so pausing
// it holds the progress and reduced motion (no animation) stops the sliding.
const SLIDE_MS = 7000;
const keyOf = (v) => `${v.author?.username || v.author || v.owner}/${v.permlink}`;
const authorOf = (v) => (v ? (v.author?.username || v.author || v.owner) : null);
const SWIPE_PX = 48;
// Moving on: the text fades out over this (--t-slow), then the next video's
// text fades in while its picture cross-fades over the last one (--t-xfade).
const FADE_OUT_MS = 320;
const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Owner trial 2026-11-12: each slide plays its video, muted, over the (slightly
// blurred) picture. Set to false to go back to the blurred picture alone.
const HERO_PREVIEW = true;
// Resolved stream sources, kept a day: the hero hands the player a source
// instead of making it look one up first (one round trip less per slide).
const SRC_CACHE = "hero-sources-v1";
const SRC_TTL = 24 * 60 * 60 * 1000;
const readSources = () => {
  try { return JSON.parse(localStorage.getItem(SRC_CACHE) || "{}") || {}; } catch { return {}; }
};
const cachedSource = (ref) => {
  const hit = readSources()[ref];
  return hit && Date.now() - hit.t < SRC_TTL && hit.s?.url ? hit.s : null;
};
const storeSource = (ref, source) => {
  try {
    const all = readSources();
    all[ref] = { t: Date.now(), s: { url: source.url, fallbacks: source.fallbacks || [] } };
    const keep = Object.entries(all).sort((a, b) => b[1].t - a[1].t).slice(0, 60);
    localStorage.setItem(SRC_CACHE, JSON.stringify(Object.fromEntries(keep)));
  } catch { /* storage full or blocked: look it up next time */ }
};
let heroApi = null;
const resolveSource = async (ref) => {
  const hit = cachedSource(ref);
  if (hit) return hit;
  if (!heroApi) heroApi = new ThreeSpeakApi(getPlayerUrl());
  const [author, permlink] = ref.split("/");
  const source = await heroApi.fetchSource(author, permlink);
  if (source?.url) storeSource(ref, source);
  return source;
};
// Open the connection to the player API early (it serves the stream lookups
// and playlists), before the first slide asks for anything.
if (typeof document !== "undefined") {
  try {
    const origin = new URL(getPlayerUrl()).origin;
    if (!document.querySelector(`link[rel="preconnect"][href="${origin}"]`)) {
      const l = document.createElement("link");
      l.rel = "preconnect";
      l.href = origin;
      l.crossOrigin = "anonymous";
      document.head.appendChild(l);
    }
  } catch { /* no player URL: nothing to warm */ }
}

// Desktop only, never on a data saver or with reduced motion: a full-width
// stream is a lot to pull on a phone plan.
const previewAllowed = () => HERO_PREVIEW
  && !!window.matchMedia?.("(min-width: 769px) and (hover: hover)").matches
  && !navigator.connection?.saveData
  && !reducedMotion();

const clock = (sec) => {
  const n = Math.floor(Number(sec) || 0);
  if (!n) return null;
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = String(n % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

/**
 * The Spotlight hero at the top of Home (20a): the featured video's picture
 * full width behind the top bar, fading into the page; a cyan chip naming the
 * community it was posted in, the title at 64/900, the creator with their
 * follower count, then Play (an ink slab) and Save / Share tiles.
 *
 * `videos` are the featured videos in order (HomeGrouped picks them). The hero
 * slides through them on its own (owner 2026-11-12), fading from one to the
 * next: a small row of segments at the hero's bottom right, like the stories,
 * fills for the active one; a segment jumps to its video, phones swipe, and it
 * holds while the pointer or keyboard focus is on it, a dialog is open or the
 * tab is hidden. While they
 * are on their way (`pending`) the hero holds its space with the placeholder.
 */
export default function HomeHero({ videos = [], pending = false }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saveOpen, setSaveOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // The active video by key, so a refetched pool keeps it in place. When it
  // leaves the pool (watched), the one that took its place is shown.
  const count = videos.length;
  const [activeKey, setActiveKey] = useState(null);
  const lastIdx = useRef(0);
  let idx = activeKey ? videos.findIndex((v) => keyOf(v) === activeKey) : 0;
  if (idx < 0) idx = Math.min(lastIdx.current, Math.max(0, count - 1));
  lastIdx.current = idx;
  const video = videos[idx] || null;
  const [fading, setFading] = useState(false);
  const fadeTimer = useRef(null);
  useEffect(() => () => clearTimeout(fadeTimer.current), []);
  const go = useCallback((i) => {
    const next = videos[((i % count) + count) % count];
    if (!next || next === videos[idx]) return;
    clearTimeout(fadeTimer.current);
    if (reducedMotion()) { setActiveKey(keyOf(next)); return; }
    setFading(true);
    fadeTimer.current = setTimeout(() => {
      setActiveKey(keyOf(next));
      setFading(false);
    }, FADE_OUT_MS);
  }, [videos, count, idx]);

  // What holds the sliding.
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [tabHidden, setTabHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  useEffect(() => {
    const onVis = () => setTabHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  const paused = fading || hover || focused || tabHidden || saveOpen || shareOpen;

  const author = authorOf(video);
  const permlink = video?.permlink || null;

  // The community the post sits in and the creator's follower count: one read
  // each, for this one video (the feed payload carries neither).
  const { data: post } = useQuery({
    queryKey: ["hero-post", author, permlink],
    queryFn: () => getPostDetails(author, permlink),
    enabled: !!author && !!permlink,
    staleTime: 10 * 60 * 1000,
  });
  const { data: follow } = useQuery({
    queryKey: ["hero-followers", author],
    queryFn: () => getFollowers(author),
    enabled: !!author,
    staleTime: 10 * 60 * 1000,
  });

  // The next one's picture, community and followers load ahead of it.
  const nextVideo = count > 1 ? videos[(idx + 1) % count] : null;
  useEffect(() => {
    if (!nextVideo) return;
    const a = authorOf(nextVideo);
    const src = fixVideoThumbnail(nextVideo, false, HERO_SIZE);
    if (src) { const img = new Image(); img.decoding = "async"; img.src = src; }
    queryClient.prefetchQuery({ queryKey: ["hero-post", a, nextVideo.permlink], queryFn: () => getPostDetails(a, nextVideo.permlink), staleTime: 10 * 60 * 1000 });
    queryClient.prefetchQuery({ queryKey: ["hero-followers", a], queryFn: () => getFollowers(a), staleTime: 10 * 60 * 1000 });
  }, [nextVideo, queryClient]);

  // The picture cross-fades: the last one stays underneath while the new one fades in.
  const thumb = video ? fixVideoThumbnail(video, false, HERO_SIZE) : null;
  const [bg, setBg] = useState({ cur: thumb, prev: null });
  useEffect(() => {
    setBg((b) => (b.cur === thumb ? b : { cur: thumb, prev: b.cur }));
  }, [thumb]);

  // The video preview (HERO_PREVIEW, owner 2026-11-12): two muted, looping
  // players take turns. The one in front plays the active slide; once it has
  // faded in, the other loads the NEXT slide's video and buffers it paused, so
  // moving on plays at once and cross-fades over the last one. No picture is
  // shown while the preview is on: it only comes back for a video that will not
  // play. ABR is capped to the element's size.
  const [previewOn] = useState(previewAllowed);
  const elA = useRef(null);
  const elB = useRef(null);
  const players = useRef([null, null]);
  const slotSrc = useRef([null, null]);
  const frontRef = useRef(0);
  const [front, setFront] = useState(0);
  const [onAir, setOnAir] = useState([false, false]);
  const [failed, setFailed] = useState(false);
  const previewSrc = video && previewOn ? `${authorOf(video)}/${video.permlink}` : null;
  const nextSrc = nextVideo && previewOn ? `${authorOf(nextVideo)}/${nextVideo.permlink}` : null;
  const nextSrcRef = useRef(nextSrc);
  useEffect(() => { nextSrcRef.current = nextSrc; }, [nextSrc]);

  const setSlotOn = useCallback((i, v) => setOnAir((o) => (o[i] === v ? o : (i ? [o[0], v] : [v, o[1]]))), []);
  const ensurePlayer = useCallback((i) => {
    if (players.current[i]) return players.current[i];
    const el = (i ? elB : elA).current;
    if (!el) return null;
    const player = new Player({
      apiBase: getPlayerUrl(),
      muted: true,
      loop: true,
      poster: false,
      debug: false,
      // Start on the smallest rendition (a low first estimate, as the card
      // previews do) so the first frame comes quickly, then climb as far as the
      // hero's size allows; the blur hides the first seconds.
      hlsConfig: withGatewayFallback({ maxBufferLength: 12, backBufferLength: 10, capLevelToPlayerSize: true, abrEwmaDefaultEstimate: 300000 }),
    });
    player.attach(el);
    el.addEventListener("playing", () => { setSlotOn(i, true); releaseHero(); });
    players.current[i] = player;
    return player;
  }, [setSlotOn]);
  const loadInto = useCallback((i, src, autoplay) => {
    const player = ensurePlayer(i);
    if (!player) return;
    slotSrc.current[i] = src;
    setSlotOn(i, false);
    resolveSource(src)
      .then((source) => (slotSrc.current[i] === src && !player.destroyed ? player.load(source) : null))
      .then((loaded) => { if (loaded && autoplay && !player.destroyed && slotSrc.current[i] === src) player.play().catch(() => {}); })
      .catch(() => {});
  }, [ensurePlayer, setSlotOn]);

  useEffect(() => {
    if (!previewSrc) return undefined;
    setFailed(false);
    let i = slotSrc.current.indexOf(previewSrc);
    if (i === -1) {
      i = 1 - frontRef.current;
      loadInto(i, previewSrc, true);
    } else {
      players.current[i]?.play().catch(() => {});
    }
    const other = 1 - i;
    frontRef.current = i;
    setFront(i);
    // The last video plays on under the new one while it fades in; then that
    // slot stops and buffers the slide after this one.
    const swap = setTimeout(() => {
      try { players.current[other]?.pause(); } catch { /* ignore */ }
      const next = nextSrcRef.current;
      if (next && slotSrc.current[other] !== next) loadInto(other, next, false);
    }, 1100);
    // Not playing after a while (no stream, blocked autoplay): the picture.
    const el = (i ? elB : elA).current;
    const giveUp = setTimeout(() => { if (!el || el.paused || el.readyState < 2) setFailed(true); }, 6000);
    return () => { clearTimeout(swap); clearTimeout(giveUp); };
  }, [previewSrc, loadInto]);

  // Once a video plays, the rest of the Spotlight's sources are looked up
  // quietly, one at a time, so the next visit starts every slide from the
  // cache (the order is reshuffled per page load).
  const anyOn = onAir[0] || onAir[1];
  const warmed = useRef(false);
  useEffect(() => {
    if (!previewOn || !anyOn || warmed.current) return undefined;
    warmed.current = true;
    let stop = false;
    const refs = videos.map((v) => `${authorOf(v)}/${v.permlink}`).filter((r) => !cachedSource(r));
    (async () => {
      for (const ref of refs) {
        if (stop) return;
        await resolveSource(ref).catch(() => null);
        await new Promise((r) => setTimeout(r, 250));
      }
    })();
    return () => { stop = true; };
  }, [previewOn, anyOn, videos]);

  // The cards' previews wait for the hero's first video (lib/heroPriority.js).
  useEffect(() => {
    if (!previewOn) return undefined;
    return holdForHero();
  }, [previewOn]);

  // A hidden tab stops the one in front; coming back starts it again.
  useEffect(() => {
    if (!previewOn) return undefined;
    const onVis = () => {
      const player = players.current[frontRef.current];
      if (!player || player.destroyed) return;
      if (document.hidden) player.pause(); else player.play().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [previewOn]);
  useEffect(() => () => {
    for (const p of players.current) { try { p?.destroy(); } catch { /* ignore */ } }
  }, []);
  const showPicture = !previewOn || failed;

  const touch = useRef(null);
  const onTouchStart = (e) => { const p = e.touches[0]; touch.current = { x: p.clientX, y: p.clientY }; };
  const onTouchEnd = (e) => {
    const start = touch.current;
    touch.current = null;
    if (!start || count < 2) return;
    const p = e.changedTouches[0];
    const dx = p.clientX - start.x;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(p.clientY - start.y)) go(idx + (dx < 0 ? 1 : -1));
  };

  // Let the phone top bar go see-through while the hero is under it (nav.scss).
  const shown = !!video || pending;
  useEffect(() => {
    if (!shown) return undefined;
    document.documentElement.setAttribute("data-home-hero", "");
    return () => document.documentElement.removeAttribute("data-home-hero");
  }, [shown]);

  if (!shown) return null;

  if (!video) {
    return (
      <section className="home-hero is-pending" aria-busy="true">
        <div className="home-hero__bg" aria-hidden="true" />
        <div className="home-hero__body">
          <span className="home-hero__ph is-chip" />
          <span className="home-hero__ph is-title" />
          <span className="home-hero__ph is-title is-short" />
          <span className="home-hero__ph is-play" />
        </div>
      </section>
    );
  }

  const href = watchPath(author, permlink);
  const duration = clock(video.spkvideo?.duration || video.duration);
  const community = post?.community_title || null;
  // The community's id (hive-123456): the chip opens its page (owner 2026-11-12).
  const communityId = post?.community || (/^hive-\d+$/.test(post?.category || "") ? post.category : null);
  const Chip = community && communityId ? Link : "div";
  const chipProps = Chip === Link ? { to: `/community/${communityId}` } : {};
  const followers = follow?.follower_count;
  const followersLabel = followers != null
    ? t("common.units.followers", { count: followers }).replace(String(followers), formatNumber(followers))
    : null;
  const openCreator = () => navigate(`/@${author}`);

  return (
    <section
      className={`home-hero${paused ? " is-paused" : ""}${fading ? " is-fading" : ""}`}
      aria-label={t("cards.badges.spotlight")}
      onPointerEnter={(e) => { if (e.pointerType === "mouse") setHover(true); }}
      onPointerLeave={() => setHover(false)}
      onFocus={(e) => { if (e.target.matches?.(":focus-visible")) setFocused(true); }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="home-hero__bg" aria-hidden="true">
        {showPicture && bg.prev && bg.prev !== thumb && <img key={bg.prev} className="is-prev" src={bg.prev} alt="" decoding="async" />}
        {showPicture && thumb && <img key={thumb} className="is-cur" src={thumb} alt="" decoding="async" fetchPriority="high" />}
        {previewOn && [elA, elB].map((ref, i) => (
          <video
            key={i}
            ref={ref}
            className={`home-hero__video${front === i ? " is-front" : ""}${onAir[i] ? " is-on" : ""}`}
            muted
            playsInline
            preload="auto"
            // A backdrop, not a player: no browser picture-in-picture button
            // on hover (Firefox draws one at the right edge), like the cards.
            disablePictureInPicture
            controlsList="nopictureinpicture nodownload"
          />
        ))}
      </div>

      <div className="home-hero__body" key={keyOf(video)}>
        <Chip className="home-hero__chip" {...chipProps}>
          <span className="home-hero__chip-tile" aria-hidden="true">
            {(community || t("cards.badges.spotlight")).slice(0, 1).toUpperCase()}
          </span>
          <span className="home-hero__chip-text is-wide">
            {community ? t("feeds.home.hero.spotlightIn", { community }) : t("cards.badges.spotlight")}
          </span>
          <span className="home-hero__chip-text is-narrow">{community || t("cards.badges.spotlight")}</span>
          {duration && <span className="home-hero__chip-time">· {duration}</span>}
        </Chip>

        <h2 className="home-hero__title">
          <Link to={href}>{video.title}</Link>
        </h2>

        <div className="home-hero__creator">
          <button type="button" className="home-hero__avatar" onClick={openCreator} aria-label={`@${author}`}>
            <HiveAvatar username={author} size="small" alt="" />
          </button>
          <button type="button" className="home-hero__name" onClick={openCreator}>{author}</button>
          {followersLabel && <span className="home-hero__followers">· {followersLabel}</span>}
        </div>

        <div className="home-hero__actions">
          <Link to={href} className="home-hero__play">
            <span>{t("common.actions.play")}</span>
            <Icon name="play_arrow" size={32} fill />
          </Link>
          <button type="button" className="home-hero__tile" onClick={() => setSaveOpen(true)} aria-label={t("common.actions.save")}>
            <Icon name="bookmark" size={24} />
            <span>{t("common.actions.save")}</span>
          </button>
          <button type="button" className="home-hero__tile" onClick={() => setShareOpen(true)} aria-label={t("common.actions.share")}>
            <Icon name="ios_share" size={24} />
            <span>{t("common.actions.share")}</span>
          </button>
        </div>
      </div>

      {count > 1 && (
        <div className="home-hero__slides">
          <div className="home-hero__segs" style={{ "--segs": count }}>
            {videos.map((v, i) => (
              <button
                key={keyOf(v)}
                type="button"
                className={`home-hero__seg${i < idx ? " is-done" : ""}${i === idx ? " is-on" : ""}`}
                aria-label={t("feeds.home.hero.slide", { index: i + 1, count })}
                aria-current={i === idx ? "true" : undefined}
                onClick={() => go(i)}
              >
                <span className="home-hero__seg-track">
                  {i === idx && (
                    <span
                      key={keyOf(v)}
                      className="home-hero__seg-fill"
                      style={{ animationDuration: `${SLIDE_MS}ms` }}
                      onAnimationEnd={() => go(idx + 1)}
                    />
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <AddToPlaylistModal
        isOpen={saveOpen}
        onClose={() => setSaveOpen(false)}
        author={author}
        permlink={permlink}
        videoTitle={video.title}
        thumbnail={thumb}
      />
      <ShareChooserModal
        open={shareOpen}
        url={`${window.location.origin}/@${author}/${permlink}`}
        title={video.title}
        embed={{ author, permlink }}
        hivePost={{ author, permlink }}
        onClose={() => setShareOpen(false)}
        onGeneralShare={() => {
          const url = `${window.location.origin}/@${author}/${permlink}`;
          if (navigator.share) navigator.share({ title: video.title, url }).catch(() => {});
          else navigator.clipboard?.writeText(url).catch(() => {});
        }}
      />
    </section>
  );
}
