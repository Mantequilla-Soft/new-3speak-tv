import { forwardRef } from 'react';
import PremiumBadge from '../PremiumBadge/PremiumBadge';
import { useAvatarUrl } from '../../utils/avatarCache';
import './HiveAvatar.scss';

/**
 * Hive profile avatar with a 3Speak Pro badge overlaid at the
 * top-right when the user is premium. Wraps the underlying `<img>` in
 * a positioned `<span>` so the badge can be absolutely placed.
 *
 * Props mirror the most common usages of the raw `<img>`:
 *  - username: Hive account (string). Required for the avatar URL +
 *    premium lookup. When empty, renders nothing.
 *  - size: 'small' | 'medium' | 'large'. Default 'small'. Maps to
 *    Hive's avatar size segment.
 *  - className: applied to the WRAPPER span (most existing call sites
 *    style the wrapper, not the img).
 *  - imgClassName: applied to the inner img, in case the caller has
 *    img-specific styles to preserve.
 *  - badgeSize: pixel size of the inline badge SVG.
 *  - alt, onClick, onError, ref: forwarded to the img.
 */
const HiveAvatar = forwardRef(function HiveAvatar(
  {
    username,
    size = 'small',
    className,
    imgClassName,
    badgeSize = 12,
    alt,
    onClick,
    onError,
    style,
  },
  ref,
) {
  // Hook first: it has to run on every render, including the empty-username one.
  // Serves a just-uploaded picture directly instead of the cached hive proxy
  // copy (see utils/avatarCache).
  const url = useAvatarUrl(username, size || 'small');
  if (!username) return null;
  return (
    <span
      className={`hive-avatar${className ? ` ${className}` : ''}`}
      onClick={onClick}
      style={style}
    >
      <img
        ref={ref}
        src={url}
        alt={alt ?? username}
        className={imgClassName}
        onError={onError || ((e) => {
          // images.hive.blog answers an UNKNOWN account with a 500, not a
          // placeholder, so anyone who has no Hive account yet renders as a
          // broken image here. Fall back to the 3Speak mark.
          //
          // The data flag stops a loop if the fallback itself ever fails to
          // load: without it onError would fire again on the new src forever.
          if (e.currentTarget.dataset.fellBack) return;
          e.currentTarget.dataset.fellBack = '1';
          e.currentTarget.src = '/pwa-192x192.png';
        })}
      />
      <PremiumBadge
        username={username}
        size={badgeSize}
        className="hive-avatar__badge"
      />
    </span>
  );
});

export default HiveAvatar;
