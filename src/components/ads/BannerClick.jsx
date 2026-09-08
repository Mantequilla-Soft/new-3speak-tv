import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { MdOpenInNew, MdClose } from 'react-icons/md';
import './BannerClick.scss';

/**
 * The click target over a burned-in banner.
 *
 * The banner itself is not here and cannot be: it is part of the video's pixels, so
 * there is nothing in the page to click. What this adds is a transparent region
 * sitting exactly over it, for the seconds it is on screen, so a viewer who wants
 * the advertiser's site can get there.
 *
 * Deliberately ONLY the click. Blocking this element removes the ability to follow
 * the ad and nothing else — the ad still runs, the impression is still counted, the
 * advertiser still gets what they paid for. That asymmetry is the whole design: the
 * part that is worth money is unblockable, and the part a blocker can reach costs
 * only the click.
 *
 * WHERE IT GOES. `placement` comes from the server, in percentages of the VIDEO
 * FRAME, because the server is the only thing that knows where it burned the banner.
 * Those are not percentages of the player box: the video is drawn with
 * `object-fit: contain`, so on any player whose shape does not match the video's
 * there are bars, and a target positioned against the box would sit off the picture
 * by the height of them. So the displayed frame is measured from the element's own
 * intrinsic size and the target is placed inside THAT.
 */
