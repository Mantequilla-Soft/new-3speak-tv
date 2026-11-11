import { useEffect, useState } from 'react';
import { toastIn } from '../../utils/toast';
import { awardBadgeWithAioha } from '../../hive-api/aioha';
import { badgeHolders } from '../../utils/badgeAwards';
import { cachedProfileImage } from '../../utils/avatarCache';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../v2/ui';
import { Icon } from '../v2/Icon';
import { cx } from '../v2/helpers';
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
  const { t } = useTranslation();
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

  const award = async (badge) => {
    setBusy(badge.account);
    try {
      await awardBadgeWithAioha(badge.account, username, true);
      setHeld((prev) => ({ ...prev, [badge.account]: true }));
      toast.success(t('badges.award.success', { username, title: badge.title }));
      onAwarded?.(badge);
    } catch (err) {
      toast.error(err?.message || t('badges.award.failed'));
    } finally {
      setBusy('');
    }
  };

  // Design 41c / 29c: a v2 Dialog (a bottom sheet on a phone) with one well row
  // per badge, its action on the right: Award in the accent, Held muted.
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      title={t('badges.award.title')}
      sub={t('badges.award.toUser', { username })}
      width={440}
      closeLabel={t('common.actions.close')}
      className="award-modal"
    >
      <span className="award-sr">{t('badges.award.dialogLabel', { username })}</span>
      <ul className="award-list">
        {badges.map((badge) => {
          const has = held?.[badge.account];
          const working = busy === badge.account;
          return (
            <li key={badge.account}>
              <button
                type="button"
                className={cx('award-item', has && 'is-held')}
                disabled={has || !!busy || held === null}
                onClick={() => award(badge)}
              >
                <img
                  src={cachedProfileImage(badge.account, badge.image, 'small')}
                  alt=""
                />
                <span className="award-item-text">
                  <strong>{badge.title}</strong>
                  <span>{badge.account}</span>
                </span>
                <span className={cx('award-item-state', has ? 'is-held' : held === null ? 'is-wait' : 'is-award')}>
                  {working ? (
                    <><Icon name="progress_activity" size={14} className="v2-spin" /> {t('badges.award.awarding')}</>
                  ) : has ? (
                    <><Icon name="check" size={14} /> {t('badges.award.held')}</>
                  ) : held === null ? (
                    <Icon name="progress_activity" size={14} className="v2-spin" />
                  ) : t('badges.award.award')}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="award-note">
        {t('badges.award.note')}
      </p>
    </Dialog>
  );
}
