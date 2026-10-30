import { artUrl, onArtError, PODCAST_PLACEHOLDER } from '../../lib/podcasts';

/**
 * A podcast cover from the checker's art route. When it can't be had, `fallback`
 * (another cover token, e.g. the newest episode's) is tried, then the microphone
 * placeholder.
 */
export default function PodcastArt({ art, fallback, px = 128, className = '' }) {
  const first = art || fallback;
  return (
    <img
      className={`pod-art ${className}`}
      src={first ? artUrl(first, px) : PODCAST_PLACEHOLDER}
      alt=""
      loading="lazy"
      onError={(e) => {
        const next = fallback && first !== fallback && !e.currentTarget.dataset.fellBack ? artUrl(fallback, px) : null;
        if (next) { e.currentTarget.dataset.fellBack = '1'; e.currentTarget.src = next; } else onArtError(e);
      }}
    />
  );
}
