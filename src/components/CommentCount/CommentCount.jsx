import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import './CommentCount.scss';

/**
 * Comment count for a video tile, sitting alongside UpvoteCount / ViewCount.
 * Renders nothing when the count is unknown — a feed payload without the field
 * shouldn't leave a bare icon or a stray "0" implying there are no replies.
 */
function CommentCount({ count, size, title }) {
  const { t } = useTranslation();
  if (count == null) return null;
  const iconSize = size ? Math.round(size * 1.1) : 13;

  return (
    <div
      className="comment-count-badge"
      style={size ? { fontSize: size } : undefined}
      title={title ?? t('common.units.comments', { count })}
    >
      <Icon name="chat_bubble" size={iconSize} className="comment-count-icon" />
      <span>{count}</span>
    </div>
  );
}

CommentCount.propTypes = {
  count: PropTypes.number,
  size: PropTypes.number,
  title: PropTypes.string,
};

export default CommentCount;
