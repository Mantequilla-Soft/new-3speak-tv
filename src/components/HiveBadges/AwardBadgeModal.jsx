import { useEffect, useState } from 'react';
import { toastIn } from '../../utils/toast';
import { awardBadgeWithAioha } from '../../hive-api/aioha';
import { badgeHolders } from '../../utils/badgeAwards';
import { cachedProfileImage, useAvatarUrl } from '../../utils/avatarCache';
import { useTranslation } from 'react-i18next';
import DialogShell, { SheetContext } from '../modal/DialogShell';
import { Button } from '../v2/ui';
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
  // 29c: pick a badge tile, then award it with the one main action.
  const [picked, setPicked] = useState('');
  const avatar = useAvatarUrl(username);

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

  const choice = badges.find((b) => b.account === picked && !held?.[b.account]);

  // Design 29c / 41c: the 17 sheet (docked right on desktop, a bottom sheet on
  // a phone) with an accent bar: who gets it, a grid of your badge tiles (Held
  // ones muted), and one accent action that names the badge.
  return (
    <DialogShell
      onClose={onClose}
      busy={!!busy}
      side
      tone="accent"
      title={t('badges.award.title')}
      width={420}
      className="award-modal"
      panelProps={{ 'aria-label': t('badges.award.dialogLabel', { username }) }}
      footer={(
        <Button
          variant="primary"
          size={56}
          block
          className="dlg-main award-main"
          disabled={!choice || !!busy}
          loading={!!busy}
          trailing={busy ? null : <Icon name="workspace_premium" size={24} />}
          onClick={() => choice && award(choice)}
        >
          {busy ? t('badges.award.awarding') : choice ? t('badges.award.awardNamed', { title: choice.title }) : t('badges.award.award')}
        </Button>
      )}
    >
      <SheetContext
        avatar={<span className="award-who">{avatar ? <img src={avatar} alt="" /> : null}</span>}
        title={username}
        meta={t('badges.award.toUser', { username })}
      />
      <div className="award-grid" role="radiogroup" aria-label={t('badges.award.title')}>
        {badges.map((badge) => {
          const has = held?.[badge.account];
          const on = picked === badge.account && !has;
          return (
            <button
              key={badge.account}
              type="button"
              role="radio"
              aria-checked={on}
              className={cx('award-tile', on && 'is-on', has && 'is-held')}
              disabled={has || !!busy || held === null}
              onClick={() => setPicked(badge.account)}
              title={badge.account}
            >
              <span className="award-tile-pic">
                <img src={cachedProfileImage(badge.account, badge.image, 'small')} alt="" />
              </span>
              <b>{badge.title}</b>
              {has ? (
                <span className="award-tile-state"><Icon name="check" size={12} /> {t('badges.award.held')}</span>
              ) : held === null ? (
                <Icon name="progress_activity" size={12} className="v2-spin award-tile-state" />
              ) : null}
            </button>
          );
        })}
      </div>

      <p className="award-note">
        {t('badges.award.note')}
      </p>
    </DialogShell>
  );
}
