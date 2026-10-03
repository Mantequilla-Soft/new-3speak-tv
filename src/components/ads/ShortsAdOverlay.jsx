import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import './ShortsAdOverlay.scss';

/**
 * The chrome around a shorts spot: who it is from, that it is an ad, and how long is
 * left of it.
 *
 * NO SKIP BUTTON, and no way out generally — the feed's own navigation is disabled for
 * the length of the spot too. What keeps that from being a trap is that the countdown
 * is not the player's: it runs off the server-reported duration in Short.jsx, ticks
 * down on a plain interval, and ends the spot when it reaches zero whatever the video
 * element is doing. A spot with no duration ends immediately rather than never.
 *
 * 🚨 Draws NO video. The shorts feed has exactly one <video> element on purpose —
 * iOS will not play a second one — so the spot is loaded into that same persistent
 * player and this only sits on top of it. Creating a video element here would break
 * shorts playback on every iPhone.
 *
 * Unlike the watch-page banner, this is honestly blockable: it is a DOM node, and a
 * cosmetic filter can hide it. That is an accepted trade here — hiding the label does
 * not hide the spot, because the spot IS the video that is playing. The disclosure is
 * the thing at risk, not the impression, which is the right way round.
 */
export default function ShortsAdOverlay({ brand, secondsLeft, loading }) {
  const { t } = useTranslation();
  if (!brand) return null;
  return (
    <div className={`mkt-shortad${loading ? ' is-loading' : ''}`}>
      {/* Covers the ~1s of black while the shared player fetches the spot's playlist
          and first segment. Not a spinner on its own: the advertiser's own card is
          what the viewer is about to see anyway, so showing it early reads as the ad
          arriving rather than as the feed stalling. */}
      {loading && (
        <div className="mkt-shortad-cover">
          {brand.logoUrl && <img src={brand.logoUrl} alt="" className="mkt-shortad-cover-logo" />}
          <span className="mkt-shortad-cover-name">{brand.productName || brand.account}</span>
          {brand.slogan && <span className="mkt-shortad-cover-slogan">{brand.slogan}</span>}
          <span className="mkt-shortad-cover-bar"><i /></span>
        </div>
      )}

      <div className="mkt-shortad-top">
        <span className="mkt-shortad-tag">{t('ads.overlay.adTag')}</span>
        {Number.isFinite(secondsLeft) && secondsLeft > 0 && (
          <span className="mkt-shortad-count">{secondsLeft}s</span>
        )}
      </div>

      <a
        className="mkt-shortad-brand"
        href={brand.clickUrl || undefined}
        target="_blank"
        rel="noopener noreferrer sponsored"
        onClick={(e) => { if (!brand.clickUrl) e.preventDefault(); }}
      >
        {brand.logoUrl && <img src={brand.logoUrl} alt="" className="mkt-shortad-logo" />}
        <span className="mkt-shortad-text">
          <strong>{brand.productName || brand.account}</strong>
          {brand.slogan && <span className="mkt-shortad-slogan">{brand.slogan}</span>}
        </span>
      </a>
    </div>
  );
}

ShortsAdOverlay.propTypes = {
  brand: PropTypes.shape({
    account: PropTypes.string,
    productName: PropTypes.string,
    logoUrl: PropTypes.string,
    slogan: PropTypes.string,
    clickUrl: PropTypes.string,
  }),
  secondsLeft: PropTypes.number,
  loading: PropTypes.bool,
};
