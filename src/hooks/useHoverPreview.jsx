import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { reportVideoUnavailable } from '../lib/reportUnavailable';
import { ThreeSpeakApi } from "@mantequilla-soft/3speak-player";
import { getPlayerUrl } from "../utils/playerUrl";
import { createLowResPreviewPlayer } from "../lib/lowResPreviewPlayer";
import { useAppStore } from "../lib/store";
import useSubtitles, { prefetchSubtitles } from "./useSubtitles";
import SubtitleOverlay from "../components/SubtitleOverlay/SubtitleOverlay";

// Statuses with no playable stream — never preview these.
const NON_PLAYABLE = new Set(["scheduled", "encoding", "draft", "failed", "deleted"]);

// Abortable clone of the SDK's ThreeSpeakApi.prefetchManifest — warms the HLS
// manifest, the LOWEST-bitrate variant playlist, and its first .ts segment (the
// heavy part) into the browser/CDN cache. Two fixes over the SDK version:
//   1. an AbortSignal is threaded through every fetch, so a card that scrolls
//      out of view cancels its in-flight segment download mid-flight;
//   2. it picks the smallest variant by BANDWIDTH, not the first one listed —
//      the embed encoder orders variants highest-first (1080p first), so the
//      SDK's "first variant" would prefetch a 1080p segment for a tiny preview.
const firstEntry = (text) => text.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
const baseOf = (u) => u.substring(0, u.lastIndexOf("/") + 1);
const resolveRef = (ref, b) => (ref.startsWith("http") ? ref : b + ref);

// From a master playlist, return the URL of the lowest-BANDWIDTH variant.
function lowestVariantUrl(masterText, base) {
  const lines = masterText.split("\n").map((l) => l.trim());
  let best = null; // { bw, url }
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
    const bw = Number(/BANDWIDTH=(\d+)/.exec(lines[i])?.[1]) || Infinity;
    let j = i + 1;
    while (j < lines.length && (!lines[j] || lines[j].startsWith("#"))) j++;
    if (j < lines.length && (!best || bw < best.bw)) best = { bw, url: resolveRef(lines[j], base) };
  }
  return best?.url || null;
}

async function prefetchManifestAbortable(hlsUrl, signal, onGone) {
  const opts = { mode: "cors", credentials: "omit", signal };
  try {
    const res = await fetch(hlsUrl, opts);
    // The status was never checked here: a 404 just returned the error page as text,
    // failed the #EXT-X test, and the card went on quietly showing a video that plays
    // nothing. A hard 404 is the one signal worth acting on — report it (the checker
    // re-verifies across every gateway before it believes us).
    if (res.status === 404 || res.status === 410) {
      if (!signal.aborted && onGone) onGone(hlsUrl);
      return;
    }
    const text = await res.text();
    if (signal.aborted) return;
    if (text.includes("#EXT-X-STREAM-INF")) {
      const variantUrl = lowestVariantUrl(text, baseOf(hlsUrl));
      if (!variantUrl) return;
      const varText = await (await fetch(variantUrl, opts)).text();
      if (signal.aborted) return;
      const seg = firstEntry(varText);
      if (seg) fetch(resolveRef(seg, baseOf(variantUrl)), opts).catch(() => {});
    } else {
      const seg = firstEntry(text);
      if (seg) fetch(resolveRef(seg, baseOf(hlsUrl)), opts).catch(() => {});
    }
  } catch { /* aborted or network — ignore */ }
}

