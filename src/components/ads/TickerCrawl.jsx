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
 * Two styles. 'crawl' crosses once. 'hold' slides in from the right, stops centred for
 * the middle 60% of the time, then slides out to the left: easier to read, and only
 * possible when the line FITS the bar, so it is measured here and falls back to the
 * crawl when it does not (a long message on a phone). Same booked seconds either way.
 *
 * With a click URL the whole strip is a link to OUR origin, which counts the click and
 * redirects to the link a reviewer approved with the message. New tab, so the viewer
 * keeps their video.
 */
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
  // Measured sizes for 'hold'; null until measured, and whenever the line does not fit.
  const [measured, setMeasured] = useState(null);
  // Only meaningful in 'hold' mode; a crawl ignores whatever was last measured.
  const hold = tickerStyle === 'hold' ? measured : null;

  useLayoutEffect(() => {
    if (tickerStyle !== 'hold') return undefined;
    const measure = () => {
      const w = windowRef.current?.clientWidth || 0;
      const c = contentRef.current?.scrollWidth || 0;
      setMeasured(w > 0 && c > 0 && c <= w - 8 ? { w, c } : null);
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
    ...(hold ? {
      '--ticker-from': `${hold.w}px`,
      '--ticker-center': `${Math.round((hold.w - hold.c) / 2)}px`,
      '--ticker-to': `${-hold.c}px`,
    } : {}),
  };

  const line = (
    // Keyed on the mode, so switching restarts the animation from its first frame.
    <span key={hold ? 'hold' : 'crawl'} className={`ticker-track${hold ? ' is-hold' : ''}`}>
      <span className="ticker-content" ref={contentRef}>
        {account ? (
          <img
            className="ticker-avatar"
            src={`https://images.hive.blog/u/${account}/avatar/small`}
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
