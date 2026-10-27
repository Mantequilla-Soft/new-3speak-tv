import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import ShortsStories, { useShortsStories } from "../components/ShortsStories/ShortsStories";
import { useStoryCreators, storyViewerPath } from "../lib/stories";
import VideoShort from "./Short";
import { useAppStore } from "../lib/store";
import "./ShortsStoryFeed.scss";

/**
 * ShortsStoryFeed — wrapper page that combines the creator stories bar
 * with the existing shorts player.  Lives at /shorts/stories and keeps
 * the original /shorts algorithm untouched.
 *
 * Creator navigation:
 *  • Desktop — left / right arrow keys
 *  • Mobile  — horizontal swipe (stories bar is hidden; swipe navigates)
 */
const ShortsStoryFeed = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAppStore();

  const feedUser = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("user") || null;
  }, [location.search]);

  // ?story=1: watching 24h stories, so left / right moves between story creators.
  const storyMode = useMemo(
    () => !!feedUser && new URLSearchParams(location.search).get("story") === "1",
    [feedUser, location.search]
  );

  const { creators } = useShortsStories();
  const { storyCreators } = useStoryCreators();
  const creatorsRef = useRef(creators);
  creatorsRef.current = storyMode ? storyCreators : creators;
  const storyModeRef = useRef(storyMode);
  storyModeRef.current = storyMode;
  const feedUserRef = useRef(feedUser);
  feedUserRef.current = feedUser;

  // The comments panel is `position: fixed` and full-height, so it would run UNDER
  // the stories bar. Publish the bar's real bottom edge (viewport coords — exactly
  // what a fixed element's `top` wants) as a CSS var and let the panel start there.
  //
  // The var goes on <html>, NOT on this page's root: Short.jsx portals the panel to
  // <body> (so it can render above the nav), which puts it OUTSIDE this subtree — a
  // var set here would never reach it. Same reason the CSS rule has to match from
  // `body:has(.shorts-story-feed)` rather than from inside `.shorts-story-feed`.
  //
  // Measured, not hardcoded: the bar's height depends on avatar size, the username
  // line and the theme's font metrics, and it differs between breakpoints.
  const rootRef = useRef(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const measure = () => {
      const bar = root.querySelector(":scope > .shorts-stories");
      // Hidden (mobile) or not yet mounted → 0, and the panel keeps its own top.
      const bottom = bar && bar.offsetParent !== null ? bar.getBoundingClientRect().bottom : 0;
      document.documentElement.style.setProperty("--stories-bar-bottom", `${Math.round(bottom)}px`);
    };
    measure();

    const cleanups = [];
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      ro.observe(root);
      cleanups.push(() => ro.disconnect());
    }
    if (typeof MutationObserver !== "undefined") {
      const mo = new MutationObserver(measure);
      mo.observe(root, { childList: true, subtree: true }); // stories load in async
      cleanups.push(() => mo.disconnect());
    }
    return () => {
      cleanups.forEach((fn) => fn());
      // It's a global now — don't leave it behind for /shorts or /watch.
      document.documentElement.style.removeProperty("--stories-bar-bottom");
    };
  }, []);

  // Swipe animation state
  const [swipeDir, setSwipeDir] = useState(null); // 'left' | 'right' | null
  const swipeTimerRef = useRef(null);

  const triggerSwipeAnim = useCallback((direction) => {
    if (swipeTimerRef.current) clearTimeout(swipeTimerRef.current);
    setSwipeDir(direction);
    swipeTimerRef.current = setTimeout(() => {
      setSwipeDir(null);
      swipeTimerRef.current = null;
    }, 350);
  }, []);

  // Navigate to a specific creator
  const navigateToCreator = useCallback(
    (username, { story = false } = {}) => {
      navigate(story ? storyViewerPath(username) : `/shorts/stories?user=${username}`, { replace: true });
    },
    [navigate]
  );

  // Navigate to previous / next creator in the list
  const navigateToAdjacentCreator = useCallback(
    (direction) => {
      const all = creatorsRef.current;
      if (!all || all.length === 0) return;

      const list = all.filter((c) => c.username !== user);
      if (list.length === 0) return;

      const current = feedUserRef.current;
      const idx = current ? list.findIndex((c) => c.username === current) : -1;

      let next;
      if (direction === "right") {
        next = idx < list.length - 1 ? idx + 1 : 0;
      } else {
        next = idx > 0 ? idx - 1 : list.length - 1;
      }

      triggerSwipeAnim(direction);
      navigateToCreator(list[next].username, { story: storyModeRef.current });
    },
    [user, navigateToCreator, triggerSwipeAnim]
  );

  // Desktop arrow-key navigation between creators
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopImmediatePropagation();
        navigateToAdjacentCreator("left");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        e.stopImmediatePropagation();
        navigateToAdjacentCreator("right");
      }
    };

    // Use capture phase so this fires before Short.jsx's bubble-phase listener
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [navigateToAdjacentCreator]);

  // Mobile horizontal swipe for creator navigation
  const touchXRef = useRef(null);
  const touchYRef = useRef(null);

  const onTouchStart = useCallback((e) => {
    // Ignore swipes that start inside the stories scroll container
    if (e.target.closest('.stories-scroll-container')) {
      touchXRef.current = null;
      return;
    }
    touchXRef.current = e.touches[0].clientX;
    touchYRef.current = e.touches[0].clientY;
  }, []);

  const onTouchEnd = useCallback(
    (e) => {
      if (touchXRef.current == null) return;
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const dx = endX - touchXRef.current;
      const dy = endY - touchYRef.current;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      // Only treat as horizontal swipe if X distance is dominant
      if (absDx > 50 && absDx > absDy * 1.5 && creatorsRef.current.length > 0) {
        navigateToAdjacentCreator(dx > 0 ? "left" : "right");
      }

      touchXRef.current = null;
      touchYRef.current = null;
    },
    [navigateToAdjacentCreator]
  );

  return (
    <div
      className="shorts-story-feed"
      ref={rootRef}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Desktop: compact bar above player */}
      <ShortsStories
        activeCreator={feedUser}
        activeStory={storyMode}
        onCreatorSelect={navigateToCreator}
        compact
        hiddenOnMobile
      />
      <div className={`shorts-story-feed__player${swipeDir ? ` swipe-${swipeDir}` : ""}`}>
        {/* Mobile: small overlay below top controls */}
        <div className="shorts-story-feed__mobile-stories">
          <ShortsStories
            activeCreator={feedUser}
            activeStory={storyMode}
            onCreatorSelect={navigateToCreator}
            compact
          />
        </div>
        <VideoShort key={`${feedUser || "__global__"}${storyMode ? ":story" : ""}`} />
      </div>
    </div>
  );
};

export default ShortsStoryFeed;
