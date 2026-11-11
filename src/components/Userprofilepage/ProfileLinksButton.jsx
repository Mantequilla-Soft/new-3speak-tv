import { useEffect, useState } from 'react';
import { fetchSpotlight } from '../../utils/spotlight';
import { useTranslation } from 'react-i18next';
import { ProfileTile } from './ProfileActions';
import './ProfileLinksButton.scss';

/**
 * "Links" tile in the profile header, on narrow screens.
 *
 * The framed links page beside the Overview tab (ProfileLinksPanel) only exists
 * from 1025px up, so below that a visitor had no way to reach the page at all.
 * This is its exact complement: same breakpoint, other side of it.
 *
 * Only rendered when the creator actually has a page — a button through to an
 * empty one is worse than no button. It lives in the header's `nameActions`,
 * which only exists on someone else's profile, so the own-profile case is
 * handled for free (the Links tab is right there anyway).
 */
export default function ProfileLinksButton({ username }) {
  const { t } = useTranslation();
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1024px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)');
    const on = () => setIsNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const [hasPage, setHasPage] = useState(false);
  useEffect(() => {
    if (!isNarrow || !username) return undefined;
    let alive = true;
    fetchSpotlight(username)
      .then((r) => { if (alive) setHasPage(!!(r.exists && r.page?.sections?.length)); })
      .catch(() => { if (alive) setHasPage(false); });
    return () => { alive = false; };
  }, [isNarrow, username]);

  if (!isNarrow || !hasPage) return null;

  // Plain anchor, not a router Link: /links/<user> is standalone HTML served by
  // nginx, and it carries its own way back to the profile.
  return (
    <ProfileTile as="a" icon="link" label={t('profile.links.button')} className="profile-links-btn" href={`/links/${username}`} />
  );
}
