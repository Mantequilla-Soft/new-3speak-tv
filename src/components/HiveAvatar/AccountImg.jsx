import { useAvatarUrl } from '../../utils/avatarCache';

/**
 * A bare <img> of an account's picture, for places that are not a person and so
 * want neither HiveAvatar's wrapper span nor its Pro badge: communities, mostly.
 *
 * A hardcoded /img/u/<name>/avatar/small is cached, but it asks Hive's proxy for
 * the picture, and that proxy cannot fetch images.3speak.tv: a community whose
 * avatar was uploaded through us showed Hive's grey default face, with a 200 so
 * nothing looked broken. useAvatarUrl reads the real profile_image (batched,
 * remembered) and serves it through our /img/ cache either way.
 *
 * Every other prop (className, alt, loading, onError, style) goes to the <img>.
 */
export default function AccountImg({ account, size = 'small', alt = '', ...rest }) {
  const src = useAvatarUrl(account, size);
  return <img src={src} alt={alt} {...rest} />;
}
