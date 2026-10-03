import { useEffect, useState } from 'react';
import { FaLink } from 'react-icons/fa6';
import { fetchSpotlight } from '../../utils/spotlight';
import { useTranslation } from 'react-i18next';
import './ProfileLinksButton.scss';

/**
 * "Links" button under the Message button, on narrow screens.
 *
 * The framed links page beside the Overview tab (ProfileLinksPanel) only exists
 * from 1025px up, so below that a visitor had no way to reach the page at all.
 * This is its exact complement: same breakpoint, other side of it.
 *
 * Only rendered when the creator actually has a page — a button through to an
 * empty one is worse than no button. It lives in the header's `nameActions`,
 * which only exists on someone else's profile, so the own-profile case is
 * handled for free (the Links tab is right there anyway).
 *
 * Wears `btn btn-hero-message` so it IS the Message button visually, and its
 * own class only places it in the row below.
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
    <a className="btn btn-hero-message profile-links-btn" href={`/links/${username}`}>
      <FaLink /> {t('profile.links.button')}
    </a>
  );
}
