import { Icon } from '../v2/Icon';
import { formatCountCompact } from '../../i18n';
import './UpvoteCount.scss';

// Vote count with the upvote arrow (the v2 vote glyph). `voted` fills the arrow
// in accent. `onClick` makes the arrow vote; `children` stand in for it while a
// vote is being sent (`loading`).
function UpvoteCount({ count, voted, onClick, loading, onCountEnter, onCountLeave, onCountClick, size, children }) {
  const iconSize = size ? Math.round(size * 1.15) : 14;

  return (
    <div className={`upvote-count-badge${voted ? ' voted' : ''}`} style={size ? { fontSize: size } : undefined}>
      {loading ? (
        children
      ) : (
        <Icon
          name="arrow_upward"
          size={iconSize}
          fill={!!voted}
          weight={voted ? 700 : 500}
          className={`upvote-icon${onClick ? ' clickable' : ''}`}
          onClick={onClick}
        />
      )}
      <span
        className="upvote-count-num"
        onMouseEnter={onCountEnter}
        onMouseLeave={onCountLeave}
        onClick={onCountClick}
        style={onCountClick ? { cursor: 'pointer' } : undefined}
      >
        {count == null ? '…' : (
          // Full number on desktop; whole thousands on a phone ("1250" → "1k").
          <>
            <span className="upvote-count-full">{count}</span>
            <span className="upvote-count-compact">{formatCountCompact(count)}</span>
          </>
        )}
      </span>
    </div>
  );
}

export default UpvoteCount;
