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
}) {
  const style = {
    '--ticker-duration': `${Math.max(3, Number(durationSeconds) || 15)}s`,
    '--ticker-iterations': loop ? 'infinite' : '1',
    '--ticker-state': paused ? 'paused' : 'running',
  };

  const line = (
    <span className="ticker-track">
      <span className="ticker-content">
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
    <div className="watch-ticker" style={hidden ? { ...style, display: 'none' } : style} aria-hidden={hidden || undefined}>
      <span className="ticker-label">{label}</span>
      {clickUrl ? (
        <a
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
        <span className="ticker-window">{line}</span>
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
};
