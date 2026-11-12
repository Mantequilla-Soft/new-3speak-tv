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
import { Player } from "@mantequilla-soft/3speak-player";
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

  // The video preview (HERO_PREVIEW): one muted, looping player for the hero,
  // fed the active slide; it fades in over the picture on its first frame and
  // out again when the slide moves on. ABR is capped to the element's size.
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const [previewOn] = useState(previewAllowed);
  const [playing, setPlaying] = useState(false);
  const previewSrc = video && previewOn ? `${authorOf(video)}/${video.permlink}` : null;
  useEffect(() => {
    const el = videoRef.current;
    if (!previewSrc || !el) return undefined;
    if (!playerRef.current) {
      const player = new Player({
        apiBase: getPlayerUrl(),
        muted: true,
        loop: true,
        poster: false,
        debug: false,
        hlsConfig: withGatewayFallback({ maxBufferLength: 12, backBufferLength: 10, capLevelToPlayerSize: true }),
      });
      player.attach(el);
      playerRef.current = player;
    }
    const player = playerRef.current;
    let alive = true;
    setPlaying(false);
    const onPlaying = () => { if (alive) setPlaying(true); };
    el.addEventListener("playing", onPlaying);
    player.load(previewSrc)
      .then(() => { if (alive && !player.destroyed) player.play().catch(() => {}); })
      .catch(() => {});
    return () => { alive = false; el.removeEventListener("playing", onPlaying); };
  }, [previewSrc]);
  // A hidden tab stops it; coming back starts it again.
  useEffect(() => {
    if (!previewOn) return undefined;
    const onVis = () => {
      const player = playerRef.current;
      if (!player || player.destroyed) return;
      if (document.hidden) player.pause(); else player.play().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [previewOn]);
  useEffect(() => () => { try { playerRef.current?.destroy(); } catch { /* ignore */ } }, []);

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
        {bg.prev && bg.prev !== thumb && <img key={bg.prev} className="is-prev" src={bg.prev} alt="" decoding="async" />}
        {thumb && <img key={thumb} className="is-cur" src={thumb} alt="" decoding="async" fetchPriority="high" />}
        {previewOn && <video ref={videoRef} className={`home-hero__video${playing && !fading ? " is-on" : ""}`} muted playsInline preload="none" />}
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
          <div className="home-hero__segs">
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
