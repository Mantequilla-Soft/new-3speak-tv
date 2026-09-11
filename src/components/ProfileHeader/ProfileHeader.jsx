import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import HiveAvatar from '../HiveAvatar/HiveAvatar';
import { getHiveClient } from '../../utils/hiveNode';
import { fetchProfile } from '../../utils/profileMeta';
import { setResolvedAvatar } from '../../utils/avatarCache';
import { useImageLuminance } from '../../utils/imageLuminance';
import defaultCover from '../../assets/image/default-cover.svg';
import { hiveProxyRefuses } from '../../utils/fixThumbnails';
import './ProfileHeader.scss';

/**
 * Shared banner header for the user-profile and community pages.
 *
 * Renders a cover banner with a faded bottom, an overlapping avatar, the name
 * in the default 3Speak font (just larger), an optional bio directly under the
 * name, plus optional `badges` (under the name) and `actions` (buttons on the
 * right). Used by UserProfilePage, ProfilePage (own) and CommunityPage so the
 * header only ever has to change in one place.
 *
 * `username` is the Hive account (user or community id) — it drives both the
 * cover image and the avatar.
 *
 * Pass an explicit `bio` (e.g. a community's about text), or set `fetchBio`
 * to have the header pull the account's Hive profile "about" itself — used for
 * user profiles so the bio shows under the username without each page wiring
 * up its own fetch.
 */
