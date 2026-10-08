import { FaHeart } from 'react-icons/fa';
import { formatCountCompact } from '../../i18n';
import './UpvoteCount.scss';

function UpvoteCount({ count, voted, onClick, loading, onCountEnter, onCountLeave, onCountClick, size, children }) {
  const iconSize = size ? Math.round(size * 1.08) : undefined;

  return (
    <div className={`upvote-count-badge${voted ? ' voted' : ''}`} style={size ? { fontSize: size } : undefined}>
      {loading ? (
        children
      ) : (
        <FaHeart
          className={`upvote-icon${onClick ? ' clickable' : ''}`}
          size={iconSize || undefined}
          onClick={onClick}
        />
      )}
      <span
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