// Hover-to-play preview shared by any card grid (video cards, playlists, …).
// Desktop: plays the hovered card. Mobile (large mode only): auto-plays the card
// closest to the viewport centre as you scroll. Returns props to spread on the
// grid container + each card, plus the single reused <video>/Player overlay.
//
// `renderControls({ author, permlink, title, setLock })` — optional render prop for
// controls that must sit ON TOP of the preview (the ⋮ options menu). They can't be
// rendered inside the card: `.card:hover` sets a transform, making the card its own
// stacking context, so its children are always painted below this overlay. Call
// `setLock(true)` while a popup is open so leaving the card doesn't kill the preview.
export default function useHoverPreview({ renderControls } = {}) {
  const previewEnabled = useAppStore((s) => s.previewEnabled !== false);
  const cardSize = useAppStore((s) => s.homeCardSize);

  const canHover = useMemo(
    () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(hover: hover)").matches,
    []
  );
  const isMobile = !canHover;
  // On mobile we only auto-play in large mode (full-width cards make it sensible).
  const mobileAutoplay = previewEnabled && isMobile && cardSize === "large";
  const active = previewEnabled && (canHover || mobileAutoplay);

  const containerRef = useRef(null);
  const overlayElRef = useRef(null);
  const videoElRef = useRef(null);
  const playerRef = useRef(null);
  const hoverTimer = useRef(null);
  const draggingRef = useRef(false);
  const [hover, setHover] = useState(null); // { key, author, permlink, thumb, title, source, rect }
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [curTime, setCurTime] = useState(0);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  // Set while an overlay control has a popup open — see onContainerLeave.
  const controlsLockRef = useRef(false);
  const setControlsLock = useCallback((locked) => {
    const wasLocked = controlsLockRef.current;
    controlsLockRef.current = locked;
    // Only a real lock→unlock transition ends the preview. Controls report
    // `false` on mount too, and clearing `hover` there would unmount them again
    // the instant they appeared (they only render while hovering).
    if (wasLocked && !locked) {
      // The pointer is usually nowhere near the card now (it was in the portalled
      // dropdown) so no mouseleave will fire — end the preview explicitly rather
      // than leaving it stuck open.
      clearTimeout(hoverTimer.current);
      setHover(null);
    }
  }, []);

  // ── Preload visible tiles (lowest-res) + track card nodes for mobile centring ──
  const apiRef = useRef(null);
  if (!apiRef.current) apiRef.current = new ThreeSpeakApi(getPlayerUrl());
  const sourcesRef = useRef(new Map());
  const inflightRef = useRef(new Map()); // key -> AbortController (in-flight preloads)
  const cardNodesRef = useRef(new Set());
  const preload = useCallback((key, author, permlink) => {
    if (!key || !author || !permlink) return;
    const sources = sourcesRef.current;
    const inflight = inflightRef.current;
    if (sources.has(key) || inflight.has(key)) return;
    const ctrl = new AbortController();
    inflight.set(key, ctrl);
    apiRef.current.fetchSource(author, permlink)
      .then((src) => {
        if (ctrl.signal.aborted) return;
        sources.set(key, src);
        // Warm the manifest + first segment, cancellable via the same controller.
        // Every visible card runs this, so it doubles as the dead-video sweep: as
        // people scroll the feeds, anything whose media has gone gets reported.
        return prefetchManifestAbortable(src.url, ctrl.signal, (url) =>
          reportVideoUnavailable(author, permlink, url));
      })
      .catch(() => {})
      .finally(() => { if (inflight.get(key) === ctrl) inflight.delete(key); });
  }, []);

  // Abort an in-flight preload for a card that scrolled out of view. A no-op once
  // the source is already resolved/cached (nothing left to cancel).
  const cancelPreload = useCallback((key) => {
    const ctrl = inflightRef.current.get(key);
    if (ctrl) { try { ctrl.abort(); } catch { /* ignore */ } inflightRef.current.delete(key); }
  }, []);

  const observerRef = useRef(null);
  const observeCard = useCallback((node) => {
    if (!node) return;
    cardNodesRef.current.add(node);
    if (typeof IntersectionObserver === "undefined") return;
    // Preload the source of every DISPLAYED card (desktop + mobile) so hover /
    // mobile-autoplay start instantly — but cancel the download the moment a card
    // scrolls out of view, so a fast scroll through a long list doesn't burn
    // bandwidth on cards the user never lands on.
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver((entries) => {
        for (const e of entries) {
          const { postkey, author, permlink } = e.target.dataset;
          if (e.isIntersecting) preload(postkey, author, permlink);
          else cancelPreload(postkey);
        }
      }, { rootMargin: "300px 0px" });
    }
    observerRef.current.observe(node);
  }, [preload, cancelPreload]);
  useEffect(() => () => {
    observerRef.current?.disconnect();
    cardNodesRef.current.clear();
    inflightRef.current.forEach((c) => { try { c.abort(); } catch { /* ignore */ } });
    inflightRef.current.clear();
  }, []);

  // ── Single reused Player (only load() per active card) ──
  const ensurePlayer = useCallback(() => {
    if (playerRef.current) return playerRef.current;
    const el = videoElRef.current;
    if (!el) return null;
    // Shared lowest-rendition preview player (also used by the scrubber preview).
    const player = createLowResPreviewPlayer(el, { loop: true });
    playerRef.current = player;
    el.addEventListener("timeupdate", () => {
      if (!el.duration) return;
      if (!draggingRef.current) setProgress(el.currentTime / el.duration);
      setCurTime(el.currentTime);
    });
    // Reveal as soon as the first frame is decoded (snappier than waiting for 'playing').
    el.addEventListener("loadeddata", () => setReady(true));
    el.addEventListener("playing", () => setReady(true));
    return player;
  }, []);

  useEffect(() => {
    const player = hover ? ensurePlayer() : playerRef.current;
    if (!player) return;
    if (!hover) { try { player.pause(); } catch { /* ignore */ } return; }
    setReady(false);
    setProgress(0);
    setCurTime(0);
    player.load(hover.source || `${hover.author}/${hover.permlink}`)
      .then(() => { if (!player.destroyed) player.play().catch(() => {}); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover?.key]);

  useEffect(() => () => { try { playerRef.current?.destroy(); } catch { /* ignore */ } }, []);

  // Captions for the active video, always on since the preview is muted: the
  // viewer's saved CC language, else their device language, else English.
  // Nothing is saved as a choice.
  const { cues, subtitleStyle } = useSubtitles(hover?.author, hover?.permlink, { autoSelect: true });

  const rectOf = (node) => {
    const cont = containerRef.current;
    if (!node || !cont) return null;
    const r = node.getBoundingClientRect();
    const cr = cont.getBoundingClientRect();
    return { top: r.top - cr.top, left: r.left - cr.left, width: r.width, height: r.height };
  };

  // ── Mobile: auto-play the card nearest the viewport centre; keep the overlay
  //    positioned over it while scrolling. ──
  const mobileKeyRef = useRef(null);
  useEffect(() => {
    if (!mobileAutoplay) return;
    let raf = 0;
    const positionOverlay = (node) => {
      const el = overlayElRef.current;
      const rect = rectOf(node);
      if (!el || !rect) return;
      el.style.top = `${rect.top}px`;
      el.style.left = `${rect.left}px`;
      el.style.width = `${rect.width}px`;
      el.style.height = `${rect.height}px`;
    };
    const pick = () => {
      raf = 0;
      const vh = window.innerHeight;
      const mid = vh / 2;
      let best = null;
      let bestD = Infinity;
      // Only the card that straddles the viewport centre plays — so across the
      // page's separate row grids, just one video is ever active at a time.
      for (const node of cardNodesRef.current) {
        if (!node.isConnected) { cardNodesRef.current.delete(node); continue; }
        const r = node.getBoundingClientRect();
        if (r.height === 0 || r.top > mid || r.bottom < mid) continue;
        const d = Math.abs(r.top + r.height / 2 - mid);
        if (d < bestD) { bestD = d; best = node; }
      }
      if (!best) { mobileKeyRef.current = null; setHover(null); return; }
      // Position over the thumbnail only, not the whole card (title/meta).
      const thumbEl = best.querySelector(".img-wrap, .video-thumbnail") || best;
      positionOverlay(thumbEl);
      const key = best.dataset.postkey;
      if (key !== mobileKeyRef.current) {
        mobileKeyRef.current = key;
        prefetchSubtitles(best.dataset.author, best.dataset.permlink);
        setReady(false);
        setHover({
          key,
          author: best.dataset.author,
          permlink: best.dataset.permlink,
          thumb: best.dataset.thumb,
          source: sourcesRef.current.get(key),
          rect: rectOf(thumbEl),
        });
      }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(pick); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    // Retry a few times so late-loading cards get picked up without a scroll.
    const timers = [setTimeout(pick, 300), setTimeout(pick, 900), setTimeout(pick, 1800)];
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      timers.forEach(clearTimeout);
      if (raf) cancelAnimationFrame(raf);
      mobileKeyRef.current = null;
      setHover(null);
    };
  }, [mobileAutoplay]);

  // ── Scrub bar ──
  const seekFromEvent = (clientX, bar) => {
    const rect = bar.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setProgress(frac);
    const el = videoElRef.current;
    if (el && el.duration) el.currentTime = frac * el.duration;
  };
  const onBarPointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const bar = e.currentTarget;
    draggingRef.current = true;
    seekFromEvent(e.clientX, bar);
    const move = (ev) => seekFromEvent(ev.clientX, bar);
    const up = () => {
      draggingRef.current = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ── Desktop hover tracking ──
  const onCardEnter = (e, postKey, author, permlink, thumb, title) => {
    if (!canHover) return;
    clearTimeout(hoverTimer.current);
    // The source is normally already preloaded (this card is displayed, so the
    // viewport observer resolved it). This is a fast-path fallback for the case
    // where it was cancelled on a quick scroll-out; if still unresolved by play
    // time, player.load falls back to the "author/permlink" string itself.
    preload(postKey, author, permlink);
    // Start on the captions now too, so they're ready when the clip starts
    // playing after the hover delay instead of arriving seconds into it.
    prefetchSubtitles(author, permlink);
    const node = e.currentTarget;
    setHover((h) => (h && h.key !== postKey ? null : h));
    hoverTimer.current = setTimeout(() => {
      setReady(false);
      setHover({
        key: postKey,
        author,
        permlink,
        thumb,
        title,
        source: sourcesRef.current.get(postKey),
        rect: rectOf(node.querySelector(".img-wrap, .video-thumbnail") || node),
      });
    }, 500);
  };
  const onContainerLeave = () => {
    if (!canHover) return;
    // While an overlay control has a popup open (the card options menu), the
    // pointer legitimately leaves the card — its dropdown is portalled to <body>.
    // Tearing the preview down here would unmount the menu mid-interaction.
    if (controlsLockRef.current) return;
    clearTimeout(hoverTimer.current);
    setHover(null);
  };

  const getCardProps = (key, author, permlink, thumb, status, title) => {
    if (!active || NON_PLAYABLE.has(status)) return {};
    return {
      ref: observeCard,
      "data-postkey": key,
      "data-author": author,
      "data-permlink": permlink,
      "data-thumb": thumb,
      onMouseEnter: canHover ? (e) => onCardEnter(e, key, author, permlink, thumb, title) : undefined,
    };
  };

  const overlay = !active ? null : (
    <div
      className={`card-hover-overlay${hover ? " active" : ""}${ready ? " ready" : ""}`}
      ref={overlayElRef}
      // Desktop positions via state; mobile positions imperatively while scrolling.
      style={hover && !mobileAutoplay ? { top: hover.rect.top, left: hover.rect.left, width: hover.rect.width, height: hover.rect.height } : undefined}
      // Only decorative when it carries no interactive controls.
      aria-hidden={renderControls ? undefined : "true"}
    >
      <video ref={videoElRef} className="card-hover-video" muted playsInline disablePictureInPicture />
      {hover?.thumb && <img className="card-hover-poster" src={hover.thumb} alt="" />}
      {ready && cues?.length > 0 && (
        <SubtitleOverlay currentTime={curTime} cues={cues} style={{ ...(subtitleStyle || {}), fontSize: "small" }} />
      )}

      {/* Card controls (e.g. the ⋮ options menu) must live INSIDE the overlay.
          `.card:hover` applies a transform, which makes the card its own stacking
          context — so anything rendered in the card gets painted underneath this
          overlay no matter how high its z-index. Rendering here is the only way
          they stay visible once a preview starts. */}
      {!mobileAutoplay && hover && renderControls && (
        <div className="card-hover-controls">
          {renderControls({
            author: hover.author,
            permlink: hover.permlink,
            title: hover.title,
            setLock: setControlsLock,
          })}
        </div>
      )}

      {/* Scrub bar on desktop hover only — seeking stalls the tiny mobile autoplay. */}
      {!mobileAutoplay && (
        <div
          className="card-hover-bar"
          onPointerDown={onBarPointerDown}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <div className="card-hover-bar-fill" style={{ width: `${progress * 100}%` }} />
          <div className="card-hover-bar-handle" style={{ left: `${progress * 100}%` }} />
        </div>
      )}
    </div>
  );

  return {
    canHover,
    containerProps: { ref: containerRef, onMouseLeave: onContainerLeave },
    getCardProps,
    overlay,
  };
}
