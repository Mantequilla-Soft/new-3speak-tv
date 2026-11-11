import './SkeletonLoader.scss';

// Loading placeholders for the Groups directories: striped cards in the same
// grid the real cards use, so nothing jumps when the list arrives.
const SkeletonLoader = ({ count = 9, height = 220 }) => (
  <div className="groups-grid skeleton-loaders" aria-hidden="true">
    {Array.from({ length: count }, (_, i) => (
      <div key={i} className="v2-skeleton skeleton-card" style={{ height }} />
    ))}
  </div>
);

export default SkeletonLoader;
