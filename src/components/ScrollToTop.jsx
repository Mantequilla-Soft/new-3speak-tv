import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { isWatchPath } from "../utils/urls";

const ScrollToTop = () => {
  const { pathname: rawPath } = useLocation();
  // Every video is one page for this: going video to video (related, autoplay,
  // playlist, surf) never scrolled when they all shared /watch, and a reader
  // halfway down the comments should not be yanked up when the next one starts.
  const pathname = isWatchPath(rawPath) ? '/watch' : rawPath;

  useEffect(() => {
    // Skip scroll-to-top on Discover when returning with saved search state
    if (pathname === '/discover') {
      try {
        const raw = sessionStorage.getItem('discover-search-state');
        if (raw) {
          const state = JSON.parse(raw);
          if (state.searchTerm?.trim() && state.scrollY > 0) return;
        }
      } catch {}
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [pathname]);

  return null;
};

export default ScrollToTop;
