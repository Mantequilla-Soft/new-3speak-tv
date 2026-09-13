import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { IoClose } from 'react-icons/io5';
import { FaCheck } from 'react-icons/fa';
import { toastIn } from '../../utils/toast';
import { awardBadgeWithAioha } from '../../hive-api/aioha';
import { badgeHolders } from '../../utils/badgeAwards';
import './AwardBadgeModal.scss';

// Every toast from this module is headed "Badges"; the message becomes the line
// under it. See utils/toast.js.
const toast = toastIn('Badges');

/**
 * Pick one of your badges and award it to someone.
 *
 * Awarding is the badge account following them, signed with your own posting
 * key through the authority the badge granted you at creation — so this never
 * asks anyone to log in as the badge.
 *
 * Badges they ALREADY hold are shown as held rather than hidden: the useful
 * answer to "can I give them this?" is often "they have it", and dropping those
 * rows would leave someone hunting for a badge that is simply already awarded.
 */
export default function AwardBadgeModal({ username, badges, onClose, onAwarded }) {
  const [held, setHeld] = useState(null); // null = still looking
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      // One lookup per badge, but there are only ever a handful: these are
      // badges this one person made by hand and paid 3 HIVE each for.
      const entries = await Promise.all(
        badges.map(async (b) => [b.account, (await badgeHolders(b.account)).has(username)]),
      );
      if (alive) setHeld(Object.fromEntries(entries));
    })();
    return () => { alive = false; };
  }, [badges, username]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const award = async (badge) => {
    setBusy(badge.account);
    try {
      await awardBadgeWithAioha(badge.account, username, true);
      setHeld((prev) => ({ ...prev, [badge.account]: true }));
      toast.success(`@${username} now holds ${badge.title}`);
      onAwarded?.(badge);
    } catch (err) {
      toast.error(err?.message || 'Could not award that badge');
    } finally {
      setBusy('');
    }
  };

  return createPortal(
    <div className="award-overlay" onClick={onClose}>
      <div
        className="award-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Award a badge to ${username}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="award-head">
          <div>
            <h3>Award a badge</h3>
            <p>to @{username}</p>
          </div>
          <button type="button" className="award-close" onClick={onClose} aria-label="Close">
            <IoClose size={20} />
          </button>
        </header>

        <ul className="award-list">
          {badges.map((badge) => {
            const has = held?.[badge.account];
            const working = busy === badge.account;
            return (
              <li key={badge.account}>
                <button
                  type="button"
                  className={`award-item${has ? ' is-held' : ''}`}
                  disabled={has || !!busy || held === null}
                  onClick={() => award(badge)}
                >
                  <img
                    src={badge.image || `https://images.hive.blog/u/${badge.account}/avatar`}
                    alt=""
                  />
                  <span className="award-item-text">
                    <strong>{badge.title}</strong>
                    <span>{badge.account}</span>
                  </span>
                  <span className="award-item-state">
                    {working ? 'Awarding…' : has ? <><FaCheck /> Held</> : held === null ? '…' : 'Award'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <p className="award-note">
          The badge follows them on Hive, which is what holding it means. You can
          take it back from the badge&rsquo;s own page.
        </p>
      </div>
    </div>,
    document.body,
  );
}
