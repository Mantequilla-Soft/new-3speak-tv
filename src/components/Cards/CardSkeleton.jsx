import { SkeletonCard } from "./GridSkeleton";
import "./Cards.scss";
import "./CardSkeleton.scss";

// A page of loading cards for feeds that have not drawn their first grid yet.
// The same grid and card shapes as Card3 (Cards.scss .card--skeleton), so the
// real cards replace them without anything jumping.
function CardSkeleton({ count = 12 }) {
  return (
    <div className="card-container feed-wrap-skeleton-in" aria-busy="true">
      {Array.from({ length: count }, (_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}

export default CardSkeleton;