export default function BannerClick({
  videoRef, placement, visible, clickUrl, advertiser, onDismiss, overlay,
}) {
  const [rect, setRect] = useState(null);
  /* The creative's real shape, once it is known.
   *
   * The server sends no aspect for a banner, so the box would otherwise be whatever
   * widthPct x maxHeightPct works out to and the artwork would sit letterboxed inside
   * it — with the close button on the corner of the BOX, floating off the banner. */
  const [mediaAspect, setMediaAspect] = useState(null);
  const mediaRef = useRef(null);

  useEffect(() => {
    const el = videoRef?.current;
    if (!visible || !el || !placement) return undefined;

    const measure = () => {
      const { videoWidth: vw, videoHeight: vh } = el;
      const box = el.getBoundingClientRect();
      if (!vw || !vh || !box.width || !box.height) { setRect(null); return; }

      // `contain`: the frame is scaled to fit, so one axis fills the box and the
      // other is centred with a bar either side of it.
      const scale = Math.min(box.width / vw, box.height / vh);
      const fw = vw * scale;
      const fh = vh * scale;
      const offsetX = (box.width - fw) / 2;
      const offsetY = (box.height - fh) / 2;

      // The burn box in frame pixels, then the creative FITTED inside it — the same
      // fit filterGraph() does in services/adBurner.js.
      //
      // The fit happens here and not on the server because the box's true aspect
      // depends on the frame's: widthPct is a percentage of the width and
      // maxHeightPct of the height, and only the player knows the frame. Fitting is
      // what keeps the target on the ad: a 5.6:1 strip in this box lands 604x108 on
      // a 720p frame, and covering the full 768-wide box would put 82px of live
      // click target either side of it, over plain video.
      const boxW = (fw * placement.widthPct) / 100;
      const boxH = (fh * placement.maxHeightPct) / 100;
      // The server's aspect when it has one, otherwise the creative's own once it has
      // loaded. Either way the box ends up the shape of the thing inside it.
      const aspect = placement.aspect > 0 ? placement.aspect : (mediaAspect || 0);
      const w = aspect > 0 ? Math.min(boxW, boxH * aspect) : boxW;
      const h = aspect > 0 ? w / aspect : boxH;
      const bottom = (fh * placement.bottomPct) / 100;

      setRect({
        left: offsetX + (fw - w) / 2,
        top: offsetY + fh - bottom - h,
        width: w,
        height: h,
      });
    };

    measure();
    // The frame moves whenever the player is resized, rotated or made fullscreen,
    // and the intrinsic size is not known until metadata has loaded.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener('loadedmetadata', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      ro.disconnect();
      el.removeEventListener('loadedmetadata', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [videoRef, placement, visible, mediaAspect]);

  const creative = overlay && (overlay.imageUrl || overlay.videoUrl) ? overlay : null;
  const drawing = !!(visible && rect && creative);

  /* Play the creative when it is a video.
   *
   * It arrives as an HLS manifest, which only Safari will play from a `src`, so
   * everywhere else needs hls.js. Imported on demand rather than at the top of the
   * file: the main player already pulls it in, and a still banner should not wait on
   * it to draw. A failure here costs the banner, never the page. */
  useEffect(() => {
    const el = mediaRef.current;
    const url = creative && creative.videoUrl;
    if (!drawing || !url || !el || el.tagName !== 'VIDEO') return undefined;

    /* 🚨 hls.js FIRST, canPlayType only as the fallback.
     *
     * Firefox answers "maybe" to canPlayType('application/vnd.apple.mpegurl') and then
     * has no decoder for it, so trusting that answer put an m3u8 straight on the
     * element and the console filled with "no decoder for requested format". Ask the
     * library whether it can do the job instead, and keep the native path for Safari,
     * which really does play HLS from a src and has no MSE for hls.js to attach to. */
    let hls = null;
    let cancelled = false;
    import('hls.js')
      .then(({ default: Hls }) => {
        if (cancelled) return;
        if (Hls.isSupported()) {
          hls = new Hls({ maxBufferLength: 10 });
          hls.loadSource(url);
          hls.attachMedia(el);
        } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
          el.src = url;
        }
      })
      .catch(() => { /* no banner is better than a broken watch page */ });
    return () => {
      cancelled = true;
      if (hls) hls.destroy();
    };
  }, [drawing, creative]);

  /* ⚠️ The close button renders whether or not there is a click URL, so the guard
   * above cannot require one any more. A banner with no advertiser website is still a
   * banner somebody may want gone. */
  if (!visible || !rect) return null;

  const noteAspect = (w, h) => { if (w > 0 && h > 0) setMediaAspect(w / h); };

  return (
    <>
    {drawing ? (
      /* The banner itself, drawn into the page rather than burned into the video.
       *
       * Sits UNDER the click target and under the player's controls, so the playhead
       * stays usable across it and a scrub near the bottom of the frame seeks instead
       * of opening the advertiser's site. */
      <div
        className="watch-banner-media"
        style={{
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        }}
      >
        {creative.videoUrl ? (
          <video
            ref={mediaRef}
            muted
            playsInline
            autoPlay
            /* Deliberately NOT looping: an advertiser books a number of seconds and
               makes a creative that long, the same rule the burned version follows. */
            onLoadedMetadata={(e) => noteAspect(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
          />
        ) : (
          <img
            ref={mediaRef}
            src={creative.imageUrl}
            alt=""
            onLoad={(e) => noteAspect(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
          />
        )}
        {/* The disclosure travels with the ad. Burned banners carry it in their own
            pixels; a drawn one has to say it here. */}
        <span className="watch-banner-label">{creative.label || 'Ad'}</span>
      </div>
    ) : null}
    {onDismiss ? (
      /* Close.
       *
       * 🚨 This CANNOT erase the banner from frames already decoded — the ad is in the
       * picture, which is the point of the format. What it does is tell the server to
       * stop burning, and let the player drop what it has buffered, so the banner goes
       * within about a second rather than at the end of its run.
       *
       * Placed just above the banner's top-right corner rather than on it: over the
       * corner it would sit on the advertiser's own artwork, and inside the click
       * target it would be a dismiss button inside a link.
       */
      <button
        type="button"
        className="watch-banner-close"
        aria-label="Close this ad"
        title="Close this ad"
        style={{
          left: `${rect.left + rect.width - 26}px`,
          top: `${Math.max(0, rect.top - 26)}px`,
        }}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDismiss(); }}
      >
        <MdClose aria-hidden="true" />
      </button>
    ) : null}
    {clickUrl ? (
    <a
      className="watch-banner-hit"
      href={clickUrl}
      target="_blank"
      rel="noopener noreferrer"
      // Named for what happens. The banner is already labelled "Ad" in the picture,
      // so this does not have to disclose — it has to say where the tap goes.
      aria-label={`Open ${advertiser || 'the advertiser'}'s website in a new tab`}
      style={{
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      }}
    >
      {/* The same mark the disclosure overlay carries, for the same reason: without
          it nothing says this part of the picture opens anything. It sits in the
          banner's top-right corner rather than the middle so it never lands on the
          advertiser's own wordmark, and it is the ONLY thing this element draws.
          aria-hidden — the anchor's label already says what happens. */}
      <MdOpenInNew className="watch-banner-open" aria-hidden="true" />
    </a>
    ) : null}
    </>
  );
}

BannerClick.propTypes = {
  videoRef: PropTypes.shape({ current: PropTypes.any }),
  placement: PropTypes.shape({
    widthPct: PropTypes.number,
    maxHeightPct: PropTypes.number,
    bottomPct: PropTypes.number,
    aspect: PropTypes.number,
  }),
  visible: PropTypes.bool,
  clickUrl: PropTypes.string,
  /** Called when the viewer closes the ad. Absent means no close button. */
  onDismiss: PropTypes.func,
  advertiser: PropTypes.string,
  /** The creative to draw, when the server handed it over instead of burning it. */
  overlay: PropTypes.shape({
    imageUrl: PropTypes.string,
    videoUrl: PropTypes.string,
    label: PropTypes.string,
  }),
};
