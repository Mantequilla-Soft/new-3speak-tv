// Loading stand-ins drawn IN the card grid (.card-container), so they take the
// columns, sizes and gaps of the cards that replace them and nothing jumps.
// Styles: Cards.scss (.card--skeleton).

/** One card: thumbnail, then the avatar beside two title lines and the meta line. */
export function SkeletonCard() {
  return (
    <div className="card card--skeleton" aria-hidden="true">
      <div className="card-skeleton-block card-skeleton-thumb" />
      <SkeletonBody />
    </div>
  );
}

/**
 * The Discover Spotlight's block while its videos are on the way: the same span
 * as the card it stands in for (HomeGrouped featuredLayout), so the grid keeps
 * its shape when the Spotlight arrives.
 */
export function SpotlightSkeleton({ layout }) {
  return (
    <div
      className={`card card--featured${layout.rows > 1 ? ' card--featured-tall' : ''} card--skeleton`}
      style={{ gridColumn: `span ${layout.span}`, gridRow: `span ${layout.rows}` }}
      aria-hidden="true"
    >
      <div className="card-skeleton-block card-skeleton-thumb" />
      <SkeletonBody />
    </div>
  );
}

function SkeletonBody() {
  return (
    <div className="card-skeleton-body">
      <span className="card-skeleton-block card-skeleton-avatar" />
      <div className="card-skeleton-lines">
        <div className="card-skeleton-block card-skeleton-line" />
        <div className="card-skeleton-block card-skeleton-line card-skeleton-line--short" />
        <div className="card-skeleton-block card-skeleton-line card-skeleton-line--meta" />
      </div>
    </div>
  );
}
