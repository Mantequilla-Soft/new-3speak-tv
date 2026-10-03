import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";

// How long to wait before showing the branded fallback for an image that has
// produced NOTHING yet (no bytes decoded, no error). This is now purely COSMETIC:
// the real <img> keeps loading underneath and reveals itself whenever it finally
// arrives, so a slow-but-alive thumbnail is never aborted. (The old logic swapped
// the <img> src to the fallback here, which killed the in-flight load and left the
// placeholder stuck until a hover re-requested the image — the reported bug. On a
// busy feed many thumbnails are still queued at a few seconds, with naturalWidth
// legitimately 0, so a short give-up window wrongly failed good images.)
// onError shows the fallback immediately, so this timer only matters for the rare
// host that hangs for ~a minute without ever erroring.
const THUMB_TIMEOUT_MS = 10000;
// Poll interval for "first bits decoded" (naturalWidth>0) so we reveal the image
// without waiting for the full onLoad.
const DECODE_POLL_MS = 120;

/**
 * Thumbnail <img> with a non-destructive fallback + loading spinner.
 *  - The real image ALWAYS loads (its src is never swapped away) and fades in the
 *    moment it decodes — even after the placeholder has been shown — so a slow
 *    thumbnail appears on its own without needing a hover.
 *  - onError shows the branded fallback immediately.
 *  - A watchdog shows the fallback BEHIND the (still-loading) image if nothing has
 *    decoded after THUMB_TIMEOUT_MS, so a hung host can't leave the card blank.
 *  - A spinner overlays the card during the initial wait, before either the image
 *    or the placeholder appears.
 * Off-screen lazy images don't arm the watchdog, so they never fall back or spin
 * before they even try to load.
 */
function CardThumbnail({ src, fallback, alt, eager = false, className, ...rest }) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false); // real image has renderable content
  const [failed, setFailed] = useState(false); // real image errored
  const [slow, setSlow] = useState(false);      // nothing decoded yet after watchdog
  const imgRef = useRef(null);
  const timerRef = useRef(null);
  const pollRef = useRef(null);

  // Reset when the source changes (card reused in a virtualized/re-sorted grid).
  useEffect(() => { setLoaded(false); setFailed(false); setSlow(false); }, [src]);

  useEffect(() => {
    const el = imgRef.current;
    if (!el || !src || loaded || failed) return undefined;

    const clear = () => { clearTimeout(timerRef.current); clearInterval(pollRef.current); };

    const arm = () => {
      clear();
      // Watchdog: show the branded placeholder if nothing has decoded yet. Does
      // NOT abort the real load — the <img> keeps going and reveals when ready.
      timerRef.current = setTimeout(() => {
        if (el.naturalWidth === 0) setSlow(true);
      }, THUMB_TIMEOUT_MS);
      // Reveal the moment the first bits (header) decode.
      pollRef.current = setInterval(() => {
        if (el.naturalWidth > 0) { setLoaded(true); clear(); }
      }, DECODE_POLL_MS);
    };

    // Eager tiles load immediately → arm now. Lazy tiles arm when near viewport.
    if (eager || typeof IntersectionObserver === "undefined") {
      arm();
      return clear;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); arm(); }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => { io.disconnect(); clear(); };
  }, [src, loaded, failed, eager]);

  const done = () => { clearTimeout(timerRef.current); clearInterval(pollRef.current); };

  return (
    <>
      {/* Real thumbnail — never aborted; fades in over the placeholder the moment
          it decodes, so a slow-but-alive image appears on its own (no hover). */}
      <img
        ref={imgRef}
        src={src}
        alt={alt ?? t("cards.thumbnailAlt")}
        className={className}
        style={{ position: "relative", zIndex: 1, opacity: loaded && !failed ? 1 : 0, transition: "opacity 0.2s ease" }}
        onLoad={() => { done(); setLoaded(true); }}
        onError={() => { done(); setFailed(true); }}
        loading={eager ? "eager" : "lazy"}
        fetchpriority={eager ? "high" : "auto"}
        decoding="async"
        {...rest}
      />
      {/* Branded fallback BEHIND the image — shown on a real error, or while a hung
          host has produced nothing. The real image covers it if/when it loads. */}
      {(failed || (slow && !loaded)) && (
        <img
          src={fallback}
          alt=""
          aria-hidden="true"
          className={className}
          style={{ position: "absolute", inset: 0, zIndex: 0, width: "100%", height: "100%" }}
        />
      )}
      {/* Spinner only during the initial wait, before image or placeholder. */}
      {!loaded && !failed && !slow && <span className="card-thumb-spinner" aria-hidden="true" />}
    </>
  );
}

CardThumbnail.propTypes = {
  src: PropTypes.string,
  fallback: PropTypes.string.isRequired,
  alt: PropTypes.string,
  eager: PropTypes.bool,
  className: PropTypes.string,
};

export default CardThumbnail;
