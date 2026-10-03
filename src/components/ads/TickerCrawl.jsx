import { useLayoutEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import './TickerCrawl.scss';

/**
 * The ticker ad: one line crawling along the top of the video.
 *
 *   [Ad] (avatar) @account · Product name   Their message ...  ← moving
 *
 * One component for the watch page and the preview on /advertise, the same rule
 * AdOverlay follows: what an advertiser sees while writing it is what a viewer gets.
 *
 * The disclosure stays put and only the text moves. A label that crawls off screen
 * with the rest is a label that is missing for most of the run.
 *
 * It crosses ONCE in the booked seconds (the animation duration is the booking), and
 * it stops when the video stops, so a paused viewer is not shown an ad scrolling by
 * that they will never read. With reduced motion it does not move at all and the line
 * is cut with an ellipsis instead.
 *
 * Two styles. 'crawl' crosses once. 'hold' eases in from the right, spends the middle
 * 60% of the time readable, then eases out to the left. A line that FITS the bar
 * stops centred; a longer one (a long message on a phone) comes to rest with its start
 * just inside the left edge, pans slowly until its end is in view and rests there a
 * moment before leaving (timings in TickerCrawl.scss). So it is
 * measured here, and re-measured when the strip changes size. Same booked seconds
 * either way.
 *
 * With a click URL the whole strip is a link to OUR origin, which counts the click and
 * redirects to the link a reviewer approved with the message. New tab, so the viewer
 * keeps their video.
 */
// Breathing room at either edge when a long line pans, so its first and last letters
// are not cut by the edge of the strip.
const HOLD_EDGE = 12;

/* Where the 'hold' line rests, as CSS variables: it comes in from the right edge,
 * is readable from --ticker-start to --ticker-end (the same spot when it fits, centred;
 * a slow pan from its start to its end when it does not), then leaves past the left. */
function holdVars(w, c) {
  const fits = c <= w - 2 * HOLD_EDGE;
  const start = fits ? Math.round((w - c) / 2) : HOLD_EDGE;
  const end = fits ? start : Math.round(w - c - HOLD_EDGE);
  return {
    '--ticker-from': `${w}px`,
    '--ticker-start': `${start}px`,
    '--ticker-end': `${end}px`,
    '--ticker-to': `${-c}px`,
    '--ticker-in-ease': holdEntryEase(w - start, start - end),
  };
}

/* The entry's ease-out, ending at the speed the pan goes on at, so the line slows INTO
 * the pan instead of stopping and then lurching off again. A line that fits has no pan
 * (pan = 0) and eases all the way to rest.
 *
 * The pan's curve (TickerCrawl.scss, 20%) STARTS at its average speed (slope 1) and
 * glides to a stop, so the speed to hand over at is that average.
 * In the entry's own 0..1 terms it is (pan / 50%) / (entry / 20%), the
 * slope the curve must end on; a cubic-bezier ends on the slope (1 - y2) / (1 - x2).
 * Capped at 1 (linear): a pan faster than the entry would need the entry to SPEED UP. */
function holdEntryEase(entry, pan) {
  const k = entry > 0 ? Math.min(1, (0.4 * Math.max(0, pan)) / entry) : 0;
  const x2 = 0.65;
  const y2 = 1 - k * (1 - x2);
  return `cubic-bezier(0.2, 0.9, ${x2}, ${y2.toFixed(3)})`;
}

export default function TickerCrawl({
  account = null,
  productName = null,
  message,
  label = 'Ad',
  clickUrl = null,
  durationSeconds = 15,
  paused = false,
  loop = false,
  // Kept mounted but out of sight, so a crawl paused behind a video spot resumes from
  // where it was instead of starting over.
  hidden = false,
  // 'crawl' | 'hold'
  tickerStyle = 'crawl',
  // The phone-sized strip regardless of the viewport, for the /advertise preview.
  compact = false,
}) {
  const windowRef = useRef(null);
  const contentRef = useRef(null);
  // Measured sizes for 'hold'; null until measured.
  const [measured, setMeasured] = useState(null);
  // Only meaningful in 'hold' mode; a crawl ignores whatever was last measured.
  const hold = tickerStyle === 'hold' ? measured : null;

  useLayoutEffect(() => {
    if (tickerStyle !== 'hold') return undefined;
    const measure = () => {
      const w = windowRef.current?.clientWidth || 0;
      const c = contentRef.current?.scrollWidth || 0;
      setMeasured(w > 0 && c > 0 ? { w, c } : null);
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro && windowRef.current) ro.observe(windowRef.current);
    return () => ro?.disconnect();
  }, [tickerStyle, message, account, productName, compact]);

  const style = {
    '--ticker-duration': `${Math.max(3, Number(durationSeconds) || 15)}s`,
    '--ticker-iterations': loop ? 'infinite' : '1',
    '--ticker-state': paused ? 'paused' : 'running',
    ...(hold ? holdVars(hold.w, hold.c) : {}),
  };

  const line = (
    // Keyed on the mode, so switching restarts the animation from its first frame.
    <span key={hold ? 'hold' : 'crawl'} className={`ticker-track${hold ? ' is-hold' : ''}`}>
      <span className="ticker-content" ref={contentRef}>
        {account ? (
          <img
            className="ticker-avatar"
            src={`/img/u/${account}/avatar/small`}
            alt=""
            loading="lazy"
          />
        ) : null}
        {account ? <strong className="ticker-account">@{account}</strong> : null}
        {productName ? <span className="ticker-product">{productName}</span> : null}
        <span className="ticker-message">{message}</span>
      </span>
    </span>
  );

  return (
    <div className={`watch-ticker${compact ? ' is-compact' : ''}`} style={hidden ? { ...style, display: 'none' } : style} aria-hidden={hidden || undefined}>
      <span className="ticker-label">{label}</span>
      {clickUrl ? (
        <a
          ref={windowRef}
          className="ticker-window"
          href={clickUrl}
          target="_blank"
          rel="noopener noreferrer sponsored"
          title={productName ? `Open ${productName}` : 'Open the advertiser’s link'}
          // Never let the click reach the play/pause surface underneath.
          onClick={(e) => e.stopPropagation()}
        >
          {line}
        </a>
      ) : (
        <span className="ticker-window" ref={windowRef}>{line}</span>
      )}
    </div>
  );
}

TickerCrawl.propTypes = {
  account: PropTypes.string,
  productName: PropTypes.string,
  message: PropTypes.string.isRequired,
  label: PropTypes.string,
  clickUrl: PropTypes.string,
  durationSeconds: PropTypes.number,
  paused: PropTypes.bool,
  loop: PropTypes.bool,
  hidden: PropTypes.bool,
  tickerStyle: PropTypes.oneOf(['crawl', 'hold']),
  compact: PropTypes.bool,
};