export default function ProfileHeader({
  username,
  name,
  bio,
  fetchBio = false,
  badges,
  actions,
  // Sits inline with the display name — the page's focal point — so the two
  // actions a visitor came for (Follow, Message) are read together with WHO
  // they'd be following, not parked in the corner with share/report.
  nameActions,
  // Slot between the bio/location and the badge row — user profiles put their
  // stat line here (see ProfileStats); community pages pass nothing.
  meta,
  avatarBadgeSize = 16,
  refreshKey = 0,
  showHandle = false,
  onAvatarClick,
  // Pictures we already hold, handed over rather than resolved through
  // images.hive.blog. Their proxy cannot read images.3speak.tv, so a badge or
  // community whose art we host showed a grey placeholder and our default
  // banner even though both images were set and serving fine.
  avatarUrl,
  coverUrl: coverUrlProp,
}) {
  const [hiveBio, setHiveBio] = useState('');
  const [hiveName, setHiveName] = useState('');
  const [hiveLocation, setHiveLocation] = useState('');

  const wantsBio = fetchBio && !bio;
  useEffect(() => {
    if (!wantsBio || !username) return;
    let cancelled = false;
    (async () => {
      try {
        // bridge, not the raw account: it also answers for communities, whose
        // "about" doesn't live in account metadata.
        const profile = await getHiveClient().call('bridge', 'get_profile', { account: username });
        if (!cancelled) setHiveBio(profile?.metadata?.profile?.about || '');
      } catch {
        /* non-blocking — just no bio */
      }
    })();
    return () => { cancelled = true; };
    // refreshKey lets a caller re-read the profile after it was edited.
  }, [wantsBio, username, refreshKey]);

  // Account metadata, read for THREE things: the display name (bridge truncates
  // it to 20 chars), the location, and whether a cover is set at all.
  //
  // The cover question can't be answered by looking at the image: when an account
  // has none, images.hive.blog serves its OWN generated placeholder — a pale
  // network pattern — which loads perfectly well, so there's no error to catch.
  // The metadata is the source of truth: no `cover_image` means anything that URL
  // returns is the host's filler, and we show our own banner instead.
  const [hasCover, setHasCover] = useState(null);   // null = not known yet
  // The account's own cover URL, used directly when Hive cannot proxy it.
  const [metaCover, setMetaCover] = useState('');
  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    (async () => {
      const profile = await fetchProfile(username);
      if (cancelled) return;
      // A failed lookup stays `null`, which also means "use our banner" — better
      // a deliberate 3Speak cover than the host's placeholder.
      setHasCover(profile ? !!String(profile.cover_image || '').trim() : null);
      if (!profile) return;
      // BEFORE the showHandle gate. Handing the real picture to the avatar cache
      // has nothing to do with whether this header prints an @handle, and gating
      // it there meant every page that does not — user profiles included — kept
      // rendering the hive proxy copy. For anyone whose avatar is hosted by us
      // that copy is the host's grey placeholder, served with a cheerful 200.
      setResolvedAvatar(username, profile.profile_image || '');
      setMetaCover(String(profile.cover_image || '').trim());
      if (!showHandle) return;
      setHiveName(profile.name || '');
      setHiveLocation(profile.location || '');
    })();
    return () => { cancelled = true; };
  }, [showHandle, username, refreshKey]);

  const bioText = bio || hiveBio;
  // With showHandle, a display name becomes the heading and the account name
  // moves underneath as @handle. No display name set: heading stays the account
  // name, and we don't repeat it as a handle right below itself.
  const displayName = showHandle && hiveName.trim() ? hiveName.trim() : '';
  const locationText = hiveLocation.trim();
  const heading = displayName || name || username;
  const avatarClickable = typeof onAvatarClick === 'function';

  // Keep the avatar exactly as tall as the identity lines beside it (display
  // name, @handle, bio, location). Measured rather than done in CSS: a flex
  // item resolves its width from content before the cross-axis stretch, so
  // "square as tall as my sibling" isn't expressible with aspect-ratio.
  const metaRef = useRef(null);
  const [avatarSize, setAvatarSize] = useState(0);
  useLayoutEffect(() => {
    const el = metaRef.current;
    if (!el) return;
    const measure = () => setAvatarSize(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;   // fine, CSS min-* holds
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [heading, bioText, locationText, badges]);

  // Adapt the panel's veil to the cover behind it: white text over a pale banner
  // needs a heavier scrim than the same text over a dark one. Continuous rather
  // than a light/dark switch, so a mid-tone banner gets a mid-strength veil and
  // nothing jumps at the threshold.
  // A creator with no cover gets 403 "Forbidden" from images.hive.blog, and
  // browsers disagree about what a broken <img> looks like. Fall back to our own
  // branded banner so every profile has a real cover, and measure THAT one — the
  // scrim has to match whatever is actually on screen.
  const [coverFailed, setCoverFailed] = useState(false);
  const coverUrl = coverUrlProp
    || (hiveProxyRefuses(metaCover) ? metaCover : `https://images.hive.blog/u/${username}/cover`);
  // Our banner unless the account genuinely has one. `hasCover === null` (still
  // loading, or the lookup failed) also lands here, so the host's placeholder is
  // never on screen even for a moment.
  // An explicit cover IS the answer to "does this account have one", so it does
  // not wait on the metadata lookup that hasCover performs.
  const shownCover = (coverFailed || (!coverUrlProp && !hasCover)) ? defaultCover : coverUrl;
  useEffect(() => { setCoverFailed(false); }, [coverUrl]);
  const coverLuminance = useImageLuminance(shownCover);
  // Unmeasurable is NOT the same as dark. images.hive.blog serves a pale default
  // cover for accounts that have none, and (unlike real covers) it can come back
  // without CORS headers, which taints the canvas — we get null and used to
  // assume "dark", leaving grey-on-pale text. An unknown banner gets a mid scrim
  // instead: slightly heavy for a dark image, readable on anything.
  const UNKNOWN_SCRIM = 0.62;
  const scrim = coverLuminance == null
    ? UNKNOWN_SCRIM
    : Math.min(0.82, Math.max(0.42, 0.42 + (coverLuminance - 0.45) * 0.9));

  return (
    <div
      className="profile-card"
      style={{ '--panel-scrim': scrim }}
    >
      <div className="profile-header">
        <img
          className={`gradient-bg${shownCover === defaultCover ? ' gradient-bg--default' : ''}`}
          src={shownCover}
          alt=""
          onError={() => setCoverFailed(true)}
        />
      </div>
      <div className="profile-body">
        <div className="top-section">
          <div className="left-info">
            {/* Avatar + identity lines: the avatar is sized off this row, so it
                matches the text lines and stops above the badges. */}
            <div className="identity-row">
            <div
              className={`avatar${avatarClickable ? ' avatar--clickable' : ''}`}
              style={avatarSize ? { width: avatarSize, height: avatarSize } : undefined}
              {...(avatarClickable ? {
                role: 'button',
                tabIndex: 0,
                title: 'Edit your profile',
                onClick: onAvatarClick,
                onKeyDown: (e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAvatarClick(); }
                },
              } : {})}
            >
              <HiveAvatar
                username={username}
                size={null}
                alt={`${heading} avatar`}
                badgeSize={avatarBadgeSize}
                srcOverride={avatarUrl}
              />
              {avatarClickable ? (
                <span className="avatar-edit-overlay" aria-hidden="true">
                  <Camera size={22} />
                </span>
              ) : null}
            </div>
            <div className="user-meta" ref={metaRef}>
              <div className="name-row">
                <h2>{heading}</h2>
                {nameActions ? <div className="name-actions">{nameActions}</div> : null}
              </div>
              {displayName ? <span className="profile-handle">@{username}</span> : null}
              {bioText ? <p className="profile-bio">{bioText}</p> : null}
              {locationText ? (
                <p className="profile-location">
                  <span className="profile-location-label">Location:</span> {locationText}
                </p>
              ) : null}
              {meta}
            </div>
            </div>
            {badges ? <div className="user-badges">{badges}</div> : null}
          </div>
          {actions ? <div className="button-group">{actions}</div> : null}
        </div>
      </div>
    </div>
  );
}
